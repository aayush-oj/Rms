import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { Expense, ExpenseCategory, ExpenseSummary } from './types';

function iso(value: unknown): string | null { return value ? new Date(value as any).toISOString() : null; }
function dateOnly(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10); }
function mapCategory(row: RowDataPacket): ExpenseCategory {
  return {
    id:Number(row.id), organizationId:Number(row.organization_id), name:String(row.name),
    description:row.description==null?null:String(row.description), displayOrder:Number(row.display_order),
    isActive:Boolean(row.is_active), createdBy:Number(row.created_by), createdAt:new Date(row.created_at).toISOString(), updatedAt:new Date(row.updated_at).toISOString(),
  };
}
function mapExpense(row: RowDataPacket): Expense {
  return {
    id:Number(row.id), organizationId:Number(row.organization_id), branchId:Number(row.branch_id),
    businessDayId:Number(row.business_day_id), businessDate:dateOnly(row.business_date),
    shiftId:row.shift_id==null?null:Number(row.shift_id), registerId:row.register_id==null?null:Number(row.register_id), registerName:row.register_name==null?null:String(row.register_name),
    expenseCategoryId:Number(row.expense_category_id), categoryName:String(row.category_name),
    departmentId:row.department_id==null?null:Number(row.department_id), departmentName:row.department_name==null?null:String(row.department_name),
    paymentMethodId:Number(row.payment_method_id), paymentMethodName:String(row.payment_method_name), paymentMethodType:String(row.payment_method_type),
    cashMovementId:row.cash_movement_id==null?null:Number(row.cash_movement_id), reversalCashMovementId:row.reversal_cash_movement_id==null?null:Number(row.reversal_cash_movement_id),
    amount:Number(row.amount), reference:row.reference==null?null:String(row.reference), description:String(row.description), notes:row.notes==null?null:String(row.notes),
    expenseDate:dateOnly(row.expense_date), status:row.status, requestKey:row.request_key==null?null:String(row.request_key),
    createdBy:Number(row.created_by), createdByName:String(row.created_by_name || `User #${row.created_by}`), postedBy:row.posted_by==null?null:Number(row.posted_by), postedAt:iso(row.posted_at),
    voidedBy:row.voided_by==null?null:Number(row.voided_by), voidedAt:iso(row.voided_at), voidReason:row.void_reason==null?null:String(row.void_reason),
    createdAt:new Date(row.created_at).toISOString(), updatedAt:new Date(row.updated_at).toISOString(),
  };
}

const SELECT_EXPENSE = `SELECT e.*, bd.business_date, ec.name category_name, d.name department_name,
  pm.name payment_method_name, pm.type payment_method_type, r.name register_name, u.name created_by_name
  FROM expenses e
  JOIN business_days bd ON bd.id=e.business_day_id
  JOIN expense_categories ec ON ec.id=e.expense_category_id
  LEFT JOIN departments d ON d.id=e.department_id
  JOIN payment_methods pm ON pm.id=e.payment_method_id
  LEFT JOIN registers r ON r.id=e.register_id
  JOIN users u ON u.id=e.created_by`;

export class ExpenseRepository {
  private pool(){ return getDatabasePool(); }

  async listCategories(orgId:number): Promise<ExpenseCategory[]> {
    const [rows]=await this.pool().execute<RowDataPacket[]>('SELECT * FROM expense_categories WHERE organization_id=? ORDER BY display_order,name,id',[orgId]);
    return rows.map(mapCategory);
  }
  async createCategory(orgId:number,userId:number,input:any): Promise<ExpenseCategory> {
    const [dup]=await this.pool().execute<RowDataPacket[]>('SELECT id FROM expense_categories WHERE organization_id=? AND LOWER(name)=LOWER(?) LIMIT 1',[orgId,input.name]);
    if(dup.length) throw new ConflictError('Expense category already exists','EXPENSE_CATEGORY_DUPLICATE');
    const [result]=await this.pool().execute<ResultSetHeader>('INSERT INTO expense_categories (organization_id,name,description,display_order,is_active,created_by) VALUES (?,?,?,?,?,?)',[orgId,input.name,input.description??null,input.displayOrder??0,input.isActive===false?0:1,userId]);
    const [rows]=await this.pool().execute<RowDataPacket[]>('SELECT * FROM expense_categories WHERE id=? AND organization_id=?',[result.insertId,orgId]);
    return mapCategory(rows[0]);
  }
  async updateCategory(orgId:number,id:number,input:any): Promise<ExpenseCategory> {
    const [rows]=await this.pool().execute<RowDataPacket[]>('SELECT * FROM expense_categories WHERE id=? AND organization_id=?',[id,orgId]);
    if(!rows.length) throw new NotFoundError('Expense category not found','EXPENSE_CATEGORY_NOT_FOUND');
    const current=rows[0];
    const name=input.name??current.name;
    const [dup]=await this.pool().execute<RowDataPacket[]>('SELECT id FROM expense_categories WHERE organization_id=? AND LOWER(name)=LOWER(?) AND id<>? LIMIT 1',[orgId,name,id]);
    if(dup.length) throw new ConflictError('Expense category already exists','EXPENSE_CATEGORY_DUPLICATE');
    await this.pool().execute('UPDATE expense_categories SET name=?,description=?,display_order=?,is_active=?,updated_at=NOW() WHERE id=? AND organization_id=?',[name,input.description===undefined?current.description:input.description,input.displayOrder??current.display_order,input.isActive===undefined?current.is_active:input.isActive?1:0,id,orgId]);
    const [updated]=await this.pool().execute<RowDataPacket[]>('SELECT * FROM expense_categories WHERE id=?',[id]);
    return mapCategory(updated[0]);
  }

