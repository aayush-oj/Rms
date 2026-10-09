import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { AlertCandidate, AlertRecord, AlertSettings } from './types';
import { BadRequestError } from '../../shared/errors';

const dt=(value:any)=>value?new Date(value).toISOString():null;
const nullableNumber=(value:any):number|null=>value==null?null:Number(value);

const map=(row:any):AlertRecord=>({
  id:Number(row.id),
  organizationId:Number(row.organization_id),
  branchId:Number(row.branch_id),
  dedupKey:String(row.dedup_key),
  type:row.type,
  category:row.category,
  severity:row.severity,
  title:String(row.title),
  message:String(row.message),
  entityType:row.entity_type?String(row.entity_type):null,
  entityId:row.entity_id?String(row.entity_id):null,
  status:['RESOLVED','DISMISSED'].includes(String(row.status))?'RESOLVED':'OPEN',
  audienceType:row.audience_type,
  audienceReference:row.audience_reference?String(row.audience_reference):null,
  metadata:row.metadata_json?(typeof row.metadata_json==='string'?JSON.parse(row.metadata_json):row.metadata_json):{},
  createdAt:dt(row.created_at)!,
  resolvedAt:dt(row.resolved_at??row.dismissed_at),
  resolvedBy:row.resolved_by?Number(row.resolved_by):null,
  updatedAt:dt(row.updated_at)!,
});

const settings=(row:any):AlertSettings=>({
  organizationId:Number(row.organization_id),
  branchId:Number(row.branch_id),
  kotDelayMinutes:nullableNumber(row.kot_delay_minutes),
  readyNotServedMinutes:nullableNumber(row.ready_not_served_minutes),
  longTableMinutes:nullableNumber(row.long_table_minutes),
  unpaidTableMinutes:nullableNumber(row.unpaid_table_minutes),
  shiftOpenMinutes:nullableNumber(row.shift_open_minutes),
  cashVarianceWarning:Number(row.cash_variance_warning),
  cashVarianceCritical:Number(row.cash_variance_critical),
  lowStockEnabled:Boolean(row.low_stock_enabled),
  poOverdueEnabled:Boolean(row.po_overdue_enabled),
  updatedAt:dt(row.updated_at)!,
});

