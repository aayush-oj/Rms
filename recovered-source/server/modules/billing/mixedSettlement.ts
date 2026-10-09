import { createHash } from 'node:crypto';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { canCompleteOrderAfterSettlement } from '../../domain/orderLifecycle';

const EPSILON = 0.0001;
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export type DiscountType = 'NONE' | 'PERCENTAGE' | 'AMOUNT';
export interface MixedPaymentLineInput {
  paymentMethodId: number;
  amount: number;
  tenderAmount?: number;
  externalReference?: string;
  notes?: string;
}
export interface CreditInput {
  customerId: number;
  amount: number;
  dueDate?: string | null;
  notes?: string;
}

async function releaseTableIfNoActiveOrder(conn: PoolConnection, organizationId: number, branchId: number, tableId: number) {
  const [tables] = await conn.execute<RowDataPacket[]>(
    'SELECT status FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
    [tableId, organizationId, branchId]
  );
  if (!tables.length) return null;
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

async function orderSettlementState(conn: PoolConnection, organizationId: number, branchId: number, orderId: number) {
  const [orderRows] = await conn.execute<RowDataPacket[]>(
    'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
    [orderId, organizationId, branchId]
  );
  if (!orderRows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
  const order = orderRows[0];
  const [totals] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN grand_total ELSE 0 END),0) AS billed_total,
            COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN amount_paid ELSE 0 END),0) AS paid_total,
            COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN credit_total ELSE 0 END),0) AS credit_total,
            COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN balance_due ELSE 0 END),0) AS balance_due
       FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ?`,
    [orderId, organizationId, branchId]
  );
  const orderTotal = Number(order.grand_total);
  const billedTotal = Number(totals[0]?.billed_total || 0);
  const paidTotal = Number(totals[0]?.paid_total || 0);
  const creditTotal = Number(totals[0]?.credit_total || 0);
  const balanceDue = Number(totals[0]?.balance_due || 0);
  const paymentStatus = paidTotal <= EPSILON ? 'UNPAID' : (paidTotal + EPSILON >= orderTotal ? 'PAID' : 'PARTIALLY_PAID');
  const fullyAllocated = billedTotal + EPSILON >= orderTotal && balanceDue <= EPSILON;
  const settlementStatus = fullyAllocated ? (creditTotal > EPSILON ? 'SETTLED_WITH_CREDIT' : 'SETTLED') : 'OPEN';
  await conn.execute(
    'UPDATE orders SET payment_status = ?, settlement_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
    [paymentStatus, settlementStatus, orderId, organizationId, branchId]
  );
  return { order, paymentStatus, settlementStatus, fullyAllocated, paidTotal, creditTotal, balanceDue };
}

export async function settleBillMixed(data: {
  organizationId: number;
  branchId: number;
  userId: number;
  billId: number;
  businessDayId: number;
  shiftId: number;
  registerId: number;
  businessDate: string;
  payments: MixedPaymentLineInput[];
  credit?: CreditInput | null;
  idempotencyKey: string;
}) {
  const pool = getDatabasePool();
  const conn = await pool.getConnection();
  const requestHash = createHash('sha256').update(JSON.stringify({ billId: data.billId, payments: data.payments, credit: data.credit || null })).digest('hex');
  try {
    await conn.beginTransaction();
    const [attempts] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM bill_settlement_attempts WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? FOR UPDATE',
      [data.organizationId, data.branchId, data.idempotencyKey]
    );
    if (attempts.length) {
      if (String(attempts[0].request_hash) !== requestHash) throw new ConflictError('Settlement key was already used for different values', 'IDEMPOTENCY_KEY_CONFLICT');
      await conn.rollback();
      const replay = await getBillSettlementSummary(data.organizationId, data.branchId, data.billId);
      return {
        ...replay,
        capturedPayments: [],
        receivableId: replay.receivable?.id ?? null,
        completedNow: false,
        tableId: null,
        tableStatus: null,
        orderStatus: replay.orderStatus,
      };
    }

    const [shiftRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [data.shiftId, data.organizationId, data.branchId]
    );
    if (!shiftRows.length || String(shiftRows[0].status) !== 'OPEN') throw new ConflictError('The cashier shift is not open', 'SHIFT_NOT_OPEN');
    if (Number(shiftRows[0].business_day_id) !== data.businessDayId || Number(shiftRows[0].register_id) !== data.registerId) throw new ConflictError('Settlement context does not match the active shift', 'SHIFT_CONTEXT_MISMATCH');

    const [bills] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [data.billId, data.organizationId, data.branchId]
    );
    if (!bills.length) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
    const bill = bills[0];
    if (String(bill.status) !== 'FINALIZED') throw new ConflictError('Settlement requires a finalized bill', 'BILL_NOT_PAYABLE');
    const [orders] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [bill.order_id, data.organizationId, data.branchId]
    );
    if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const order = orders[0];
    if (['CANCELLED', 'MERGED'].includes(String(order.order_status))) throw new ConflictError('This order cannot be settled', 'ORDER_NOT_PAYABLE');

    const currentBalance = Number(bill.balance_due || 0);
    if (currentBalance <= EPSILON) throw new ConflictError('This bill has no remaining balance', 'BILL_ALREADY_SETTLED');
    if (!data.payments.length && !(data.credit && data.credit.amount > 0)) throw new BadRequestError('Add at least one payment or customer credit amount', 'EMPTY_SETTLEMENT');

    let realPaymentTotal = 0;
    const capturedPayments: any[] = [];
    for (let index = 0; index < data.payments.length; index += 1) {
      const line = data.payments[index];
      const amount = round4(Number(line.amount));
      if (!(amount > 0)) throw new BadRequestError('Payment amount must be greater than zero', 'INVALID_PAYMENT_AMOUNT');
      const [methods] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM payment_methods WHERE id = ? AND organization_id = ? AND (branch_id IS NULL OR branch_id = ?) AND is_active = TRUE FOR UPDATE`,
        [line.paymentMethodId, data.organizationId, data.branchId]
      );
      if (!methods.length) throw new NotFoundError('Payment method not found or inactive', 'PAYMENT_METHOD_NOT_FOUND');
      const method = methods[0];
      if (String(method.type) === 'CREDIT') throw new BadRequestError('Use customer credit instead of a CREDIT payment method', 'CREDIT_IS_RECEIVABLE');
      if (Boolean(method.requires_reference) && !line.externalReference?.trim()) throw new BadRequestError(`${String(method.name)} requires a reference`, 'PAYMENT_REFERENCE_REQUIRED');
      const tender = line.tenderAmount == null ? null : Number(line.tenderAmount);
      if (String(method.type) === 'CASH' && tender != null && tender + EPSILON < amount) throw new BadRequestError('Cash received cannot be less than the applied cash amount', 'INVALID_CASH_TENDER');
      const changeAmount = String(method.type) === 'CASH' && tender != null ? Math.max(0, round4(tender - amount)) : 0;
      const lineKey = createHash('sha256').update(`${data.idempotencyKey}:${index}`).digest('hex');
      const lineHash = createHash('sha256').update(JSON.stringify({ billId: data.billId, line })).digest('hex');
      const [insert] = await conn.execute<ResultSetHeader>(
        `INSERT INTO payments
          (organization_id, branch_id, business_day_id, shift_id, register_id, bill_id, payment_method_id, amount, tender_amount, change_amount, business_date, status, external_reference, notes, idempotency_key, request_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CAPTURED', ?, ?, ?, ?, ?)`,
        [data.organizationId, data.branchId, data.businessDayId, data.shiftId, data.registerId, data.billId, line.paymentMethodId, amount,
          tender, changeAmount, data.businessDate, line.externalReference?.trim() || null, line.notes?.trim() || null, lineKey, lineHash, data.userId]
      );
      capturedPayments.push({ id: Number(insert.insertId), paymentMethodId: line.paymentMethodId, amount, tenderAmount: tender, changeAmount, externalReference: line.externalReference?.trim() || null });
      realPaymentTotal = round4(realPaymentTotal + amount);
    }

    let creditAmount = 0;
    let receivableId: number | null = null;
    if (data.credit && Number(data.credit.amount) > EPSILON) {
      creditAmount = round4(Number(data.credit.amount));
      const [customers] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM customers WHERE id = ? AND organization_id = ? AND is_active = TRUE FOR UPDATE',
        [data.credit.customerId, data.organizationId]
      );
      if (!customers.length) throw new NotFoundError('Select an active customer before using customer credit', 'CREDIT_CUSTOMER_REQUIRED');
      if (order.customer_id != null && Number(order.customer_id) !== data.credit.customerId) throw new ConflictError('This order is linked to a different customer', 'ORDER_CUSTOMER_MISMATCH');

      // Locking the customer row above serializes credit decisions for this customer across branches.
      // A limit of 0 means no configured limit; positive limits are enforced organization-wide.
      const creditLimit = Number(customers[0].credit_limit || 0);
      if (creditLimit > EPSILON) {
        const [creditTotals] = await conn.execute<RowDataPacket[]>(
          `SELECT COALESCE(SUM(outstanding_amount), 0) AS outstanding
             FROM customer_receivables
            WHERE organization_id = ? AND customer_id = ? AND outstanding_amount > 0`,
          [data.organizationId, data.credit.customerId]
        );
        const currentOutstanding = Number(creditTotals[0]?.outstanding || 0);
        if (round4(currentOutstanding + creditAmount) > creditLimit + EPSILON) {
          throw new ConflictError(
            `Customer credit limit exceeded. Available credit is ${Math.max(0, round4(creditLimit - currentOutstanding)).toFixed(2)}.`,
            'CUSTOMER_CREDIT_LIMIT_EXCEEDED'
          );
        }
      }

      const [existingReceivable] = await conn.execute<RowDataPacket[]>(
        'SELECT id FROM customer_receivables WHERE organization_id = ? AND branch_id = ? AND bill_id = ? FOR UPDATE',
        [data.organizationId, data.branchId, data.billId]
      );
      if (existingReceivable.length) throw new ConflictError('Customer credit has already been created for this bill', 'CREDIT_ALREADY_EXISTS');
      const [insert] = await conn.execute<ResultSetHeader>(
        `INSERT INTO customer_receivables
          (organization_id, branch_id, customer_id, bill_id, order_id, original_amount, outstanding_amount, due_date, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
        [data.organizationId, data.branchId, data.credit.customerId, data.billId, bill.order_id, creditAmount, creditAmount,
          data.credit.dueDate || null, data.credit.notes?.trim() || null, data.userId]
      );
      receivableId = Number(insert.insertId);
      if (order.customer_id == null) await conn.execute('UPDATE orders SET customer_id = ? WHERE id = ?', [data.credit.customerId, bill.order_id]);
    }

    const allocated = round4(realPaymentTotal + creditAmount);
    if (allocated > currentBalance + EPSILON) throw new ConflictError('Settlement exceeds the remaining bill balance', 'SETTLEMENT_EXCEEDS_BALANCE');
    const newPaid = round4(Number(bill.amount_paid || 0) + realPaymentTotal);
    const newCredit = round4(Number(bill.credit_total || 0) + creditAmount);
    const newBalance = Math.max(0, round4(Number(bill.grand_total) - newPaid - newCredit));
    await conn.execute(
      'UPDATE bills SET amount_paid = ?, credit_total = ?, balance_due = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
      [newPaid, newCredit, newBalance, data.billId, data.organizationId, data.branchId]
    );
    await conn.execute(
      `INSERT INTO bill_settlement_attempts (organization_id, branch_id, bill_id, idempotency_key, request_hash, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.organizationId, data.branchId, data.billId, data.idempotencyKey, requestHash, data.userId]
    );

    const state = await orderSettlementState(conn, data.organizationId, data.branchId, Number(bill.order_id));
    let completedNow = false;
    let tableStatus: string | null = null;
    let orderStatus = String(state.order.order_status);
    const tableId = state.order.dining_table_id == null ? null : Number(state.order.dining_table_id);
    if (state.fullyAllocated && orderStatus !== 'COMPLETED') {
      const canComplete = canCompleteOrderAfterSettlement(
        String(state.order.order_type),
        orderStatus,
        true,
        state.order.picked_up_at != null
      );
      if (canComplete) {
        await conn.execute(
          `UPDATE orders SET order_status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW()), completed_by = ?, updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [data.userId, bill.order_id, data.organizationId, data.branchId]
        );
        orderStatus = 'COMPLETED';
        completedNow = true;
        if (tableId != null) tableStatus = await releaseTableIfNoActiveOrder(conn, data.organizationId, data.branchId, tableId);
      }
    }
    await conn.commit();
    return { ...(await getBillSettlementSummary(data.organizationId, data.branchId, data.billId)), capturedPayments, receivableId, completedNow, tableId, tableStatus, orderStatus };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function getBillSettlementSummary(organizationId: number, branchId: number, billId: number) {
  const pool = getDatabasePool();
  const [bills] = await pool.execute<RowDataPacket[]>(
    `SELECT b.*, o.settlement_status, o.payment_status, o.customer_id, o.order_status
       FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.id = ? AND b.organization_id = ? AND b.branch_id = ?`,
    [billId, organizationId, branchId]
  );
  if (!bills.length) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
  const bill = bills[0];
  const [receivables] = await pool.execute<RowDataPacket[]>(
    `SELECT cr.*, c.name AS customer_name, c.phone AS customer_phone
       FROM customer_receivables cr JOIN customers c ON c.id = cr.customer_id
      WHERE cr.organization_id = ? AND cr.branch_id = ? AND cr.bill_id = ? LIMIT 1`,
    [organizationId, branchId, billId]
  );
  return {
    billId,
    orderId: Number(bill.order_id),
    grandTotal: Number(bill.grand_total),
    amountPaid: Number(bill.amount_paid || 0),
    creditTotal: Number(bill.credit_total || 0),
    balanceDue: Number(bill.balance_due || 0),
    discountTotal: Number(bill.discount_total || 0),
    discountType: String(bill.discount_type || 'NONE'),
    discountValue: Number(bill.discount_value || 0),
    discountReason: bill.discount_reason == null ? null : String(bill.discount_reason),
    settlementStatus: String(bill.settlement_status || 'OPEN'),
    paymentStatus: String(bill.payment_status || 'UNPAID'),
    orderStatus: String(bill.order_status),
    customerId: bill.customer_id == null ? null : Number(bill.customer_id),
    receivable: receivables.length ? {
      id: Number(receivables[0].id), customerId: Number(receivables[0].customer_id), customerName: String(receivables[0].customer_name),
      customerPhone: receivables[0].customer_phone == null ? null : String(receivables[0].customer_phone),
      originalAmount: Number(receivables[0].original_amount), outstandingAmount: Number(receivables[0].outstanding_amount),
      dueDate: receivables[0].due_date == null ? null : String(receivables[0].due_date), status: String(receivables[0].status), notes: receivables[0].notes == null ? null : String(receivables[0].notes),
    } : null,
  };
}

export async function searchBillingCustomers(organizationId: number, search: string) {
  const q = `%${search.trim()}%`;
  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
    `SELECT id, name, phone, email FROM customers WHERE organization_id = ? AND is_active = TRUE
       AND (? = '%%' OR name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT 20`,
    [organizationId, q, q, q]
  );
  return rows.map((row) => ({ id: Number(row.id), name: String(row.name), phone: row.phone == null ? null : String(row.phone), email: row.email == null ? null : String(row.email) }));
}

export async function createBillingCustomer(organizationId: number, name: string, phone: string, createdBy: number) {
  const cleanName = name.trim(); const cleanPhone = phone.trim();
  if (!cleanName || !cleanPhone) throw new BadRequestError('Customer name and phone are required for credit', 'CUSTOMER_NAME_PHONE_REQUIRED');
  try {
    const [result] = await getDatabasePool().execute<ResultSetHeader>(
      `INSERT INTO customers (organization_id, name, phone, email, notes, is_active) VALUES (?, ?, ?, NULL, ?, TRUE)`,
      [organizationId, cleanName, cleanPhone, `Quick-added from billing by user ${createdBy}`]
    );
    return { id: Number(result.insertId), name: cleanName, phone: cleanPhone, email: null };
  } catch (error: any) {
    if (error?.errno === 1062) throw new ConflictError('A customer with this phone already exists', 'CUSTOMER_PHONE_EXISTS');
    throw error;
  }
}

export async function listCustomerCreditAccounts(organizationId: number) {
  const pool = getDatabasePool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id,
            c.name,
            c.phone,
            c.email,
            c.credit_limit,
            r.total_credit_purchases,
            r.outstanding,
            r.overdue,
            r.open_receivables,
            r.branch_count,
            r.last_credit_at,
            COALESCE(p.total_repaid, 0) AS total_repaid,
            p.last_repayment_at
       FROM customers c
       JOIN (
         SELECT customer_id,
                COALESCE(SUM(original_amount), 0) AS total_credit_purchases,
                COALESCE(SUM(outstanding_amount), 0) AS outstanding,
                COALESCE(SUM(CASE
                  WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE AND outstanding_amount > 0
                  THEN outstanding_amount ELSE 0 END), 0) AS overdue,
                SUM(CASE WHEN outstanding_amount > 0 THEN 1 ELSE 0 END) AS open_receivables,
                COUNT(DISTINCT branch_id) AS branch_count,
                MAX(created_at) AS last_credit_at
           FROM customer_receivables
          WHERE organization_id = ?
          GROUP BY customer_id
       ) r ON r.customer_id = c.id
       LEFT JOIN (
         SELECT cr.customer_id,
                COALESCE(SUM(ccp.amount), 0) AS total_repaid,
                MAX(ccp.created_at) AS last_repayment_at
           FROM customer_credit_payments ccp
           JOIN customer_receivables cr ON cr.id = ccp.receivable_id
          WHERE ccp.organization_id = ? AND cr.organization_id = ?
          GROUP BY cr.customer_id
       ) p ON p.customer_id = c.id
      WHERE c.organization_id = ?
      ORDER BY r.outstanding DESC, c.name ASC`,
    [organizationId, organizationId, organizationId, organizationId]
  );

  const accounts = rows.map((row) => {
    const outstanding = round4(Number(row.outstanding || 0));
    const totalCreditPurchases = round4(Number(row.total_credit_purchases || 0));
    const totalRepaid = round4(Number(row.total_repaid || 0));
    const overdue = round4(Number(row.overdue || 0));
    const creditLimit = round4(Number(row.credit_limit || 0));
    const lastCreditAt = row.last_credit_at instanceof Date ? row.last_credit_at.toISOString() : (row.last_credit_at == null ? null : String(row.last_credit_at));
    const lastRepaymentAt = row.last_repayment_at instanceof Date ? row.last_repayment_at.toISOString() : (row.last_repayment_at == null ? null : String(row.last_repayment_at));
    const lastActivityAt = !lastCreditAt
      ? lastRepaymentAt
      : !lastRepaymentAt
        ? lastCreditAt
        : (new Date(lastRepaymentAt).getTime() > new Date(lastCreditAt).getTime() ? lastRepaymentAt : lastCreditAt);

    return {
      customerId: Number(row.id),
      name: String(row.name),
      phone: row.phone == null ? null : String(row.phone),
      email: row.email == null ? null : String(row.email),
      creditLimit,
      availableCredit: creditLimit > EPSILON ? Math.max(0, round4(creditLimit - outstanding)) : null,
      isOverLimit: creditLimit > EPSILON && outstanding > creditLimit + EPSILON,
      totalCreditPurchases,
      totalRepaid,
      outstanding,
      overdue,
      openReceivables: Number(row.open_receivables || 0),
      branchCount: Number(row.branch_count || 0),
      lastActivityAt,
    };
  });

  return {
    summary: {
      totalOutstanding: round4(accounts.reduce((sum, row) => sum + row.outstanding, 0)),
      totalCreditPurchases: round4(accounts.reduce((sum, row) => sum + row.totalCreditPurchases, 0)),
      totalRepaid: round4(accounts.reduce((sum, row) => sum + row.totalRepaid, 0)),
      overdue: round4(accounts.reduce((sum, row) => sum + row.overdue, 0)),
      customersWithOutstanding: accounts.filter((row) => row.outstanding > EPSILON).length,
      overdueCustomers: accounts.filter((row) => row.overdue > EPSILON).length,
      accountsCount: accounts.length,
    },
    accounts,
  };
}

export async function listCustomerCreditLedger(organizationId: number, customerId: number) {
  const pool = getDatabasePool();
  const [customers] = await pool.execute<RowDataPacket[]>(
    'SELECT id, name, phone, credit_limit FROM customers WHERE id = ? AND organization_id = ?',
    [customerId, organizationId]
  );
  if (!customers.length) throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND');

  const [receivables] = await pool.execute<RowDataPacket[]>(
    `SELECT cr.*, b.bill_number,
            CASE
              WHEN cr.due_date IS NOT NULL AND cr.due_date < CURRENT_DATE AND cr.outstanding_amount > 0 THEN 1
              ELSE 0
            END AS is_overdue
       FROM customer_receivables cr
       JOIN bills b ON b.id = cr.bill_id
      WHERE cr.organization_id = ? AND cr.customer_id = ?
      ORDER BY cr.created_at DESC, cr.id DESC`,
    [organizationId, customerId]
  );

  const [repayments] = await pool.execute<RowDataPacket[]>(
    `SELECT ccp.*, cr.customer_id, cr.bill_id, cr.order_id, b.bill_number,
            pm.name AS payment_method_name, pm.type AS payment_method_type
       FROM customer_credit_payments ccp
       JOIN customer_receivables cr ON cr.id = ccp.receivable_id
       JOIN bills b ON b.id = cr.bill_id
       JOIN payment_methods pm ON pm.id = ccp.payment_method_id
      WHERE ccp.organization_id = ? AND cr.organization_id = ? AND cr.customer_id = ?
      ORDER BY ccp.created_at DESC, ccp.id DESC`,
    [organizationId, organizationId, customerId]
  );

  const outstanding = round4(receivables.reduce((sum, row) => sum + Number(row.outstanding_amount || 0), 0));
  const totalCreditPurchases = round4(receivables.reduce((sum, row) => sum + Number(row.original_amount || 0), 0));
  const totalRepaid = round4(repayments.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const overdue = round4(receivables.reduce((sum, row) => sum + (Boolean(row.is_overdue) ? Number(row.outstanding_amount || 0) : 0), 0));
  const creditLimit = round4(Number(customers[0].credit_limit || 0));
  const availableCredit = creditLimit > EPSILON ? Math.max(0, round4(creditLimit - outstanding)) : null;

  type StatementTransaction = {
    id: string;
    kind: 'CREDIT_SALE' | 'REPAYMENT';
    occurredAt: string;
    transaction: string;
    reference: string;
    billNumber: string;
    billId: number;
    orderId: number;
    receivableId: number;
    paymentMethodName: string | null;
    debit: number;
    credit: number;
    balance: number;
    notes: string | null;
    sortOrder: number;
  };

  const chronological: StatementTransaction[] = [
    ...receivables.map((row): StatementTransaction => ({
      id: `receivable-${Number(row.id)}`,
      kind: 'CREDIT_SALE',
      occurredAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      transaction: 'Credit sale',
      reference: String(row.bill_number),
      billNumber: String(row.bill_number),
      billId: Number(row.bill_id),
      orderId: Number(row.order_id),
      receivableId: Number(row.id),
      paymentMethodName: null,
      debit: round4(Number(row.original_amount || 0)),
      credit: 0,
      balance: 0,
      notes: row.notes == null ? null : String(row.notes),
      sortOrder: 0,
    })),
    ...repayments.map((row): StatementTransaction => ({
      id: `repayment-${Number(row.id)}`,
      kind: 'REPAYMENT',
      occurredAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      transaction: 'Payment received',
      reference: row.external_reference == null || String(row.external_reference).trim() === '' ? String(row.bill_number) : String(row.external_reference),
      billNumber: String(row.bill_number),
      billId: Number(row.bill_id),
      orderId: Number(row.order_id),
      receivableId: Number(row.receivable_id),
      paymentMethodName: String(row.payment_method_name),
      debit: 0,
      credit: round4(Number(row.amount || 0)),
      balance: 0,
      notes: row.notes == null ? null : String(row.notes),
      sortOrder: 1,
    })),
  ].sort((a, b) => {
    const time = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (time) return time;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  let runningBalance = 0;
  const transactions = chronological.map((entry) => {
    runningBalance = Math.max(0, round4(runningBalance + entry.debit - entry.credit));
    const { sortOrder: _sortOrder, ...transaction } = entry;
    return { ...transaction, balance: runningBalance };
  }).reverse();

  return {
    customer: {
      id: Number(customers[0].id),
      name: String(customers[0].name),
      phone: customers[0].phone == null ? null : String(customers[0].phone),
    },
    outstanding,
    totalCreditPurchases,
    totalRepaid,
    overdue,
    creditLimit,
    availableCredit,
    isOverLimit: creditLimit > EPSILON && outstanding > creditLimit + EPSILON,
    receivables: receivables.map((row) => ({
      id: Number(row.id),
      branchId: Number(row.branch_id),
      billId: Number(row.bill_id),
      orderId: Number(row.order_id),
      billNumber: String(row.bill_number),
      originalAmount: Number(row.original_amount),
      outstandingAmount: Number(row.outstanding_amount),
      dueDate: row.due_date == null ? null : String(row.due_date),
      isOverdue: Boolean(row.is_overdue),
      status: String(row.status),
      notes: row.notes == null ? null : String(row.notes),
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    })),
    transactions,
  };
}

export async function recordCustomerCreditPayment(data: {
  organizationId: number; branchId: number; userId: number; receivableId: number; paymentMethodId: number; amount: number;
  tenderAmount?: number; externalReference?: string; notes?: string; businessDate: string; idempotencyKey: string;
}) {
  const pool = getDatabasePool(); const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM customer_credit_payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? FOR UPDATE',
      [data.organizationId, data.branchId, data.idempotencyKey]
    );
    if (existing.length) { await conn.rollback(); return listCustomerCreditLedger(data.organizationId, Number((await pool.execute<RowDataPacket[]>('SELECT customer_id FROM customer_receivables WHERE id = ?', [data.receivableId]))[0][0]?.customer_id)); }
    const [receivables] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM customer_receivables WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [data.receivableId, data.organizationId, data.branchId]
    );
    if (!receivables.length) throw new NotFoundError('Customer credit record not found', 'CREDIT_NOT_FOUND');
    const receivable = receivables[0]; const amount = round4(Number(data.amount));
    if (!(amount > 0) || amount > Number(receivable.outstanding_amount) + EPSILON) throw new BadRequestError('Repayment amount is invalid', 'INVALID_CREDIT_REPAYMENT');
    const [methods] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM payment_methods WHERE id = ? AND organization_id = ? AND (branch_id IS NULL OR branch_id = ?) AND is_active = TRUE FOR UPDATE`,
      [data.paymentMethodId, data.organizationId, data.branchId]
    );
    if (!methods.length || String(methods[0].type) === 'CREDIT') throw new NotFoundError('Select an active non-credit payment method', 'PAYMENT_METHOD_NOT_FOUND');
    if (Boolean(methods[0].requires_reference) && !data.externalReference?.trim()) throw new BadRequestError('A payment reference is required', 'PAYMENT_REFERENCE_REQUIRED');
    const tender = data.tenderAmount == null ? null : Number(data.tenderAmount);
    if (String(methods[0].type) === 'CASH' && tender != null && tender + EPSILON < amount) throw new BadRequestError('Cash received cannot be less than repayment amount', 'INVALID_CASH_TENDER');
    const change = String(methods[0].type) === 'CASH' && tender != null ? Math.max(0, round4(tender - amount)) : 0;
    await conn.execute(
      `INSERT INTO customer_credit_payments (organization_id, branch_id, receivable_id, payment_method_id, amount, tender_amount, change_amount, external_reference, notes, business_date, created_by, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.organizationId, data.branchId, data.receivableId, data.paymentMethodId, amount, tender, change, data.externalReference?.trim() || null, data.notes?.trim() || null, data.businessDate, data.userId, data.idempotencyKey]
    );
    const remaining = Math.max(0, round4(Number(receivable.outstanding_amount) - amount));
    const status = remaining <= EPSILON ? 'PAID' : 'PARTIALLY_PAID';
    await conn.execute(
      `UPDATE customer_receivables SET outstanding_amount = ?, status = ?, settled_at = CASE WHEN ? = 'PAID' THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = ?`,
      [remaining, status, status, data.receivableId]
    );
    await conn.commit();
    return listCustomerCreditLedger(data.organizationId, Number(receivable.customer_id));
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