  private async validateRefs(conn:PoolConnection,orgId:number,branchId:number,input:any, requireOpenDay=false){
    const [cat]=await conn.execute<RowDataPacket[]>('SELECT id,is_active FROM expense_categories WHERE id=? AND organization_id=?',[input.expenseCategoryId,orgId]);
    if(!cat.length || !cat[0].is_active) throw new BadRequestError('Expense category is invalid or inactive','INVALID_EXPENSE_CATEGORY');
    const [day]=await conn.execute<RowDataPacket[]>(`SELECT * FROM business_days WHERE id=? AND organization_id=? AND branch_id=? ${requireOpenDay?'FOR UPDATE':''}`,[input.businessDayId,orgId,branchId]);
    if(!day.length) throw new BadRequestError('Business day is invalid for the active branch','INVALID_BUSINESS_DAY');
    if(requireOpenDay && day[0].status!=='OPEN') throw new ConflictError('Expense can only be posted to an open business day','BUSINESS_DAY_CLOSED');
    const [pm]=await conn.execute<RowDataPacket[]>('SELECT * FROM payment_methods WHERE id=? AND organization_id=? AND is_active=1 AND (branch_id IS NULL OR branch_id=?)',[input.paymentMethodId,orgId,branchId]);
    if(!pm.length) throw new BadRequestError('Payment method is invalid for the active branch','INVALID_PAYMENT_METHOD');
    if(input.departmentId!=null){
      const [dept]=await conn.execute<RowDataPacket[]>('SELECT id FROM departments WHERE id=? AND organization_id=? AND is_active=1 AND (branch_id IS NULL OR branch_id=?)',[input.departmentId,orgId,branchId]);
      if(!dept.length) throw new BadRequestError('Department is invalid for the active branch','INVALID_DEPARTMENT');
    }
    let shift:any=null;
    if(input.shiftId!=null){
      const [shifts]=await conn.execute<RowDataPacket[]>(`SELECT * FROM shifts WHERE id=? AND organization_id=? AND branch_id=? ${requireOpenDay?'FOR UPDATE':''}`,[input.shiftId,orgId,branchId]);
      if(!shifts.length) throw new BadRequestError('Shift is invalid for the active branch','INVALID_SHIFT');
      shift=shifts[0];
      if(Number(shift.business_day_id)!==Number(input.businessDayId)) throw new BadRequestError('Shift belongs to a different business day','SHIFT_BUSINESS_DAY_MISMATCH');
      if(requireOpenDay && shift.status!=='OPEN') throw new ConflictError('Closed shift cannot fund a cash expense','SHIFT_CLOSED');
    }
    if(pm[0].type==='CASH' && !shift) throw new ConflictError('Cash expenses require an active shift/register','ACTIVE_SHIFT_REQUIRED');
    return {day:day[0],paymentMethod:pm[0],shift};
  }

  async get(orgId:number,branchId:number,id:number,conn?:PoolConnection,forUpdate=false): Promise<Expense> {
    const runner=conn||this.pool();
    const [rows]=await runner.execute<RowDataPacket[]>(`${SELECT_EXPENSE} WHERE e.id=? AND e.organization_id=? AND e.branch_id=? ${forUpdate?'FOR UPDATE':''}`,[id,orgId,branchId]);
    if(!rows.length) throw new NotFoundError('Expense not found','EXPENSE_NOT_FOUND');
    return mapExpense(rows[0]);
  }