export class AlertRepository {
  async recordAuthFailure(org:number,branch:number,accountUserId:number,failureType:string):Promise<number>{
    const pool=getDatabasePool();
    const conn=await pool.getConnection();
    try{
      await conn.beginTransaction();
      const [rows]=await conn.execute<RowDataPacket[]>(
        `SELECT * FROM alert_auth_failure_windows
         WHERE organization_id=? AND branch_id=? AND account_user_id=? AND failure_type=? FOR UPDATE`,
        [org,branch,accountUserId,failureType],
      );
      let count=1;
      if(!rows.length){
        await conn.execute(
          `INSERT INTO alert_auth_failure_windows(organization_id,branch_id,account_user_id,failure_type,failure_count)
           VALUES(?,?,?,?,1)`,
          [org,branch,accountUserId,failureType],
        );
      }else{
        const age=(Date.now()-new Date(rows[0].window_started_at).getTime())/60000;
        count=age>10?1:Number(rows[0].failure_count)+1;
        await conn.execute(
          `UPDATE alert_auth_failure_windows
           SET failure_count=?,window_started_at=IF(?=1,NOW(),window_started_at),last_failed_at=NOW()
           WHERE organization_id=? AND branch_id=? AND account_user_id=? AND failure_type=?`,
          [count,count,org,branch,accountUserId,failureType],
        );
      }
      await conn.commit();
      return count;
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }

  async clearAuthFailures(org:number,branch:number,accountUserId:number,failureType:string):Promise<void>{
    await getDatabasePool().execute(
      `DELETE FROM alert_auth_failure_windows
       WHERE organization_id=? AND branch_id=? AND account_user_id=? AND failure_type=?`,
      [org,branch,accountUserId,failureType],
    );
  }

  async getSettings(org:number,branch:number):Promise<AlertSettings>{
    await getDatabasePool().execute(`INSERT IGNORE INTO alert_settings(organization_id,branch_id) VALUES(?,?)`,[org,branch]);
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT * FROM alert_settings WHERE organization_id=? AND branch_id=?`,
      [org,branch],
    );
    return settings(rows[0]);
  }

  async updateSettings(org:number,branch:number,input:Record<string,unknown>):Promise<AlertSettings>{
    const current=await this.getSettings(org,branch);
    const warning=input.cashVarianceWarning===undefined?current.cashVarianceWarning:Number(input.cashVarianceWarning);
    const critical=input.cashVarianceCritical===undefined?current.cashVarianceCritical:Number(input.cashVarianceCritical);
    if(critical<warning) throw new BadRequestError('Critical variance threshold must be greater than or equal to warning threshold','INVALID_ALERT_THRESHOLD');

    const columns:Record<string,string>={
      kotDelayMinutes:'kot_delay_minutes',
      readyNotServedMinutes:'ready_not_served_minutes',
      longTableMinutes:'long_table_minutes',
      unpaidTableMinutes:'unpaid_table_minutes',
      shiftOpenMinutes:'shift_open_minutes',
      cashVarianceWarning:'cash_variance_warning',
      cashVarianceCritical:'cash_variance_critical',
      lowStockEnabled:'low_stock_enabled',
      poOverdueEnabled:'po_overdue_enabled',
    };
    const sets:string[]=[];
    const params:any[]=[];
    for(const [key,column] of Object.entries(columns)){
      if(Object.prototype.hasOwnProperty.call(input,key)){
        sets.push(`${column}=?`);
        params.push(input[key]);
      }
    }
    if(sets.length){
      await getDatabasePool().execute(
        `UPDATE alert_settings SET ${sets.join(',')},updated_at=NOW() WHERE organization_id=? AND branch_id=?`,
        [...params,org,branch],
      );
    }
    return this.getSettings(org,branch);
  }

  async upsertOpen(candidate:AlertCandidate):Promise<{alert:AlertRecord;created:boolean;changed:boolean}>{
    const pool=getDatabasePool();
    const conn=await pool.getConnection();
    try{
      await conn.beginTransaction();
      const [existing]=await conn.execute<RowDataPacket[]>(
        `SELECT * FROM alerts
         WHERE organization_id=? AND branch_id=? AND dedup_key=?
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [candidate.organizationId,candidate.branchId,candidate.dedupKey],
      );
      if(existing.length&&['OPEN','ACKNOWLEDGED'].includes(String(existing[0].status))){
        const current=map(existing[0]);
        const nextMetadata=JSON.stringify(candidate.metadata??{});
        const changed=current.severity!==candidate.severity||current.title!==candidate.title||current.message!==candidate.message||JSON.stringify(current.metadata)!==nextMetadata||current.audienceType!==candidate.audienceType||current.audienceReference!==(candidate.audienceReference==null?null:String(candidate.audienceReference));
        if(changed){
          await conn.execute(
            `UPDATE alerts
             SET severity=?,title=?,message=?,audience_type=?,audience_reference=?,metadata_json=?,updated_at=NOW()
             WHERE id=?`,
            [candidate.severity,candidate.title,candidate.message,candidate.audienceType,candidate.audienceReference==null?null:String(candidate.audienceReference),nextMetadata,existing[0].id],
          );
        }
        const [row]=await conn.execute<RowDataPacket[]>(`SELECT * FROM alerts WHERE id=?`,[existing[0].id]);
        await conn.commit();
        return {alert:map(row[0]),created:false,changed};
      }

      const [insert]=await conn.execute<ResultSetHeader>(
        `INSERT INTO alerts(organization_id,branch_id,dedup_key,type,category,severity,title,message,entity_type,entity_id,audience_type,audience_reference,metadata_json)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [candidate.organizationId,candidate.branchId,candidate.dedupKey,candidate.type,candidate.category,candidate.severity,candidate.title,candidate.message,candidate.entityType??null,candidate.entityId==null?null:String(candidate.entityId),candidate.audienceType,candidate.audienceReference==null?null:String(candidate.audienceReference),JSON.stringify(candidate.metadata??{})],
      );
      const [row]=await conn.execute<RowDataPacket[]>(`SELECT * FROM alerts WHERE id=?`,[insert.insertId]);
      await conn.commit();
      return {alert:map(row[0]),created:true,changed:true};
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }

  async resolveByKey(org:number,branch:number,key:string,actor:number|null=null):Promise<AlertRecord|null>{
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT * FROM alerts WHERE organization_id=? AND branch_id=? AND dedup_key=? ORDER BY id DESC LIMIT 1`,
      [org,branch,key],
    );
    if(!rows.length) return null;
    const latest=rows[0];
    if(['OPEN','ACKNOWLEDGED'].includes(String(latest.status))){
      await getDatabasePool().execute(
        `UPDATE alerts
         SET status='RESOLVED',resolved_at=NOW(),resolved_by=?,condition_cleared_at=NOW(),updated_at=NOW()
         WHERE id=?`,
        [actor,latest.id],
      );
      const [updated]=await getDatabasePool().execute<RowDataPacket[]>(`SELECT * FROM alerts WHERE id=?`,[latest.id]);
      return map(updated[0]);
    }
    if(latest.condition_cleared_at==null){
      await getDatabasePool().execute(`UPDATE alerts SET condition_cleared_at=NOW(),updated_at=NOW() WHERE id=?`,[latest.id]);
    }
    return null;
  }

