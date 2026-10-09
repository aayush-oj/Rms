import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { BusinessDay, CashMovement, Register, Shift } from './types';

const EPSILON = 0.0001;
const money = (value: number) => Math.round(value * 10000) / 10000;

function mapBusinessDay(row: RowDataPacket): BusinessDay {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), businessDate: String(row.business_date),
    status: row.status, openedAt: new Date(row.opened_at).toISOString(), openedBy: Number(row.opened_by),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null, closedBy: row.closed_by == null ? null : Number(row.closed_by),
    notes: row.notes == null ? null : String(row.notes), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapRegister(row: RowDataPacket): Register {
  return { id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), name: String(row.name), code: String(row.code), isActive: Boolean(row.is_active), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

function mapShift(row: RowDataPacket): Shift {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), businessDayId: Number(row.business_day_id),
    registerId: Number(row.register_id), cashierId: Number(row.cashier_id), openedAt: new Date(row.opened_at).toISOString(), closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    status: row.status, openingCash: Number(row.opening_cash), expectedCash: row.expected_cash == null ? null : Number(row.expected_cash), countedCash: row.counted_cash == null ? null : Number(row.counted_cash),
    variance: row.variance == null ? null : Number(row.variance), varianceStatus: row.variance_status == null ? null : row.variance_status,
    notes: row.notes == null ? null : String(row.notes), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapCashMovement(row: RowDataPacket): CashMovement {
  return { id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), businessDayId: Number(row.business_day_id), shiftId: Number(row.shift_id), registerId: Number(row.register_id), movementType: row.movement_type, amount: Number(row.amount), reason: String(row.reason), notes: row.notes == null ? null : String(row.notes), performedBy: Number(row.performed_by), createdAt: new Date(row.created_at).toISOString() };
}

export class ShiftRepository {
  private pool() { return getDatabasePool(); }