  async list(orgId:number,branchId:number,filters:any={}): Promise<Expense[]> {
    const clauses=['e.organization_id=?','e.branch_id=?']; const params:any[]=[orgId,branchId];
    if(filters.search){clauses.push('(e.description LIKE ? OR e.reference LIKE ? OR e.notes LIKE ?)'); const q=`%${filters.search}%`; params.push(q,q,q);}
    if(filters.status){clauses.push('e.status=?');params.push(filters.status);}
    if(filters.categoryId){clauses.push('e.expense_category_id=?');params.push(filters.categoryId);}
    if(filters.departmentId){clauses.push('e.department_id=?');params.push(filters.departmentId);}
    if(filters.paymentMethodId){clauses.push('e.payment_method_id=?');params.push(filters.paymentMethodId);}
    if(filters.businessDayId){clauses.push('e.business_day_id=?');params.push(filters.businessDayId);}
    if(filters.from){clauses.push('e.expense_date>=?');params.push(filters.from);}
    if(filters.to){clauses.push('e.expense_date<=?');params.push(filters.to);}
    const [rows]=await this.pool().execute<RowDataPacket[]>(`${SELECT_EXPENSE} WHERE ${clauses.join(' AND ')} ORDER BY e.expense_date DESC,e.id DESC LIMIT 1000`,params);
    return rows.map(mapExpense);
  }

  async summary(orgId:number,branchId:number,businessDayId?:number): Promise<ExpenseSummary> {
    const where=['e.organization_id=?','e.branch_id=?',"e.status='POSTED'"]; const params:any[]=[orgId,branchId];
    if(businessDayId){where.push('e.business_day_id=?');params.push(businessDayId);}
    const [totals]=await this.pool().execute<RowDataPacket[]>(`SELECT COALESCE(SUM(e.amount),0) total, COUNT(*) count,
      COALESCE(SUM(CASE WHEN pm.type='CASH' THEN e.amount ELSE 0 END),0) cash,
      COALESCE(SUM(CASE WHEN pm.type<>'CASH' THEN e.amount ELSE 0 END),0) non_cash
      FROM expenses e JOIN payment_methods pm ON pm.id=e.payment_method_id WHERE ${where.join(' AND ')}`,params);
    const [cats]=await this.pool().execute<RowDataPacket[]>(`SELECT ec.id category_id,ec.name category_name,COALESCE(SUM(e.amount),0) amount,COUNT(*) count
      FROM expenses e JOIN expense_categories ec ON ec.id=e.expense_category_id WHERE ${where.join(' AND ')} GROUP BY ec.id,ec.name ORDER BY amount DESC LIMIT 5`,params);
    return {total:Number(totals[0].total),cash:Number(totals[0].cash),nonCash:Number(totals[0].non_cash),count:Number(totals[0].count),topCategories:cats.map(r=>({categoryId:Number(r.category_id),categoryName:String(r.category_name),amount:Number(r.amount),count:Number(r.count)}))};
  }

