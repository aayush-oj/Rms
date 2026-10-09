import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { MenuStockAvailability, StockItem, StockMovement, StockStatus } from './types';

const iso=(value:any)=>value instanceof Date?value.toISOString():String(value);
const nullableNumber=(value:any)=>value==null?null:Number(value);

function stockStatus(quantity:number,low:number|null,critical:number|null):StockStatus{
  if(quantity<=0) return 'OUT_OF_STOCK';
  if(critical!=null&&quantity<=critical) return 'CRITICAL';
  if(low!=null&&quantity<=low) return 'LOW';
  return 'IN_STOCK';
}

function mapItem(row:RowDataPacket):StockItem{
  const current=Number(row.current_quantity||0);
  const low=nullableNumber(row.low_threshold);
  const critical=nullableNumber(row.critical_threshold);
  return {
    id:Number(row.id),organizationId:Number(row.organization_id),branchId:Number(row.branch_id),name:String(row.name),
    imageUrl:row.image_url==null?null:String(row.image_url),currentQuantity:current,
    packageName:row.package_name==null?null:String(row.package_name),packageSize:nullableNumber(row.package_size),
    lowThreshold:low,criticalThreshold:critical,status:stockStatus(current,low,critical),isActive:Boolean(row.is_active),
    usedByCount:Number(row.used_by_count||0),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),
  };
}

function mapMovement(row:RowDataPacket):StockMovement{
  return {
    id:Number(row.id),stockItemId:Number(row.stock_item_id),stockItemName:String(row.stock_item_name),movementType:row.movement_type,
    quantityDelta:Number(row.quantity_delta),beforeQuantity:Number(row.before_quantity),afterQuantity:Number(row.after_quantity),
    packageCount:nullableNumber(row.package_count),looseCount:nullableNumber(row.loose_count),reason:row.reason==null?null:String(row.reason),
    orderId:nullableNumber(row.order_id),orderItemId:nullableNumber(row.order_item_id),referenceType:row.reference_type==null?null:String(row.reference_type),
    referenceId:nullableNumber(row.reference_id),performedBy:Number(row.performed_by),createdAt:iso(row.created_at),
  };
}

export class StockRepository {
  private pool(){return getDatabasePool();}

  async listItems(org:number,branch:number):Promise<StockItem[]>{
    const [rows]=await this.pool().execute<RowDataPacket[]>(
      `SELECT s.*,(SELECT COUNT(*) FROM stock_dependencies d WHERE d.organization_id=s.organization_id AND d.branch_id=s.branch_id AND d.stock_item_id=s.id) used_by_count
       FROM stock_items s WHERE s.organization_id=? AND s.branch_id=? ORDER BY s.name`,
      [org,branch],
    );
    return rows.map(mapItem);
  }

  async getItem(id:number,org:number,branch:number):Promise<StockItem|null>{
    const [rows]=await this.pool().execute<RowDataPacket[]>(
      `SELECT s.*,(SELECT COUNT(*) FROM stock_dependencies d WHERE d.organization_id=s.organization_id AND d.branch_id=s.branch_id AND d.stock_item_id=s.id) used_by_count
       FROM stock_items s WHERE s.id=? AND s.organization_id=? AND s.branch_id=?`,
      [id,org,branch],
    );
    return rows.length?mapItem(rows[0]):null;
  }

