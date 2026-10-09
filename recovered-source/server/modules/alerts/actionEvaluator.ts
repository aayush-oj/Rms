import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { logger } from '../../lib/logger';
import { RealtimeEventEnvelope } from '../../realtime/events';
import { realtimePublisher } from '../../realtime/publisher';
import { alertRepository } from './repository';
import { alertService } from './service';
import { AlertCandidate } from './types';

const key=(type:string,id:number|string)=>`${type}:${id}`;
const num=(value:any)=>Number(value||0);

export class ActionAlertEvaluator {
  private timer:NodeJS.Timeout|null=null;
  private unsubscribe:(()=>void)|null=null;
  private running=false;

  async start():Promise<void>{
    if(this.timer) return;
    try{
      const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
        `SELECT COUNT(*) count FROM information_schema.tables
         WHERE table_schema=DATABASE() AND table_name IN ('alerts','alert_settings')`,
      );
      if(Number(rows[0]?.count||0)<2){
        logger.warn('Action alert evaluator not started because alert migrations are not applied');
        return;
      }
    }catch(error){
      logger.warn('Action alert evaluator readiness check failed',{error});
      return;
    }

    this.unsubscribe=realtimePublisher.subscribe((event)=>void this.onDomainEvent(event));
    this.timer=setInterval(()=>void this.evaluateAll(),60_000);
    this.timer.unref();
    setTimeout(()=>void this.evaluateAll(),3_000).unref();
    logger.info('Condition-driven action alert evaluator started',{intervalSeconds:60});
  }

  stop():void{
    if(this.timer) clearInterval(this.timer);
    this.timer=null;
    this.unsubscribe?.();
    this.unsubscribe=null;
  }

  private async onDomainEvent(event:RealtimeEventEnvelope):Promise<void>{
    if(event.type.startsWith('alert.')||event.branchId==null) return;
    try{
      if(
        event.type.startsWith('service.')||
        event.type.startsWith('order.')||
        event.type.startsWith('kot.')||
        event.type.startsWith('kds.')||
        event.type.startsWith('shift.')||
        event.type.startsWith('payment.')||
        event.type.startsWith('inventory.')||
        event.type.startsWith('stock.')
      ){
        await this.evaluateBranch(event.organizationId,event.branchId);
      }
    }catch(error){
      logger.warn('Action alert evaluation after domain event failed',{type:event.type,error});
    }
  }

  async evaluateAll():Promise<void>{
    if(this.running) return;
    this.running=true;
    try{
      const [branches]=await getDatabasePool().execute<RowDataPacket[]>(
        `SELECT organization_id,id branch_id FROM branches WHERE is_active=1`,
      );
      for(const row of branches){
        try{await this.evaluateBranch(Number(row.organization_id),Number(row.branch_id));}
        catch(error){logger.warn('Scheduled action alert branch evaluation failed',{branchId:row.branch_id,error});}
      }
    }catch(error){
      logger.warn('Scheduled action alert evaluation failed',{error});
    }finally{
      this.running=false;
    }
  }

  async evaluateBranch(org:number,branch:number):Promise<void>{
    const settings=await alertRepository.getSettings(org,branch);
    await this.readyItems(org,branch,settings.readyNotServedMinutes);
    await Promise.all([
      settings.kotDelayMinutes==null?this.sync([],org,branch,'KOT_DELAYED:'):this.kitchen(org,branch,settings.kotDelayMinutes),
      this.tables(org,branch,settings.longTableMinutes,settings.unpaidTableMinutes),
      this.shifts(org,branch,settings.shiftOpenMinutes),
      settings.lowStockEnabled
        ?this.stock(org,branch)
        :Promise.all([
          this.sync([],org,branch,'LOW_STOCK:'),
          this.sync([],org,branch,'CRITICAL_STOCK:'),
          this.sync([],org,branch,'OUT_OF_STOCK:'),
        ]),
    ]);
  }

  private async sync(candidates:AlertCandidate[],org:number,branch:number,prefix:string):Promise<void>{
    const activeKeys=new Set(candidates.map((candidate)=>candidate.dedupKey));
    for(const candidate of candidates) await alertService.open(candidate);
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT DISTINCT dedup_key FROM alerts
       WHERE organization_id=? AND branch_id=?
         AND status IN ('OPEN','ACKNOWLEDGED')
         AND dedup_key LIKE ?`,
      [org,branch,`${prefix}%`],
    );
    for(const row of rows){
      const dedupKey=String(row.dedup_key);
      if(!activeKeys.has(dedupKey)) await alertService.resolveCondition(org,branch,dedupKey);
    }
  }

  private async readyItems(org:number,branch:number,escalateMinutes:number|null):Promise<void>{
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT kti.id item_id,kti.quantity,kti.item_name_snapshot,kti.updated_at ready_at,
              kt.order_id,o.order_number,o.waiter_id,o.dining_table_id,
              dt.table_number,dt.assigned_waiter_id,
              TIMESTAMPDIFF(MINUTE,kti.updated_at,NOW()) minutes_ready
       FROM kitchen_ticket_items kti
       JOIN kitchen_tickets kt ON kt.id=kti.kitchen_ticket_id
       JOIN orders o ON o.id=kt.order_id
       LEFT JOIN dining_tables dt ON dt.id=o.dining_table_id
       WHERE o.organization_id=? AND o.branch_id=?
         AND o.order_type='DINE_IN'
         AND o.order_status NOT IN ('SERVED','COMPLETED','CANCELLED','MERGED')
         AND kti.item_status='READY'`,
      [org,branch],
    );

    const immediate:AlertCandidate[]=rows.map((row)=>{
      const waiterId=row.waiter_id==null?(row.assigned_waiter_id==null?null:Number(row.assigned_waiter_id)):Number(row.waiter_id);
      const tableLabel=row.table_number?`Table ${row.table_number}`:`Order ${row.order_number}`;
      return {
        organizationId:org,
        branchId:branch,
        dedupKey:key('READY_ITEM',row.item_id),
        type:'READY_ITEM',
        category:'SERVICE',
        severity:'WARNING',
        title:`Food ready — ${tableLabel}`,
        message:`${row.quantity}× ${row.item_name_snapshot} is ready to serve.`,
        entityType:'service_item',
        entityId:row.item_id,
        audienceType:waiterId?'USER':'ROLE',
        audienceReference:waiterId?String(waiterId):'FB_MANAGER',
        metadata:{
          orderId:num(row.order_id),
          tableId:row.dining_table_id==null?null:num(row.dining_table_id),
          waiterId,
          minutesReady:num(row.minutes_ready),
          secondaryRole:'FB_MANAGER',
        },
      };
    });
    await this.sync(immediate,org,branch,'READY_ITEM:');

    const escalated:AlertCandidate[]=escalateMinutes==null?[]:rows
      .filter((row)=>num(row.minutes_ready)>=escalateMinutes)
      .map((row)=>({
        organizationId:org,
        branchId:branch,
        dedupKey:key('READY_NOT_SERVED',row.item_id),
        type:'READY_NOT_SERVED',
        category:'SERVICE',
        severity:'WARNING',
        title:`Ready food still waiting — ${row.table_number?`Table ${row.table_number}`:`Order ${row.order_number}`}`,
        message:`${row.quantity}× ${row.item_name_snapshot} has been ready for ${row.minutes_ready} minutes.`,
        entityType:'service_item',
        entityId:row.item_id,
        audienceType:'ROLE',
        audienceReference:'FB_MANAGER',
        metadata:{
          orderId:num(row.order_id),
          tableId:row.dining_table_id==null?null:num(row.dining_table_id),
          waiterId:row.waiter_id==null?(row.assigned_waiter_id==null?null:num(row.assigned_waiter_id)):num(row.waiter_id),
          minutesReady:num(row.minutes_ready),
          configuredMinutes:escalateMinutes,
        },
      }));
    await this.sync(escalated,org,branch,'READY_NOT_SERVED:');
  }

  private async kitchen(org:number,branch:number,minutes:number):Promise<void>{
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT id,kot_number,order_id,table_label,ticket_status,
              TIMESTAMPDIFF(MINUTE,CASE WHEN ticket_status='PREPARING' THEN updated_at ELSE created_at END,NOW()) elapsed
       FROM kitchen_tickets
       WHERE organization_id=? AND branch_id=?
         AND ticket_status IN ('NEW','PREPARING')
         AND TIMESTAMPDIFF(MINUTE,CASE WHEN ticket_status='PREPARING' THEN updated_at ELSE created_at END,NOW())>=?`,
      [org,branch,minutes],
    );
    const candidates:AlertCandidate[]=rows.map((row)=>({
      organizationId:org,
      branchId:branch,
      dedupKey:key('KOT_DELAYED',row.id),
      type:'KOT_DELAYED',
      category:'KITCHEN',
      severity:'WARNING',
      title:`Delayed KOT ${row.kot_number}`,
      message:`${row.table_label||'Order'} has been ${row.ticket_status==='NEW'?'waiting':'preparing'} for ${row.elapsed} minutes.`,
      entityType:'kitchen_ticket',
      entityId:row.id,
      audienceType:'PERMISSION_GROUP',
      audienceReference:'kitchen:tickets:view',
      metadata:{orderId:num(row.order_id),minutes:num(row.elapsed),configuredMinutes:minutes,secondaryRole:'FB_MANAGER'},
    }));
    await this.sync(candidates,org,branch,'KOT_DELAYED:');
  }

  private async tables(org:number,branch:number,longMinutes:number|null,unpaidMinutes:number|null):Promise<void>{
    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT o.id,o.order_number,o.dining_table_id,o.waiter_id,o.payment_status,o.order_status,
              dt.table_number,TIMESTAMPDIFF(MINUTE,o.created_at,NOW()) elapsed
       FROM orders o
       LEFT JOIN dining_tables dt ON dt.id=o.dining_table_id
       WHERE o.organization_id=? AND o.branch_id=? AND o.order_type='DINE_IN'
         AND o.order_status NOT IN ('COMPLETED','CANCELLED','MERGED')`,
      [org,branch],
    );

    const long:AlertCandidate[]=longMinutes==null?[]:rows.filter((row)=>num(row.elapsed)>=longMinutes).map((row)=>({
      organizationId:org,branchId:branch,dedupKey:key('LONG_TABLE',row.id),type:'LONG_TABLE',category:'TABLE',severity:'WARNING',
      title:`Table ${row.table_number||row.dining_table_id} needs attention`,
      message:`Order ${row.order_number} has been open for ${row.elapsed} minutes.`,
      entityType:'order',entityId:row.id,
      audienceType:row.waiter_id?'USER':'ROLE',audienceReference:row.waiter_id?String(row.waiter_id):'FB_MANAGER',
      metadata:{tableId:row.dining_table_id==null?null:num(row.dining_table_id),minutes:num(row.elapsed),configuredMinutes:longMinutes,secondaryRole:'FB_MANAGER'},
    }));
    await this.sync(long,org,branch,'LONG_TABLE:');

    const unpaid:AlertCandidate[]=unpaidMinutes==null?[]:rows
      .filter((row)=>row.payment_status!=='PAID'&&num(row.elapsed)>=unpaidMinutes)
      .map((row)=>({
        organizationId:org,branchId:branch,dedupKey:key('UNPAID_TABLE',row.id),type:'UNPAID_TABLE',category:'TABLE',severity:'WARNING',
        title:`Payment waiting — Table ${row.table_number||row.dining_table_id}`,
        message:`Order ${row.order_number} remains unpaid after ${row.elapsed} minutes.`,
        entityType:'order',entityId:row.id,
        audienceType:row.waiter_id?'USER':'ROLE',audienceReference:row.waiter_id?String(row.waiter_id):'FB_MANAGER',
        metadata:{tableId:row.dining_table_id==null?null:num(row.dining_table_id),minutes:num(row.elapsed),configuredMinutes:unpaidMinutes,secondaryRole:'FB_MANAGER'},
      }));
    await this.sync(unpaid,org,branch,'UNPAID_TABLE:');
  }

  private async shifts(org:number,branch:number,openMinutes:number|null):Promise<void>{
    const openCandidates:AlertCandidate[]=[];
    if(openMinutes!=null){
      const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
        `SELECT s.id,s.cashier_id,u.name cashier_name,r.name register_name,
                TIMESTAMPDIFF(MINUTE,s.opened_at,NOW()) elapsed
         FROM shifts s
         JOIN users u ON u.id=s.cashier_id
         JOIN registers r ON r.id=s.register_id
         WHERE s.organization_id=? AND s.branch_id=? AND s.status='OPEN'
           AND TIMESTAMPDIFF(MINUTE,s.opened_at,NOW())>=?`,
        [org,branch,openMinutes],
      );
      for(const row of rows){
        openCandidates.push({
          organizationId:org,branchId:branch,dedupKey:key('SHIFT_OPEN_TOO_LONG',row.id),type:'SHIFT_OPEN_TOO_LONG',category:'SHIFT',severity:'WARNING',
          title:`Shift still open — ${row.register_name}`,
          message:`${row.cashier_name}'s shift has been open for ${row.elapsed} minutes.`,
          entityType:'shift',entityId:row.id,audienceType:'USER',audienceReference:String(row.cashier_id),
          metadata:{minutes:num(row.elapsed),configuredMinutes:openMinutes,secondaryRole:'FB_MANAGER'},
        });
      }
    }
    await this.sync(openCandidates,org,branch,'SHIFT_OPEN_TOO_LONG:');
  }

  private async stock(org:number,branch:number):Promise<void>{
    const [exists]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='stock_items'`,
    );
    if(Number(exists[0]?.count||0)===0) return;

    const [rows]=await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT id,name,current_quantity,low_threshold,critical_threshold
       FROM stock_items
       WHERE organization_id=? AND branch_id=? AND is_active=1`,
      [org,branch],
    );

    const low:AlertCandidate[]=[];
    const critical:AlertCandidate[]=[];
    const out:AlertCandidate[]=[];
    for(const row of rows){
      const quantity=num(row.current_quantity);
      if(quantity<=0){
        out.push({
          organizationId:org,branchId:branch,dedupKey:key('OUT_OF_STOCK',row.id),type:'OUT_OF_STOCK',category:'INVENTORY',severity:'CRITICAL',
          title:`${row.name} is out of stock`,message:`${row.name} has no stock available.`,entityType:'stock_item',entityId:row.id,
          audienceType:'PERMISSION_GROUP',audienceReference:'inventory:view',metadata:{quantity,secondaryRole:'FB_MANAGER'},
        });
      }else if(row.critical_threshold!=null&&quantity<=num(row.critical_threshold)){
        critical.push({
          organizationId:org,branchId:branch,dedupKey:key('CRITICAL_STOCK',row.id),type:'CRITICAL_STOCK',category:'INVENTORY',severity:'CRITICAL',
          title:`${row.name} is critically low`,message:`${quantity} remaining; critical level is ${num(row.critical_threshold)}.`,entityType:'stock_item',entityId:row.id,
          audienceType:'PERMISSION_GROUP',audienceReference:'inventory:view',metadata:{quantity,criticalThreshold:num(row.critical_threshold),secondaryRole:'FB_MANAGER'},
        });
      }else if(row.low_threshold!=null&&quantity<=num(row.low_threshold)){
        low.push({
          organizationId:org,branchId:branch,dedupKey:key('LOW_STOCK',row.id),type:'LOW_STOCK',category:'INVENTORY',severity:'WARNING',
          title:`${row.name} is running low`,message:`${quantity} remaining; low-stock level is ${num(row.low_threshold)}.`,entityType:'stock_item',entityId:row.id,
          audienceType:'PERMISSION_GROUP',audienceReference:'inventory:view',metadata:{quantity,lowThreshold:num(row.low_threshold),secondaryRole:'FB_MANAGER'},
        });
      }
    }
    await this.sync(low,org,branch,'LOW_STOCK:');
    await this.sync(critical,org,branch,'CRITICAL_STOCK:');
    await this.sync(out,org,branch,'OUT_OF_STOCK:');
  }
}

export const actionAlertEvaluator=new ActionAlertEvaluator();