  async create(orgId:number,branchId:number,userId:number,input:any): Promise<Expense> {
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      if(input.requestKey){
        const [existing]=await conn.execute<RowDataPacket[]>('SELECT id FROM expenses WHERE organization_id=? AND request_key=? LIMIT 1',[orgId,input.requestKey]);
        if(existing.length){await conn.commit(); return this.get(orgId,branchId,Number(existing[0].id));}
      }
      await this.validateRefs(conn,orgId,branchId,input,false);
      const [result]=await conn.execute<ResultSetHeader>(`INSERT INTO expenses
        (organization_id,branch_id,business_day_id,shift_id,expense_category_id,department_id,payment_method_id,amount,reference,description,notes,expense_date,status,request_key,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT',?,?)`,[orgId,branchId,input.businessDayId,input.shiftId??null,input.expenseCategoryId,input.departmentId??null,input.paymentMethodId,input.amount,input.reference??null,input.description,input.notes??null,dateOnly(input.expenseDate),input.requestKey??null,userId]);
      await conn.commit(); return this.get(orgId,branchId,result.insertId);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async update(orgId:number,branchId:number,id:number,input:any): Promise<Expense> {
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const current=await this.get(orgId,branchId,id,conn,true);
      if(current.status!=='DRAFT') throw new ConflictError('Only draft expenses can be edited','EXPENSE_NOT_EDITABLE');
      const merged={businessDayId:input.businessDayId??current.businessDayId,shiftId:input.shiftId===undefined?current.shiftId:input.shiftId,expenseCategoryId:input.expenseCategoryId??current.expenseCategoryId,departmentId:input.departmentId===undefined?current.departmentId:input.departmentId,paymentMethodId:input.paymentMethodId??current.paymentMethodId};
      await this.validateRefs(conn,orgId,branchId,merged,false);
      await conn.execute(`UPDATE expenses SET business_day_id=?,shift_id=?,expense_category_id=?,department_id=?,payment_method_id=?,amount=?,reference=?,description=?,notes=?,expense_date=?,updated_at=NOW() WHERE id=? AND organization_id=? AND branch_id=?`,[
        merged.businessDayId,merged.shiftId,merged.expenseCategoryId,merged.departmentId,merged.paymentMethodId,input.amount??current.amount,input.reference===undefined?current.reference:input.reference,input.description??current.description,input.notes===undefined?current.notes:input.notes,input.expenseDate?dateOnly(input.expenseDate):current.expenseDate,id,orgId,branchId]);
      await conn.commit(); return this.get(orgId,branchId,id);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async post(orgId:number,branchId:number,id:number,userId:number): Promise<Expense> {
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const current=await this.get(orgId,branchId,id,conn,true);
      if(current.status==='POSTED'){await conn.commit();return current;}
      if(current.status!=='DRAFT') throw new ConflictError('Only draft expenses can be posted','EXPENSE_NOT_POSTABLE');
      const refs=await this.validateRefs(conn,orgId,branchId,current,true);
      let cashMovementId:number|null=null; let registerId:number|null=current.registerId;
      if(refs.paymentMethod.type==='CASH'){
        const shift=refs.shift;
        if(!shift) throw new ConflictError('Cash expenses require an active shift/register','ACTIVE_SHIFT_REQUIRED');
        registerId=Number(shift.register_id);
        const [movement]=await conn.execute<ResultSetHeader>(`INSERT INTO cash_movements (organization_id,branch_id,business_day_id,shift_id,register_id,movement_type,amount,reason,notes,performed_by)
          VALUES (?,?,?,?,?,'CASH_OUT',?,?,?,?)`,[orgId,branchId,current.businessDayId,current.shiftId,registerId,current.amount,`Expense #${current.id}: ${current.description}`,current.reference?`Reference: ${current.reference}`:null,userId]);
        cashMovementId=movement.insertId;
      }
      await conn.execute(`UPDATE expenses SET status='POSTED',register_id=?,cash_movement_id=?,posted_by=?,posted_at=NOW(),updated_at=NOW() WHERE id=? AND organization_id=? AND branch_id=?`,[registerId,cashMovementId,userId,id,orgId,branchId]);
      await conn.commit(); return this.get(orgId,branchId,id);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }

  async void(orgId:number,branchId:number,id:number,userId:number,reason:string): Promise<Expense> {
    const conn=await this.pool().getConnection();
    try{
      await conn.beginTransaction();
      const current=await this.get(orgId,branchId,id,conn,true);
      if(current.status==='VOIDED'){await conn.commit();return current;}
      if(current.status!=='POSTED') throw new ConflictError('Only posted expenses can be voided','EXPENSE_NOT_VOIDABLE');
      let reversalId:number|null=null;
      if(current.cashMovementId!=null){
        if(current.shiftId==null || current.registerId==null) throw new ConflictError('Cash expense is missing shift/register linkage','EXPENSE_CASH_LINK_INVALID');
        const [shift]=await conn.execute<RowDataPacket[]>('SELECT status FROM shifts WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE',[current.shiftId,orgId,branchId]);
        if(!shift.length) throw new ConflictError('Linked shift no longer exists','SHIFT_NOT_FOUND');
        if(shift[0].status!=='OPEN') throw new ConflictError('A cash expense cannot be voided after its shift is closed; use an explicit later correction workflow','SHIFT_CLOSED');
        const [movement]=await conn.execute<ResultSetHeader>(`INSERT INTO cash_movements (organization_id,branch_id,business_day_id,shift_id,register_id,movement_type,amount,reason,notes,performed_by)
          VALUES (?,?,?,?,?,'CASH_IN',?,?,?,?)`,[orgId,branchId,current.businessDayId,current.shiftId,current.registerId,current.amount,`Void reversal for expense #${current.id}`,reason,userId]);
        reversalId=movement.insertId;
      }
      await conn.execute(`UPDATE expenses SET status='VOIDED',reversal_cash_movement_id=?,voided_by=?,voided_at=NOW(),void_reason=?,updated_at=NOW() WHERE id=? AND organization_id=? AND branch_id=?`,[reversalId,userId,reason,id,orgId,branchId]);
      await conn.commit(); return this.get(orgId,branchId,id);
    }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
}

export const expenseRepository=new ExpenseRepository();