  async createItem(org:number,branch:number,userId:number,input:any):Promise<StockItem>{
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const initial=Number(input.initialQuantity||0);
      const [insert]=await conn.execute<ResultSetHeader>(
        `INSERT INTO stock_items(organization_id,branch_id,name,image_url,current_quantity,package_name,package_size,low_threshold,critical_threshold,is_active,created_by,updated_by)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [org,branch,input.name,input.imageUrl??null,initial,input.packageName??null,input.packageSize??null,input.lowThreshold??null,input.criticalThreshold??null,input.isActive!==false,userId,userId],
      );
      if(initial>0){
        await conn.execute(
          `INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,reference_type,performed_by)
           VALUES(?,?,?,'STOCK_IN',?,0,?,'Opening stock','STOCK_ITEM_CREATE',?)`,
          [org,branch,insert.insertId,initial,initial,userId],
        );
      }
      await conn.commit();
      const created=await this.getItem(insert.insertId,org,branch);
      if(!created) throw new NotFoundError('Created stock item not found','STOCK_ITEM_NOT_FOUND');
      return created;
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }

  async updateItem(id:number,org:number,branch:number,userId:number,input:any):Promise<StockItem>{
    const current=await this.getItem(id,org,branch);
    if(!current) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');
    const nextPackageName=Object.prototype.hasOwnProperty.call(input,'packageName')?input.packageName:current.packageName;
    const nextPackageSize=Object.prototype.hasOwnProperty.call(input,'packageSize')?input.packageSize:current.packageSize;
    if(Boolean(nextPackageName)!==(nextPackageSize!=null)) throw new BadRequestError('Package name and size must be configured together','INVALID_STOCK_PACKAGE');
    const nextLow=Object.prototype.hasOwnProperty.call(input,'lowThreshold')?input.lowThreshold:current.lowThreshold;
    const nextCritical=Object.prototype.hasOwnProperty.call(input,'criticalThreshold')?input.criticalThreshold:current.criticalThreshold;
    if(nextLow!=null&&nextCritical!=null&&Number(nextCritical)>Number(nextLow)) throw new BadRequestError('Critical level must be less than or equal to low level','INVALID_STOCK_THRESHOLD');

    const fields:Record<string,string>={name:'name',imageUrl:'image_url',packageName:'package_name',packageSize:'package_size',lowThreshold:'low_threshold',criticalThreshold:'critical_threshold',isActive:'is_active'};
    const sets:string[]=[];const params:any[]=[];
    for(const [key,column] of Object.entries(fields)) if(Object.prototype.hasOwnProperty.call(input,key)){sets.push(`${column}=?`);params.push(input[key]);}
    if(sets.length) await this.pool().execute(`UPDATE stock_items SET ${sets.join(',')},updated_by=?,updated_at=NOW() WHERE id=? AND organization_id=? AND branch_id=?`,[...params,userId,id,org,branch]);
    const updated=await this.getItem(id,org,branch);
    if(!updated) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');
    return updated;
  }

  async stockIn(id:number,org:number,branch:number,userId:number,input:{quantity:number;packageCount:number;looseCount:number;reason?:string|null}):Promise<StockItem>{
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const [rows]=await conn.execute<RowDataPacket[]>(`SELECT * FROM stock_items WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,[id,org,branch]);
      if(!rows.length) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');
      const row=rows[0];
      if(!Boolean(row.is_active)) throw new ConflictError('Inactive stock items cannot receive stock','STOCK_ITEM_INACTIVE');
      const packageCount=Number(input.packageCount||0),looseCount=Number(input.looseCount||0),direct=Number(input.quantity||0);
      if(packageCount>0&&row.package_size==null) throw new BadRequestError('This stock item has no package conversion configured','STOCK_PACKAGE_NOT_CONFIGURED');
      const total=direct+looseCount+(packageCount*Number(row.package_size||0));
      if(total<=0) throw new BadRequestError('Stock-in quantity must be greater than zero','INVALID_STOCK_QUANTITY');
      const before=Number(row.current_quantity),after=before+total;
      await conn.execute(`UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,[after,userId,id]);
      await conn.execute(
        `INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,package_count,loose_count,reason,reference_type,performed_by)
         VALUES(?,?,?,'STOCK_IN',?,?,?,?,?,?, 'STOCK_IN',?)`,
        [org,branch,id,total,before,after,packageCount||null,looseCount||null,input.reason??null,userId],
      );
      await conn.commit();
      const updated=await this.getItem(id,org,branch);
      if(!updated) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');
      return updated;
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }

  async adjust(id:number,org:number,branch:number,userId:number,newQuantity:number,reason:string):Promise<StockItem>{
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const [rows]=await conn.execute<RowDataPacket[]>(`SELECT * FROM stock_items WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,[id,org,branch]);
      if(!rows.length) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');
      const before=Number(rows[0].current_quantity),after=Number(newQuantity),delta=after-before;
      if(delta===0) throw new BadRequestError('Stock quantity is already at that value','STOCK_NO_CHANGE');
      await conn.execute(`UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,[after,userId,id]);
      await conn.execute(
        `INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,reference_type,performed_by)
         VALUES(?,?,?,'ADJUSTMENT',?,?,?,?, 'MANUAL_ADJUSTMENT',?)`,
        [org,branch,id,delta,before,after,reason,userId],
      );
      await conn.commit();
      const updated=await this.getItem(id,org,branch);
      if(!updated) throw new NotFoundError('Stock item not found','STOCK_ITEM_NOT_FOUND');
      return updated;
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }

  async setDependencies(menuItemId:number,org:number,branch:number,userId:number,dependencies:Array<{stockItemId:number;quantityRequired:number}>):Promise<void>{
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const [menu]=await conn.execute<RowDataPacket[]>(`SELECT id FROM menu_items WHERE id=? AND organization_id=? FOR UPDATE`,[menuItemId,org]);
      if(!menu.length) throw new NotFoundError('Menu item not found','MENU_ITEM_NOT_FOUND');
      if(dependencies.length){
        const ids=dependencies.map((dependency)=>dependency.stockItemId);
        const [items]=await conn.execute<RowDataPacket[]>(
          `SELECT id FROM stock_items WHERE organization_id=? AND branch_id=? AND is_active=1 AND id IN (${ids.map(()=>'?').join(',')}) FOR UPDATE`,
          [org,branch,...ids],
        );
        if(items.length!==new Set(ids).size) throw new BadRequestError('One or more stock items are missing or inactive','INVALID_STOCK_DEPENDENCY');
      }
      await conn.execute(`DELETE FROM stock_dependencies WHERE organization_id=? AND branch_id=? AND menu_item_id=?`,[org,branch,menuItemId]);
      for(const dependency of dependencies){
        await conn.execute(
          `INSERT INTO stock_dependencies(organization_id,branch_id,menu_item_id,stock_item_id,quantity_required,created_by) VALUES(?,?,?,?,?,?)`,
          [org,branch,menuItemId,dependency.stockItemId,dependency.quantityRequired,userId],
        );
      }
      await conn.commit();
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }

  async dependenciesForMenu(menuItemId:number,org:number,branch:number){
    const [rows]=await this.pool().execute<RowDataPacket[]>(
      `SELECT d.menu_item_id,mi.name menu_item_name,d.stock_item_id,s.name stock_item_name,d.quantity_required
       FROM stock_dependencies d JOIN menu_items mi ON mi.id=d.menu_item_id JOIN stock_items s ON s.id=d.stock_item_id
       WHERE d.organization_id=? AND d.branch_id=? AND d.menu_item_id=? ORDER BY s.name`,
      [org,branch,menuItemId],
    );
    return rows.map((row)=>({menuItemId:Number(row.menu_item_id),menuItemName:String(row.menu_item_name),stockItemId:Number(row.stock_item_id),stockItemName:String(row.stock_item_name),quantityRequired:Number(row.quantity_required)}));
  }

  async availability(org:number,branch:number):Promise<MenuStockAvailability[]>{
    const [rows]=await this.pool().execute<RowDataPacket[]>(
      `SELECT d.menu_item_id,d.stock_item_id,d.quantity_required,s.name stock_item_name,s.current_quantity,s.is_active
       FROM stock_dependencies d JOIN stock_items s ON s.id=d.stock_item_id
       WHERE d.organization_id=? AND d.branch_id=? ORDER BY d.menu_item_id,d.stock_item_id`,
      [org,branch],
    );
    const grouped=new Map<number,RowDataPacket[]>();
    for(const row of rows){const id=Number(row.menu_item_id);const group=grouped.get(id)||[];group.push(row);grouped.set(id,group)}

    const result:MenuStockAvailability[]=[...grouped.entries()].map(([menuItemId,dependencies])=>{
      const shortages=dependencies.filter((row)=>!Boolean(row.is_active)||Number(row.current_quantity)<Number(row.quantity_required)).map((row)=>({stockItemId:Number(row.stock_item_id),stockItemName:String(row.stock_item_name),required:Number(row.quantity_required),available:Boolean(row.is_active)?Number(row.current_quantity):0}));
      const max=dependencies.reduce((current,row)=>Math.min(current,Boolean(row.is_active)?Math.floor(Number(row.current_quantity)/Number(row.quantity_required)):0),Number.MAX_SAFE_INTEGER);
      return {menuItemId,tracked:true,available:shortages.length===0,maxOrderQuantity:Number.isFinite(max)?max:0,shortages};
    });

    const [comboRows]=await this.pool().execute<RowDataPacket[]>(
      `SELECT cc.combo_menu_item_id,cc.quantity component_quantity,
              d.stock_item_id,d.quantity_required,s.name stock_item_name,s.current_quantity,s.is_active
         FROM menu_combo_components cc
         JOIN stock_dependencies d
           ON d.organization_id=cc.organization_id
          AND d.branch_id=?
          AND d.menu_item_id=cc.component_menu_item_id
         JOIN stock_items s ON s.id=d.stock_item_id
        WHERE cc.organization_id=?
        ORDER BY cc.combo_menu_item_id,s.id`,
      [branch,org],
    );
    const comboGrouped=new Map<number,Map<number,{stockItemId:number;stockItemName:string;required:number;available:number;active:boolean}>>();
    for(const row of comboRows){
      const comboId=Number(row.combo_menu_item_id);
      const stockId=Number(row.stock_item_id);
      const byStock=comboGrouped.get(comboId)||new Map();
      const existing=byStock.get(stockId);
      const required=Number(row.component_quantity)*Number(row.quantity_required);
      if(existing) existing.required+=required;
      else byStock.set(stockId,{stockItemId:stockId,stockItemName:String(row.stock_item_name),required,available:Number(row.current_quantity),active:Boolean(row.is_active)});
      comboGrouped.set(comboId,byStock);
    }
    for(const [menuItemId,byStock] of comboGrouped){
      const dependencies=[...byStock.values()];
      const shortages=dependencies
        .filter((row)=>!row.active||row.available<row.required)
        .map((row)=>({stockItemId:row.stockItemId,stockItemName:row.stockItemName,required:row.required,available:row.active?row.available:0}));
      const max=dependencies.reduce((current,row)=>Math.min(current,row.active?Math.floor(row.available/row.required):0),Number.MAX_SAFE_INTEGER);
      const existingIndex=result.findIndex((entry)=>entry.menuItemId===menuItemId);
      const comboAvailability={menuItemId,tracked:true,available:shortages.length===0,maxOrderQuantity:Number.isFinite(max)?max:0,shortages};
      if(existingIndex>=0) result[existingIndex]=comboAvailability;
      else result.push(comboAvailability);
    }
    return result;
  }

  async movements(org:number,branch:number,filters:{stockItemId?:number;movementType?:string;limit:number;offset:number}):Promise<{items:StockMovement[];total:number}>{
    const clauses=['m.organization_id=?','m.branch_id=?'];const params:any[]=[org,branch];
    if(filters.stockItemId){clauses.push('m.stock_item_id=?');params.push(filters.stockItemId)}
    if(filters.movementType){clauses.push('m.movement_type=?');params.push(filters.movementType)}
    const where=clauses.join(' AND ');
    const [count]=await this.pool().execute<RowDataPacket[]>(`SELECT COUNT(*) total FROM stock_movements m WHERE ${where}`,params);
    const [rows]=await this.pool().execute<RowDataPacket[]>(
      `SELECT m.*,s.name stock_item_name FROM stock_movements m JOIN stock_items s ON s.id=m.stock_item_id
       WHERE ${where} ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`,
      [...params,filters.limit,filters.offset],
    );
    return {items:rows.map(mapMovement),total:Number(count[0]?.total||0)};
  }

  async consumeOrderItemInTransaction(conn:PoolConnection,org:number,branch:number,orderId:number,orderItemId:number,menuItemId:number,orderQuantity:number,userId:number):Promise<void>{
    const [deps]=await conn.execute<RowDataPacket[]>(
      `SELECT d.stock_item_id,d.quantity_required,s.name,s.current_quantity,s.is_active
       FROM stock_dependencies d JOIN stock_items s ON s.id=d.stock_item_id
       WHERE d.organization_id=? AND d.branch_id=? AND d.menu_item_id=?
       ORDER BY s.id FOR UPDATE`,
      [org,branch,menuItemId],
    );
    for(const dependency of deps){
      const required=Number(dependency.quantity_required)*orderQuantity;
      const before=Number(dependency.current_quantity);
      if(!Boolean(dependency.is_active)||before<required){
        throw new ConflictError(`${dependency.name} does not have enough stock for this order`,'STOCK_INSUFFICIENT',{stockItemId:Number(dependency.stock_item_id),stockItemName:String(dependency.name),required,available:Boolean(dependency.is_active)?before:0,menuItemId});
      }
      const after=before-required;
      await conn.execute(`UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,[after,userId,dependency.stock_item_id]);
      await conn.execute(
        `INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,order_id,order_item_id,reference_type,reference_id,performed_by)
         VALUES(?,?,?,'SALE',?,?,?,?,?,?, 'ORDER_ITEM',?,?)`,
        [org,branch,dependency.stock_item_id,-required,before,after,'Order stock consumption',orderId,orderItemId,orderItemId,userId],
      );
    }
  }

  async reverseOrderItemsInTransaction(
    conn:PoolConnection,
    org:number,
    branch:number,
    orderId:number,
    orderItemIds:number[],
    userId:number,
    reason:string,
  ):Promise<void>{
    const uniqueIds=[...new Set(orderItemIds.filter((id)=>Number.isInteger(id)&&id>0))];
    if(!uniqueIds.length) return;
    const placeholders=uniqueIds.map(()=>'?').join(',');
    const [movements]=await conn.execute<RowDataPacket[]>(
      `SELECT m.* FROM stock_movements m
       LEFT JOIN stock_movements reversal ON reversal.reverses_movement_id=m.id AND reversal.movement_type='CANCELLATION_RETURN'
       WHERE m.organization_id=? AND m.branch_id=? AND m.order_id=? AND m.movement_type='SALE'
         AND m.order_item_id IN (${placeholders}) AND reversal.id IS NULL
       ORDER BY m.stock_item_id,m.id FOR UPDATE`,
      [org,branch,orderId,...uniqueIds],
    );
    for(const movement of movements){
      const [items]=await conn.execute<RowDataPacket[]>(
        `SELECT current_quantity FROM stock_items WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,
        [movement.stock_item_id,org,branch],
      );
      if(!items.length) continue;
      const returned=Math.abs(Number(movement.quantity_delta));
      const before=Number(items[0].current_quantity),after=before+returned;
      await conn.execute(
        `UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,
        [after,userId,movement.stock_item_id],
      );
      await conn.execute(
        `INSERT INTO stock_movements
          (organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,
           order_id,order_item_id,reference_type,reference_id,reverses_movement_id,performed_by)
         VALUES(?,?,?,'CANCELLATION_RETURN',?,?,?,?,?,?,'ORDER_ROUND_CANCELLATION',?,?,?)`,
        [org,branch,movement.stock_item_id,returned,before,after,reason,orderId,movement.order_item_id,movement.order_item_id,movement.id,userId],
      );
    }
  }

  async reverseOrderInTransaction(conn:PoolConnection,org:number,branch:number,orderId:number,userId:number,reason:string):Promise<void>{
    const [movements]=await conn.execute<RowDataPacket[]>(
      `SELECT m.* FROM stock_movements m
       LEFT JOIN stock_movements reversal ON reversal.reverses_movement_id=m.id AND reversal.movement_type='CANCELLATION_RETURN'
       WHERE m.organization_id=? AND m.branch_id=? AND m.order_id=? AND m.movement_type='SALE' AND reversal.id IS NULL
       ORDER BY m.stock_item_id,m.id FOR UPDATE`,
      [org,branch,orderId],
    );
    for(const movement of movements){
      const [items]=await conn.execute<RowDataPacket[]>(`SELECT current_quantity FROM stock_items WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,[movement.stock_item_id,org,branch]);
      if(!items.length) continue;
      const returned=Math.abs(Number(movement.quantity_delta));
      const before=Number(items[0].current_quantity),after=before+returned;
      await conn.execute(`UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,[after,userId,movement.stock_item_id]);
      await conn.execute(
        `INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,order_id,order_item_id,reference_type,reference_id,reverses_movement_id,performed_by)
         VALUES(?,?,?,'CANCELLATION_RETURN',?,?,?,?,?,?, 'ORDER_CANCELLATION',?,?,?)`,
        [org,branch,movement.stock_item_id,returned,before,after,reason,orderId,movement.order_item_id,orderId,movement.id,userId],
      );
    }
  }

  async transfer(org:number,sourceBranch:number,userId:number,input:{sourceStockItemId:number;destinationBranchId:number;destinationStockItemId:number;quantity:number;note?:string|null}):Promise<void>{
    if(sourceBranch===input.destinationBranchId) throw new BadRequestError('Source and destination branches must be different','INVALID_STOCK_TRANSFER');
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const ordered=[{id:input.sourceStockItemId,branch:sourceBranch},{id:input.destinationStockItemId,branch:input.destinationBranchId}].sort((a,b)=>a.id-b.id);
      const locked=new Map<number,RowDataPacket>();
      for(const target of ordered){
        const [rows]=await conn.execute<RowDataPacket[]>(`SELECT * FROM stock_items WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,[target.id,org,target.branch]);
        if(!rows.length) throw new NotFoundError('Stock item not found in transfer scope','STOCK_ITEM_NOT_FOUND');
        locked.set(target.id,rows[0]);
      }
      const source=locked.get(input.sourceStockItemId)!;const destination=locked.get(input.destinationStockItemId)!;
      const quantity=Number(input.quantity),sourceBefore=Number(source.current_quantity);
      if(sourceBefore<quantity) throw new ConflictError('Not enough stock to transfer','STOCK_INSUFFICIENT',{required:quantity,available:sourceBefore});
      const sourceAfter=sourceBefore-quantity,destinationBefore=Number(destination.current_quantity),destinationAfter=destinationBefore+quantity;
      await conn.execute(`UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,[sourceAfter,userId,input.sourceStockItemId]);
      await conn.execute(`UPDATE stock_items SET current_quantity=?,updated_by=?,updated_at=NOW() WHERE id=?`,[destinationAfter,userId,input.destinationStockItemId]);
      const [transfer]=await conn.execute<ResultSetHeader>(
        `INSERT INTO stock_transfers(organization_id,source_branch_id,destination_branch_id,source_stock_item_id,destination_stock_item_id,quantity,note,performed_by) VALUES(?,?,?,?,?,?,?,?)`,
        [org,sourceBranch,input.destinationBranchId,input.sourceStockItemId,input.destinationStockItemId,quantity,input.note??null,userId],
      );
      await conn.execute(`INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,reference_type,reference_id,performed_by) VALUES(?,?,?,'TRANSFER_OUT',?,?,?,?, 'STOCK_TRANSFER',?,?)`,[org,sourceBranch,input.sourceStockItemId,-quantity,sourceBefore,sourceAfter,input.note??null,transfer.insertId,userId]);
      await conn.execute(`INSERT INTO stock_movements(organization_id,branch_id,stock_item_id,movement_type,quantity_delta,before_quantity,after_quantity,reason,reference_type,reference_id,performed_by) VALUES(?,?,?,'TRANSFER_IN',?,?,?,?, 'STOCK_TRANSFER',?,?)`,[org,input.destinationBranchId,input.destinationStockItemId,quantity,destinationBefore,destinationAfter,input.note??null,transfer.insertId,userId]);
      await conn.commit();
    }catch(error){await conn.rollback();throw error}finally{conn.release()}
  }
}

export const stockRepository=new StockRepository();
