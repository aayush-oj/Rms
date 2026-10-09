import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { Payment } from './types';
import { canCompleteOrderAfterSettlement } from '../../domain/orderLifecycle';

const EPSILON = 0.0001;
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }

function mapPayment(row: RowDataPacket): Payment {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id),
    businessDayId: row.business_day_id == null ? null : Number(row.business_day_id),
    shiftId: row.shift_id == null ? null : Number(row.shift_id), registerId: row.register_id == null ? null : Number(row.register_id),
    billId: Number(row.bill_id), paymentMethodId: Number(row.payment_method_id), amount: Number(row.amount),
    tenderAmount: row.tender_amount == null ? null : Number(row.tender_amount), changeAmount: Number(row.change_amount),
    businessDate: String(row.business_date), status: row.status,
    externalReference: row.external_reference == null ? null : String(row.external_reference),
    notes: row.notes == null ? null : String(row.notes), idempotencyKey: String(row.idempotency_key),
    createdBy: Number(row.created_by), createdAt: iso(row.created_at),
    reversedAt: row.reversed_at == null ? null : iso(row.reversed_at),
    reversedBy: row.reversed_by == null ? null : Number(row.reversed_by),
    reversalReason: row.reversal_reason == null ? null : String(row.reversal_reason),
  };
}