  async branchTimezone(orgId: number, branchId: number): Promise<string> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT timezone FROM branches WHERE id = ? AND organization_id = ?', [branchId, orgId]);
    if (!rows.length) throw new NotFoundError('Branch not found', 'BRANCH_NOT_FOUND');
    return String(rows[0].timezone || 'Asia/Kathmandu');
  }

  async getBusinessDate(orgId: number, branchId: number): Promise<string> {
    const timezone = await this.branchTimezone(orgId, branchId);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (type: string) => parts.find(part => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  async getCurrentBusinessDay(orgId: number, branchId: number, conn?: PoolConnection): Promise<BusinessDay | null> {
    const runner = conn || this.pool();
    const [rows] = await runner.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE organization_id = ? AND branch_id = ? AND status = \'OPEN\' LIMIT 1', [orgId, branchId]);
    return rows.length ? mapBusinessDay(rows[0]) : null;
  }

  async listBusinessDays(orgId: number, branchId: number, conn?: PoolConnection): Promise<BusinessDay[]> {
    const runner = conn || this.pool();
    const [rows] = await runner.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE organization_id = ? AND branch_id = ? ORDER BY business_date DESC, id DESC LIMIT 200', [orgId, branchId]);
    return rows.map(mapBusinessDay);
  }

  async getBusinessDay(id: number, orgId: number, branchId: number, conn?: PoolConnection): Promise<BusinessDay | null> {
    const runner = conn || this.pool();
    const [rows] = await runner.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE id = ? AND organization_id = ? AND branch_id = ?', [id, orgId, branchId]);
    return rows.length ? mapBusinessDay(rows[0]) : null;
  }

  async openBusinessDay(orgId: number, branchId: number, openedBy: number, notes?: string): Promise<BusinessDay> {
    const businessDate = await this.getBusinessDate(orgId, branchId);
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [branch] = await conn.execute<RowDataPacket[]>('SELECT id, is_active FROM branches WHERE id = ? AND organization_id = ? FOR UPDATE', [branchId, orgId]);
      if (!branch.length || !branch[0].is_active) throw new NotFoundError('Branch not found or inactive', 'BRANCH_NOT_FOUND');
      const [openRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE organization_id = ? AND branch_id = ? AND status = \'OPEN\' FOR UPDATE', [orgId, branchId]);
      if (openRows.length) throw new ConflictError('A business day is already open for this branch', 'BUSINESS_DAY_ALREADY_OPEN');
      const [sameDate] = await conn.execute<RowDataPacket[]>('SELECT id FROM business_days WHERE organization_id = ? AND branch_id = ? AND business_date = ? LIMIT 1', [orgId, branchId, businessDate]);
      if (sameDate.length) throw new ConflictError(`Business date ${businessDate} has already been closed and cannot be reopened`, 'BUSINESS_DAY_ALREADY_CLOSED');
      const [result] = await conn.execute<ResultSetHeader>('INSERT INTO business_days (organization_id, branch_id, business_date, status, opened_by, notes) VALUES (?, ?, ?, \'OPEN\', ?, ?)', [orgId, branchId, businessDate, openedBy, notes || null]);
      const [created] = await conn.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE id = ? FOR UPDATE', [result.insertId]);
      await conn.commit();
      return mapBusinessDay(created[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async closeBusinessDay(id: number, orgId: number, branchId: number, closedBy: number, notes?: string): Promise<BusinessDay> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [id, orgId, branchId]);
      if (!rows.length) throw new NotFoundError('Business day not found', 'BUSINESS_DAY_NOT_FOUND');
      const day = rows[0];
      if (day.status !== 'OPEN') throw new ConflictError('Business day is already closed', 'BUSINESS_DAY_ALREADY_CLOSED');
      const [openShifts] = await conn.execute<RowDataPacket[]>('SELECT id FROM shifts WHERE business_day_id = ? AND organization_id = ? AND branch_id = ? AND status = \'OPEN\' LIMIT 1', [id, orgId, branchId]);
      if (openShifts.length) throw new ConflictError('All cashier shifts must be closed before the business day can close', 'OPEN_SHIFTS_BLOCK_CLOSE');
      const [unsettledBills] = await conn.execute<RowDataPacket[]>(`SELECT id FROM bills WHERE business_day_id = ? AND organization_id = ? AND branch_id = ? AND status = 'FINALIZED' AND balance_due > ? LIMIT 1`, [id, orgId, branchId, EPSILON]);
      if (unsettledBills.length) throw new ConflictError('Outstanding finalized bills must be settled before closing the business day', 'OUTSTANDING_BILL_BLOCK_CLOSE');
      const [activeOrders] = await conn.execute<RowDataPacket[]>(`SELECT id FROM orders WHERE business_day_id = ? AND organization_id = ? AND branch_id = ? AND order_status NOT IN ('COMPLETED','CANCELLED','MERGED') LIMIT 1`, [id, orgId, branchId]);
      if (activeOrders.length) throw new ConflictError('Active orders must be completed before closing the business day', 'ACTIVE_ORDERS_BLOCK_CLOSE');
      await conn.execute('UPDATE business_days SET status = \'CLOSED\', closed_at = NOW(), closed_by = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?', [closedBy, notes || null, id]);
      const [updated] = await conn.execute<RowDataPacket[]>('SELECT * FROM business_days WHERE id = ? FOR UPDATE', [id]);
      await conn.commit();
      return mapBusinessDay(updated[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async listRegisters(orgId: number, branchId: number): Promise<Register[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM registers WHERE organization_id = ? AND branch_id = ? ORDER BY is_active DESC, name', [orgId, branchId]);
    return rows.map(mapRegister);
  }

  async createRegister(orgId: number, branchId: number, name: string, code: string): Promise<Register> {
    const [branch] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM branches WHERE id = ? AND organization_id = ? AND is_active = 1', [branchId, orgId]);
    if (!branch.length) throw new ForbiddenError('Unauthorized branch access', 'UNAUTHORIZED_BRANCH_ACCESS');
    const [result] = await this.pool().execute<ResultSetHeader>('INSERT INTO registers (organization_id, branch_id, name, code, is_active) VALUES (?, ?, ?, ?, TRUE)', [orgId, branchId, name, code.toUpperCase()]);
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM registers WHERE id = ?', [result.insertId]);
    return mapRegister(rows[0]);
  }

  async updateRegister(orgId: number, branchId: number, id: number, data: { name?: string; code?: string; isActive?: boolean }): Promise<Register> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM registers WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [id, orgId, branchId]);
    if (!rows.length) throw new NotFoundError('Register not found', 'REGISTER_NOT_FOUND');
    const current = rows[0];
    if (data.isActive === false) {
      const [open] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM shifts WHERE register_id = ? AND organization_id = ? AND branch_id = ? AND status = \'OPEN\' LIMIT 1', [id, orgId, branchId]);
      if (open.length) throw new ConflictError('An active shift is using this register', 'REGISTER_IN_USE');
    }
    await this.pool().execute('UPDATE registers SET name = ?, code = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?', [data.name ?? current.name, (data.code ?? current.code).toUpperCase(), data.isActive === undefined ? current.is_active : data.isActive ? 1 : 0, id, orgId, branchId]);
    const [updated] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM registers WHERE id = ?', [id]);
    return mapRegister(updated[0]);
  }

  async getShift(id: number, orgId: number, branchId: number, conn?: PoolConnection, forUpdate = false): Promise<Shift | null> {
    const runner = conn || this.pool();
    const [rows] = await runner.execute<RowDataPacket[]>(`SELECT * FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? ${forUpdate ? 'FOR UPDATE' : ''}`, [id, orgId, branchId]);
    return rows.length ? mapShift(rows[0]) : null;
  }

  async currentShiftForUser(orgId: number, branchId: number, userId: number, conn?: PoolConnection): Promise<Shift | null> {
    const runner = conn || this.pool();
    const [rows] = await runner.execute<RowDataPacket[]>(`SELECT s.* FROM shifts s WHERE s.organization_id = ? AND s.branch_id = ? AND s.cashier_id = ? AND s.status = 'OPEN' ORDER BY s.opened_at DESC LIMIT 1`, [orgId, branchId, userId]);
    return rows.length ? mapShift(rows[0]) : null;
  }

  async openShift(orgId: number, branchId: number, userId: number, registerId: number, openingCash: number, notes?: string): Promise<Shift> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [registerRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM registers WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [registerId, orgId, branchId]);
      if (!registerRows.length) throw new NotFoundError('Register not found in active branch', 'REGISTER_NOT_FOUND');
      if (!registerRows[0].is_active) throw new ConflictError('Register is inactive', 'REGISTER_INACTIVE');
      const day = await this.getCurrentBusinessDay(orgId, branchId, conn);
      if (!day) throw new ConflictError('Open the business day before opening a cashier shift', 'BUSINESS_DAY_REQUIRED');
      const [userBranch] = await conn.execute<RowDataPacket[]>('SELECT 1 FROM user_branches WHERE user_id = ? AND organization_id = ? AND branch_id = ?', [userId, orgId, branchId]);
      if (!userBranch.length) throw new ForbiddenError('User has no access to this branch', 'UNAUTHORIZED_BRANCH_ACCESS');
      const [activeRegisterShift] = await conn.execute<RowDataPacket[]>(`SELECT id FROM shifts WHERE organization_id = ? AND branch_id = ? AND register_id = ? AND status = 'OPEN' FOR UPDATE`, [orgId, branchId, registerId]);
      if (activeRegisterShift.length) throw new ConflictError('This register already has an active shift', 'SHIFT_ALREADY_OPEN');
      const [result] = await conn.execute<ResultSetHeader>('INSERT INTO shifts (organization_id, branch_id, business_day_id, register_id, cashier_id, opening_cash, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [orgId, branchId, day.id, registerId, userId, openingCash, notes || null]);
      const [created] = await conn.execute<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ?', [result.insertId]);
      await conn.commit();
      return mapShift(created[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async listShifts(orgId: number, branchId: number, filters: { cashierId?: number; registerId?: number; status?: string; from?: string; to?: string } = {}): Promise<Shift[]> {
    const clauses = ['organization_id = ?', 'branch_id = ?']; const params: any[] = [orgId, branchId];
    if (filters.cashierId) { clauses.push('cashier_id = ?'); params.push(filters.cashierId); }
    if (filters.registerId) { clauses.push('register_id = ?'); params.push(filters.registerId); }
    if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
    if (filters.from) { clauses.push('DATE(opened_at) >= ?'); params.push(filters.from); }
    if (filters.to) { clauses.push('DATE(opened_at) <= ?'); params.push(filters.to); }
    const [rows] = await this.pool().execute<RowDataPacket[]>(`SELECT * FROM shifts WHERE ${clauses.join(' AND ')} ORDER BY opened_at DESC LIMIT 500`, params);
    return rows.map(mapShift);
  }

  async calculateExpectedCash(conn: PoolConnection, shift: Shift): Promise<number> {
    const [cashRows] = await conn.execute<RowDataPacket[]>(`SELECT COALESCE(SUM(p.amount),0) AS cash_sales
      FROM payments p JOIN bills b ON b.id = p.bill_id
      JOIN payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.organization_id = ? AND p.branch_id = ? AND p.shift_id = ? AND p.status = 'CAPTURED' AND pm.type = 'CASH'`, [shift.organizationId, shift.branchId, shift.id]);
    const [movementRows] = await conn.execute<RowDataPacket[]>(`SELECT
      COALESCE(SUM(CASE WHEN movement_type = 'CASH_IN' THEN amount ELSE 0 END),0) AS cash_in,
      COALESCE(SUM(CASE WHEN movement_type IN ('CASH_OUT','CASH_DROP') THEN amount ELSE 0 END),0) AS cash_out
      FROM cash_movements WHERE organization_id = ? AND branch_id = ? AND shift_id = ?`, [shift.organizationId, shift.branchId, shift.id]);
    return money(Number(shift.openingCash) + Number(cashRows[0]?.cash_sales || 0) + Number(movementRows[0]?.cash_in || 0) - Number(movementRows[0]?.cash_out || 0));
  }

  async closeShift(id: number, orgId: number, branchId: number, userId: number, countedCash: number, notes?: string): Promise<Shift> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [id, orgId, branchId]);
      if (!rows.length) throw new NotFoundError('Shift not found', 'SHIFT_NOT_FOUND');
      const row = rows[0];
      if (row.status !== 'OPEN') throw new ConflictError('Shift is already closed', 'SHIFT_ALREADY_CLOSED');
      if (Number(row.cashier_id) !== userId) {
        const [manager] = await conn.execute<RowDataPacket[]>('SELECT id FROM users u WHERE u.id = ? AND u.organization_id = ? AND u.is_active = 1', [userId, orgId]);
        if (!manager.length) throw new ForbiddenError('Unauthorized shift close', 'SHIFT_CLOSE_FORBIDDEN');
      }
      const shift = mapShift(row);
      const expected = await this.calculateExpectedCash(conn, shift);
      const variance = money(countedCash - expected);
      const varianceStatus = Math.abs(variance) <= EPSILON ? 'MATCHED' : variance > 0 ? 'OVER' : 'SHORT';
      await conn.execute('UPDATE shifts SET status = \'CLOSED\', closed_at = NOW(), expected_cash = ?, counted_cash = ?, variance = ?, variance_status = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?', [expected, countedCash, variance, varianceStatus, notes || null, id]);
      const [updated] = await conn.execute<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ?', [id]);
      await conn.commit();
      return mapShift(updated[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async addCashMovement(id: number, orgId: number, branchId: number, userId: number, input: { movementType: CashMovement['movementType']; amount: number; reason: string; notes?: string }): Promise<CashMovement> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [id, orgId, branchId]);
      if (!rows.length) throw new NotFoundError('Shift not found', 'SHIFT_NOT_FOUND');
      const shift = rows[0];
      if (shift.status !== 'OPEN') throw new ConflictError('Closed shifts cannot receive cash movements', 'SHIFT_CLOSED');
      const [result] = await conn.execute<ResultSetHeader>('INSERT INTO cash_movements (organization_id, branch_id, business_day_id, shift_id, register_id, movement_type, amount, reason, notes, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [orgId, branchId, shift.business_day_id, id, shift.register_id, input.movementType, input.amount, input.reason, input.notes || null, userId]);
      const [created] = await conn.execute<RowDataPacket[]>('SELECT * FROM cash_movements WHERE id = ?', [result.insertId]);
      await conn.commit();
      return mapCashMovement(created[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async listCashMovements(id: number, orgId: number, branchId: number): Promise<CashMovement[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM cash_movements WHERE shift_id = ? AND organization_id = ? AND branch_id = ? ORDER BY created_at DESC, id DESC', [id, orgId, branchId]);
    return rows.map(mapCashMovement);
  }

  async shiftSummary(id: number, orgId: number, branchId: number) {
    const conn = await this.pool().getConnection();
    try {
      const shift = await this.getShift(id, orgId, branchId, conn, true);
      if (!shift) throw new NotFoundError('Shift not found', 'SHIFT_NOT_FOUND');
      const [sales] = await conn.execute<RowDataPacket[]>(`SELECT COALESCE(SUM(subtotal),0) gross_sales, COALESCE(SUM(discount_total),0) discounts,
        COALESCE(SUM(subtotal - discount_total),0) net_sales, COALESCE(SUM(tax_total),0) tax,
        COALESCE(SUM(grand_total),0) grand_total,
        COUNT(*) bill_count FROM bills WHERE organization_id = ? AND branch_id = ? AND shift_id = ? AND status = 'FINALIZED'`, [orgId, branchId, id]);
      const [orders] = await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) order_count FROM orders WHERE organization_id = ? AND branch_id = ? AND shift_id = ?`, [orgId, branchId, id]);
      const [payments] = await conn.execute<RowDataPacket[]>(`SELECT pm.code, pm.name, COALESCE(SUM(p.amount),0) amount FROM payments p JOIN payment_methods pm ON pm.id = p.payment_method_id WHERE p.organization_id = ? AND p.branch_id = ? AND p.shift_id = ? AND p.status = 'CAPTURED' GROUP BY pm.id, pm.code, pm.name ORDER BY pm.name`, [orgId, branchId, id]);
      const [movements] = await conn.execute<RowDataPacket[]>(`SELECT movement_type, COALESCE(SUM(amount),0) amount FROM cash_movements WHERE organization_id = ? AND branch_id = ? AND shift_id = ? GROUP BY movement_type`, [orgId, branchId, id]);
      const expected = await this.calculateExpectedCash(conn, shift);
      const day = await this.getBusinessDay(shift.businessDayId, orgId, branchId, conn);
      return {
        shift, businessDay: day,
        sales: { grossSales: Number(sales[0].gross_sales), discounts: Number(sales[0].discounts), netSales: Number(sales[0].net_sales), tax: Number(sales[0].tax), grandTotal: Number(sales[0].grand_total), billCount: Number(sales[0].bill_count), orderCount: Number(orders[0].order_count) },
        payments: payments.map(p => ({ code: String(p.code), name: String(p.name), amount: Number(p.amount) })),
        cash: { openingCash: shift.openingCash, cashSales: Number(payments.filter(p => String(p.code).toUpperCase() === 'CASH')[0]?.amount || 0), cashIn: Number(movements.find(m => m.movement_type === 'CASH_IN')?.amount || 0), cashOut: Number(movements.find(m => m.movement_type === 'CASH_OUT')?.amount || 0), cashDrops: Number(movements.find(m => m.movement_type === 'CASH_DROP')?.amount || 0), expectedCash: expected, countedCash: shift.countedCash, variance: shift.variance, varianceStatus: shift.varianceStatus },
      };
    } finally { conn.release(); }
  }
}

export const shiftRepository = new ShiftRepository();

export async function requireOpenShiftForUser(orgId: number, branchId: number, userId: number): Promise<Shift> {
  const shift = await shiftRepository.currentShiftForUser(orgId, branchId, userId);
  if (!shift) throw new ConflictError('An active cashier shift is required for this financial operation', 'ACTIVE_SHIFT_REQUIRED');
  return shift;
}