  async getById(id:number,org:number,branches:number[]):Promise<AlertRecord|null>{
    if(!branches.length) return null;
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT * FROM alerts WHERE id=? AND organization_id=? AND branch_id IN (${branches.map(()=>'?').join(',')})`,
      [id,org,...branches],
    );
    return rows.length?map(rows[0]):null;
  }

  async list(org:number,branches:number[],auth:{id:number;role:string;permissions:string[]},filters:any):Promise<{items:AlertRecord[];total:number}>{
    if(!branches.length) return {items:[],total:0};
    const clauses=[`organization_id=?`,`branch_id IN (${branches.map(()=>'?').join(',')})`];
    const params:any[]=[org,...branches];
    if(filters.branchId){clauses.push('branch_id=?');params.push(filters.branchId)}
    if(filters.status){clauses.push('status=?');params.push(filters.status)}
    if(filters.severity){clauses.push('severity=?');params.push(filters.severity)}
    if(filters.category){clauses.push('category=?');params.push(filters.category)}
    if(filters.type){clauses.push('type=?');params.push(filters.type)}
    if(filters.from){clauses.push('created_at>=?');params.push(`${filters.from} 00:00:00`)}
    if(filters.to){clauses.push('created_at<?');params.push(`${filters.to} 23:59:59.999`)}

    const owner=auth.role==='OWNER'||auth.permissions.includes('admin:all');
    const managementVisibility=auth.permissions.includes('alerts.settings.manage');
    if(!owner&&!auth.permissions.includes('alerts.security.view')) clauses.push(`category <> 'SECURITY'`);
    if(!owner&&!managementVisibility){
      const audience:string[]=[
        `audience_type='BRANCH'`,
        `(audience_type='USER' AND audience_reference=?)`,
        `(audience_type='ROLE' AND audience_reference=?)`,
        `JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.secondaryRole'))=?`,
      ];
      const audienceParams:any[]=[String(auth.id),auth.role,auth.role];
      if(auth.permissions.length){
        audience.push(`(audience_type='PERMISSION_GROUP' AND audience_reference IN (${auth.permissions.map(()=>'?').join(',')}))`);
        audienceParams.push(...auth.permissions);
        audience.push(`JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.secondaryPermission')) IN (${auth.permissions.map(()=>'?').join(',')})`);
        audienceParams.push(...auth.permissions);
      }
      clauses.push(`(${audience.join(' OR ')})`);
      params.push(...audienceParams);
    }

    const where=clauses.join(' AND ');
    const [countRows]=await getDatabasePool().execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM alerts WHERE ${where}`,params);
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT * FROM alerts
       WHERE ${where}
       ORDER BY FIELD(status,'OPEN','RESOLVED'),FIELD(severity,'CRITICAL','WARNING','INFO'),created_at DESC
       LIMIT ? OFFSET ?`,
      [...params,Number(filters.limit||50),Number(filters.offset||0)],
    );
    return {items:rows.map(map),total:Number(countRows[0]?.total||0)};
  }
}

export const alertRepository=new AlertRepository();