async function recalculateOrderPaymentStatus(
  conn: PoolConnection,
  orderId: number,
  organizationId: number,
  branchId: number
): Promise<'UNPAID' | 'PARTIALLY_PAID' | 'PAID'> {
  const [orders] = await conn.execute<RowDataPacket[]>(
    'SELECT grand_total FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
    [orderId, organizationId, branchId]
  );
  if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');

  const [totals] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN grand_total ELSE 0 END),0) AS billed_total,
            COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN amount_paid ELSE 0 END),0) AS paid_total,
            COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN credit_total ELSE 0 END),0) AS credit_total,
            COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN balance_due ELSE 0 END),0) AS balance_due
       FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ?`,
    [orderId, organizationId, branchId]
  );

  const orderTotal = Number(orders[0].grand_total);
  const billed = Number(totals[0]?.billed_total || 0);
  const paid = Number(totals[0]?.paid_total || 0);
  const credit = Number(totals[0]?.credit_total || 0);
  const balanceDue = Number(totals[0]?.balance_due || 0);
  const status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = paid <= EPSILON
    ? 'UNPAID'
    : (paid + EPSILON >= orderTotal && billed + EPSILON >= orderTotal ? 'PAID' : 'PARTIALLY_PAID');
  const fullyAllocated = billed + EPSILON >= orderTotal && balanceDue <= EPSILON;
  const settlementStatus = fullyAllocated ? (credit > EPSILON ? 'SETTLED_WITH_CREDIT' : 'SETTLED') : 'OPEN';

  await conn.execute(
    'UPDATE orders SET payment_status = ?, settlement_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
    [status, settlementStatus, orderId, organizationId, branchId]
  );
  return status;
}

async function releaseTableIfNoActiveOrder(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  tableId: number
): Promise<'available' | 'occupied' | string> {
  const [tables] = await conn.execute<RowDataPacket[]>(
    'SELECT status FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
    [tableId, organizationId, branchId]
  );
  if (!tables.length) throw new NotFoundError('Dining table not found', 'TABLE_NOT_FOUND');

  const [active] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS active_count FROM orders
     WHERE organization_id = ? AND branch_id = ? AND dining_table_id = ? AND order_type = 'DINE_IN'
       AND order_status IN ('PLACED','PREPARING','READY','SERVED')`,
    [organizationId, branchId, tableId]
  );
  if (Number(active[0]?.active_count || 0) === 0 && String(tables[0].status) === 'occupied') {
    await conn.execute(
      `UPDATE dining_tables SET status = 'available', updated_at = NOW()
       WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [tableId, organizationId, branchId]
    );
    return 'available';
  }
  return String(tables[0].status);
}

export interface SettlementResult {
  payment: Payment;
  orderId: number;
  orderStatus: string;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  completedNow: boolean;
  diningTableId: number | null;
  tableStatus: string | null;
}

export async function recordPaymentAndSettle(data: {
  organizationId: number;
  branchId: number;
  businessDayId: number;
  shiftId: number;
  registerId: number;
  billId: number;
  paymentMethodId: number;
  amount: number;
  tenderAmount?: number;
  changeAmount: number;
  businessDate: string;
  externalReference?: string;
  notes?: string;
  idempotencyKey: string;
  requestHash: string;
  createdBy: number;
}): Promise<SettlementResult> {
  const pool = getDatabasePool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [shiftRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status, business_day_id, register_id FROM shifts
       WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE`,
      [data.shiftId, data.organizationId, data.branchId]
    );
    if (!shiftRows.length || shiftRows[0].status !== 'OPEN') throw new ConflictError('The cashier shift is not open', 'SHIFT_NOT_OPEN');
    if (Number(shiftRows[0].business_day_id) !== data.businessDayId || Number(shiftRows[0].register_id) !== data.registerId) {
      throw new ConflictError('Payment operational context does not match the active shift', 'SHIFT_CONTEXT_MISMATCH');
    }

    const [billRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [data.billId, data.organizationId, data.branchId]
    );
    if (!billRows.length) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
    const bill = billRows[0];
    if (bill.status !== 'FINALIZED') throw new ConflictError('Payment requires a finalized bill', 'BILL_NOT_PAYABLE');

    const [orderRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [bill.order_id, data.organizationId, data.branchId]
    );
    if (!orderRows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const order = orderRows[0];

    const [existingRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
      [data.organizationId, data.branchId, data.idempotencyKey]
    );
    if (existingRows.length) {
      const storedHash = existingRows[0].request_hash == null ? null : String(existingRows[0].request_hash);
      if ((storedHash && storedHash !== data.requestHash) || (!storedHash && (
        Number(existingRows[0].bill_id) !== data.billId ||
        Math.abs(Number(existingRows[0].amount) - data.amount) > EPSILON ||
        Number(existingRows[0].payment_method_id) !== data.paymentMethodId
      ))) throw new ConflictError('Idempotency key was already used for a different payment', 'IDEMPOTENCY_KEY_CONFLICT');

      await conn.rollback();
      const [freshOrder] = await pool.execute<RowDataPacket[]>(
        'SELECT order_status, payment_status, dining_table_id FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ?',
        [bill.order_id, data.organizationId, data.branchId]
      );
      return {
        payment: mapPayment(existingRows[0]), orderId: Number(bill.order_id), orderStatus: String(freshOrder[0]?.order_status || order.order_status),
        paymentStatus: String(freshOrder[0]?.payment_status || order.payment_status) as SettlementResult['paymentStatus'],
        completedNow: false, diningTableId: freshOrder[0]?.dining_table_id == null ? null : Number(freshOrder[0].dining_table_id), tableStatus: null,
      };
    }

    if (['CANCELLED', 'MERGED'].includes(String(order.order_status))) {
      throw new ConflictError('Payments cannot be recorded for cancelled or merged orders', 'ORDER_NOT_PAYABLE');
    }
    // COMPLETED orders remain financially correctable after a payment reversal; operational/table state stays terminal.
    const remaining = Math.max(0, Number(bill.balance_due ?? (Number(bill.grand_total) - Number(bill.amount_paid) - Number(bill.credit_total || 0))));
    if (data.amount <= 0) throw new ConflictError('Payment amount must be greater than zero', 'INVALID_PAYMENT_AMOUNT');
    if (data.amount > remaining + EPSILON) throw new ConflictError('Payment exceeds remaining balance', 'PAYMENT_EXCEEDS_BALANCE');

    const [methodRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM payment_methods WHERE id = ? AND organization_id = ?
       AND (branch_id IS NULL OR branch_id = ?) AND is_active = TRUE`,
      [data.paymentMethodId, data.organizationId, data.branchId]
    );
    if (!methodRows.length) throw new NotFoundError('Payment method not found or inactive', 'PAYMENT_METHOD_NOT_FOUND');
    const method = methodRows[0];
    if (Boolean(method.requires_reference) && !data.externalReference) throw new ConflictError('A payment reference is required for this payment method', 'PAYMENT_REFERENCE_REQUIRED');
    if (String(method.type) === 'CASH' && data.tenderAmount != null && data.tenderAmount < data.amount) {
      throw new ConflictError('Cash received cannot be less than the applied payment amount', 'INVALID_CASH_TENDER');
    }

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO payments
        (organization_id, branch_id, business_day_id, shift_id, register_id, bill_id, payment_method_id, amount, tender_amount, change_amount, business_date, status, external_reference, notes, idempotency_key, request_hash, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CAPTURED', ?, ?, ?, ?, ?)`,
      [data.organizationId, data.branchId, data.businessDayId, data.shiftId, data.registerId, data.billId,
        data.paymentMethodId, data.amount, data.tenderAmount ?? null, data.changeAmount, data.businessDate,
        data.externalReference ?? null, data.notes ?? null, data.idempotencyKey, data.requestHash, data.createdBy]
    );
    const paymentId = Number(result.insertId);

    const newPaid = Number(bill.amount_paid) + data.amount;
    const creditTotal = Number(bill.credit_total || 0);
    const balance = Math.max(0, round4(Number(bill.grand_total) - newPaid - creditTotal));
    await conn.execute(
      'UPDATE bills SET amount_paid = ?, balance_due = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
      [newPaid, balance, data.billId, data.organizationId, data.branchId]
    );

    const paymentStatus = await recalculateOrderPaymentStatus(conn, Number(bill.order_id), data.organizationId, data.branchId);
    let completedNow = false;
    let orderStatus = String(order.order_status);
    const diningTableId = order.dining_table_id == null ? null : Number(order.dining_table_id);
    let tableStatus: string | null = null;

    if (paymentStatus === 'PAID' && orderStatus !== 'COMPLETED') {
      const canComplete = canCompleteOrderAfterSettlement(
        String(order.order_type),
        orderStatus,
        true,
        order.picked_up_at != null
      );
      if (canComplete) {
        await conn.execute(
          `UPDATE orders SET order_status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW()), completed_by = ?, updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [data.createdBy, bill.order_id, data.organizationId, data.branchId]
        );
        orderStatus = 'COMPLETED';
        completedNow = true;
        if (diningTableId != null) tableStatus = await releaseTableIfNoActiveOrder(conn, data.organizationId, data.branchId, diningTableId);
      }
    }

    await conn.commit();
    const [paymentRows] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ?',
      [paymentId, data.organizationId, data.branchId]
    );
    return { payment: mapPayment(paymentRows[0]), orderId: Number(bill.order_id), orderStatus, paymentStatus, completedNow, diningTableId, tableStatus };
  } catch (error: any) {
    await conn.rollback();
    if (error?.errno === 1062 && data.idempotencyKey) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        'SELECT * FROM payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1',
        [data.organizationId, data.branchId, data.idempotencyKey]
      );
      if (rows.length) {
        const storedHash = rows[0].request_hash == null ? null : String(rows[0].request_hash);
        if (storedHash && storedHash !== data.requestHash) throw new ConflictError('Idempotency key was already used for a different payment', 'IDEMPOTENCY_KEY_CONFLICT');
        const [billRows] = await pool.execute<RowDataPacket[]>(
          'SELECT order_id FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ?',
          [rows[0].bill_id, data.organizationId, data.branchId]
        );
        if (!billRows.length) throw new NotFoundError('Bill not found in payment tenant scope', 'BILL_NOT_FOUND');
        const orderId = Number(billRows[0].order_id);
        const [orders] = await pool.execute<RowDataPacket[]>(
          'SELECT order_status, payment_status, dining_table_id FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ?',
          [orderId, data.organizationId, data.branchId]
        );
        return { payment: mapPayment(rows[0]), orderId, orderStatus: String(orders[0]?.order_status || ''), paymentStatus: String(orders[0]?.payment_status || 'UNPAID') as SettlementResult['paymentStatus'], completedNow: false, diningTableId: orders[0]?.dining_table_id == null ? null : Number(orders[0].dining_table_id), tableStatus: null };
      }
    }
    throw error;
  } finally {
    conn.release();
  }
}

export interface ReversalSettlementResult {
  payment: Payment;
  orderId: number;
  orderStatus: string;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  diningTableId: number | null;
}

export async function reversePaymentFinancially(
  id: number,
  organizationId: number,
  branchId: number,
  reversedBy: number,
  reason: string
): Promise<ReversalSettlementResult> {
  const pool = getDatabasePool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [context] = await conn.execute<RowDataPacket[]>(
      'SELECT shift_id, bill_id FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ?',
      [id, organizationId, branchId]
    );
    if (!context.length) throw new NotFoundError('Payment not found', 'PAYMENT_NOT_FOUND');

    const [shifts] = await conn.execute<RowDataPacket[]>(
      'SELECT status FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [context[0].shift_id, organizationId, branchId]
    );
    if (!shifts.length || shifts[0].status !== 'OPEN') throw new ConflictError('Payments from a closed shift cannot be reversed', 'SHIFT_NOT_OPEN');

    const [billRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [context[0].bill_id, organizationId, branchId]
    );
    if (!billRows.length) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
    const bill = billRows[0];

    const [paymentRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [id, organizationId, branchId]
    );
    if (!paymentRows.length) throw new NotFoundError('Payment not found', 'PAYMENT_NOT_FOUND');
    const payment = paymentRows[0];
    if (payment.status === 'REVERSED') throw new ConflictError('Payment is already reversed', 'PAYMENT_ALREADY_REVERSED');

    const [orders] = await conn.execute<RowDataPacket[]>(
      'SELECT order_status, dining_table_id FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [bill.order_id, organizationId, branchId]
    );
    if (!orders.length || ['CANCELLED', 'MERGED'].includes(String(orders[0].order_status))) {
      throw new ConflictError('Payments on cancelled or merged orders cannot be reversed', 'ORDER_NOT_PAYABLE');
    }

    const newPaid = Math.max(0, Number(bill.amount_paid) - Number(payment.amount));
    const creditTotal = Number(bill.credit_total || 0);
    const balance = Math.max(0, round4(Number(bill.grand_total) - newPaid - creditTotal));
    await conn.execute(
      `UPDATE payments SET status = 'REVERSED', reversed_at = NOW(), reversed_by = ?, reversal_reason = ?
       WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [reversedBy, reason, id, organizationId, branchId]
    );
    await conn.execute(
      'UPDATE bills SET amount_paid = ?, balance_due = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
      [newPaid, balance, bill.id, organizationId, branchId]
    );

    const paymentStatus = await recalculateOrderPaymentStatus(conn, Number(bill.order_id), organizationId, branchId);
    // Reversal changes financial state only. COMPLETED remains operationally terminal and never reclaims a released table.
    await conn.commit();

    const [updated] = await pool.execute<RowDataPacket[]>(
      'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ?',
      [id, organizationId, branchId]
    );
    return {
      payment: mapPayment(updated[0]), orderId: Number(bill.order_id), orderStatus: String(orders[0].order_status), paymentStatus,
      diningTableId: orders[0].dining_table_id == null ? null : Number(orders[0].dining_table_id),
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
