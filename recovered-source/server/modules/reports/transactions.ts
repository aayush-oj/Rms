import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { NotFoundError } from '../../shared/errors';

const EPSILON = 0.0001;
const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => Math.round((n(value) + Number.EPSILON) * 10000) / 10000;

export interface TransactionHistoryScope {
  organizationId: number;
  branchIds: number[];
}

export interface TransactionHistoryFilters {
  from?: string;
  to?: string;
  billNumber?: string;
  orderNumber?: string;
  tableId?: number;
  paymentMethodId?: number;
  staffId?: number;
  settlementStatus?: 'OPEN' | 'PARTIAL' | 'SETTLED';
  page?: number;
  limit?: number;
}

function inClause(values: number[]) { return values.map(() => '?').join(','); }

function settlementStatus(row: RowDataPacket): 'OPEN' | 'PARTIAL' | 'SETTLED' {
  const paid = n(row.amount_paid);
  const due = n(row.balance_due);
  if (due <= EPSILON) return 'SETTLED';
  if (paid > EPSILON) return 'PARTIAL';
  return 'OPEN';
}

export async function listTransactionHistory(scope: TransactionHistoryScope, filters: TransactionHistoryFilters) {
  const page = Math.max(1, Number(filters.page || 1));
  const limit = Math.min(100, Math.max(1, Number(filters.limit || 25)));
  const offset = (page - 1) * limit;
  const clauses = [
    'b.organization_id = ?',
    `b.branch_id IN (${inClause(scope.branchIds)})`,
    "b.status = 'FINALIZED'",
  ];
  const params: Array<string | number> = [scope.organizationId, ...scope.branchIds];

  if (filters.from) { clauses.push('b.business_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('b.business_date <= ?'); params.push(filters.to); }
  if (filters.billNumber) { clauses.push('b.bill_number LIKE ?'); params.push(`%${filters.billNumber}%`); }
  if (filters.orderNumber) { clauses.push('o.order_number LIKE ?'); params.push(`%${filters.orderNumber}%`); }
  if (filters.tableId) { clauses.push('o.dining_table_id = ?'); params.push(filters.tableId); }
  if (filters.paymentMethodId) {
    clauses.push(`EXISTS (SELECT 1 FROM payments fp WHERE fp.bill_id = b.id AND fp.organization_id = b.organization_id AND fp.branch_id = b.branch_id AND fp.payment_method_id = ? AND fp.status = 'CAPTURED')`);
    params.push(filters.paymentMethodId);
  }
  if (filters.staffId) {
    clauses.push(`EXISTS (SELECT 1 FROM payments fs WHERE fs.bill_id = b.id AND fs.organization_id = b.organization_id AND fs.branch_id = b.branch_id AND fs.created_by = ? AND fs.status = 'CAPTURED')`);
    params.push(filters.staffId);
  }
  if (filters.settlementStatus === 'SETTLED') clauses.push('b.balance_due <= 0.0001');
  if (filters.settlementStatus === 'PARTIAL') clauses.push('b.amount_paid > 0.0001 AND b.balance_due > 0.0001');
  if (filters.settlementStatus === 'OPEN') clauses.push('b.amount_paid <= 0.0001 AND b.balance_due > 0.0001');

  const where = clauses.join(' AND ');
  const pool = getDatabasePool();
  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM bills b
       JOIN orders o ON o.id = b.order_id AND o.organization_id = b.organization_id AND o.branch_id = b.branch_id
      WHERE ${where}`,
    params
  );

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.id AS bill_id, b.bill_number, b.business_date, b.finalized_at,
            b.grand_total, b.amount_paid, b.balance_due, b.split_sequence, b.split_total_count, b.split_mode,
            o.id AS order_id, o.order_number, o.order_type, o.order_status, o.payment_status,
            o.dining_table_id, dt.table_number,
            waiter.id AS waiter_id, waiter.name AS waiter_name,
            finalizer.id AS finalized_by_id, finalizer.name AS finalized_by_name,
            COUNT(DISTINCT CASE WHEN p.status = 'CAPTURED' THEN p.id END) AS captured_payment_count,
            COUNT(DISTINCT CASE WHEN p.status = 'REVERSED' THEN p.id END) AS reversed_payment_count,
            GROUP_CONCAT(DISTINCT CASE WHEN p.status = 'CAPTURED' THEN pm.name END ORDER BY pm.name SEPARATOR ', ') AS payment_methods,
            MAX(CASE WHEN p.status = 'CAPTURED' THEN p.created_at END) AS last_payment_at
       FROM bills b
       JOIN orders o ON o.id = b.order_id AND o.organization_id = b.organization_id AND o.branch_id = b.branch_id
       LEFT JOIN dining_tables dt ON dt.id = o.dining_table_id AND dt.organization_id = o.organization_id AND dt.branch_id = o.branch_id
       LEFT JOIN users waiter ON waiter.id = o.waiter_id AND waiter.organization_id = o.organization_id
       LEFT JOIN users finalizer ON finalizer.id = b.finalized_by AND finalizer.organization_id = b.organization_id
       LEFT JOIN payments p ON p.bill_id = b.id AND p.organization_id = b.organization_id AND p.branch_id = b.branch_id
       LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id AND pm.organization_id = b.organization_id
      WHERE ${where}
      GROUP BY b.id, b.bill_number, b.business_date, b.finalized_at, b.grand_total, b.amount_paid, b.balance_due,
               b.split_sequence, b.split_total_count, b.split_mode, o.id, o.order_number, o.order_type, o.order_status,
               o.payment_status, o.dining_table_id, dt.table_number, waiter.id, waiter.name, finalizer.id, finalizer.name
      ORDER BY COALESCE(last_payment_at, b.finalized_at, b.created_at) DESC, b.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const total = n(countRows[0]?.total);
  return {
    rows: rows.map((row) => ({
      billId: n(row.bill_id), billNumber: String(row.bill_number), businessDate: String(row.business_date),
      finalizedAt: row.finalized_at == null ? null : String(row.finalized_at),
      orderId: n(row.order_id), orderNumber: String(row.order_number), orderType: String(row.order_type),
      orderStatus: String(row.order_status), paymentStatus: String(row.payment_status),
      tableId: row.dining_table_id == null ? null : n(row.dining_table_id), tableNumber: row.table_number == null ? null : String(row.table_number),
      waiterId: row.waiter_id == null ? null : n(row.waiter_id), waiterName: row.waiter_name == null ? null : String(row.waiter_name),
      finalizedById: row.finalized_by_id == null ? null : n(row.finalized_by_id), finalizedByName: row.finalized_by_name == null ? null : String(row.finalized_by_name),
      grandTotal: money(row.grand_total), amountPaid: money(row.amount_paid), balanceDue: money(row.balance_due),
      settlementStatus: settlementStatus(row), splitMode: row.split_mode == null ? null : String(row.split_mode),
      splitSequence: row.split_sequence == null ? null : n(row.split_sequence), splitTotalCount: row.split_total_count == null ? null : n(row.split_total_count),
      capturedPaymentCount: n(row.captured_payment_count), reversedPaymentCount: n(row.reversed_payment_count),
      paymentMethods: row.payment_methods == null ? [] : String(row.payment_methods).split(', ').filter(Boolean),
      lastPaymentAt: row.last_payment_at == null ? null : String(row.last_payment_at),
    })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getTransactionHistoryDetail(scope: TransactionHistoryScope, billId: number) {
  const pool = getDatabasePool();
  const [billRows] = await pool.execute<RowDataPacket[]>(
    `SELECT b.*, o.order_number, o.order_type, o.order_status, o.payment_status, o.dining_table_id,
            dt.table_number, waiter.id AS waiter_id, waiter.name AS waiter_name,
            finalizer.id AS finalized_by_id, finalizer.name AS finalized_by_name
       FROM bills b
       JOIN orders o ON o.id = b.order_id AND o.organization_id = b.organization_id AND o.branch_id = b.branch_id
       LEFT JOIN dining_tables dt ON dt.id = o.dining_table_id AND dt.organization_id = o.organization_id AND dt.branch_id = o.branch_id
       LEFT JOIN users waiter ON waiter.id = o.waiter_id AND waiter.organization_id = o.organization_id
       LEFT JOIN users finalizer ON finalizer.id = b.finalized_by AND finalizer.organization_id = b.organization_id
      WHERE b.id = ? AND b.organization_id = ? AND b.branch_id IN (${inClause(scope.branchIds)}) AND b.status = 'FINALIZED'
      LIMIT 1`,
    [billId, scope.organizationId, ...scope.branchIds]
  );
  if (!billRows.length) throw new NotFoundError('Transaction bill not found', 'TRANSACTION_NOT_FOUND');
  const bill = billRows[0];

  const [lineRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, order_item_id, menu_item_id, item_name_snapshot, variant_name_snapshot, modifier_snapshot_json,
            quantity, unit_price, line_subtotal, discount_amount, taxable_amount, tax_amount, line_total, notes
       FROM bill_lines WHERE bill_id = ? AND organization_id = ? AND branch_id = ? ORDER BY id`,
    [billId, scope.organizationId, bill.branch_id]
  );
  const [paymentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.amount, p.tender_amount, p.change_amount, p.business_date, p.status, p.external_reference, p.notes,
            p.created_at, p.reversed_at, p.reversal_reason, pm.id AS payment_method_id, pm.name AS payment_method_name,
            pm.type AS payment_method_type, cashier.id AS cashier_id, cashier.name AS cashier_name,
            reverser.id AS reversed_by_id, reverser.name AS reversed_by_name
       FROM payments p
       JOIN payment_methods pm ON pm.id = p.payment_method_id AND pm.organization_id = p.organization_id
       LEFT JOIN users cashier ON cashier.id = p.created_by AND cashier.organization_id = p.organization_id
       LEFT JOIN users reverser ON reverser.id = p.reversed_by AND reverser.organization_id = p.organization_id
      WHERE p.bill_id = ? AND p.organization_id = ? AND p.branch_id = ? ORDER BY p.created_at, p.id`,
    [billId, scope.organizationId, bill.branch_id]
  );

  return {
    bill: {
      id: n(bill.id), billNumber: String(bill.bill_number), businessDate: String(bill.business_date), status: String(bill.status), currency: String(bill.currency),
      subtotal: money(bill.subtotal), discountTotal: money(bill.discount_total), taxableAmount: money(bill.taxable_amount), taxTotal: money(bill.tax_total),
      vatRegistered: Boolean(bill.vat_registered_snapshot), taxRegistrationNumber: bill.tax_registration_number_snapshot == null ? null : String(bill.tax_registration_number_snapshot),
      vatRate: money(bill.vat_rate_snapshot), roundingMethod: String(bill.rounding_method_snapshot), roundingDelta: money(bill.rounding_delta), grandTotal: money(bill.grand_total), amountPaid: money(bill.amount_paid), balanceDue: money(bill.balance_due),
      settlementStatus: settlementStatus(bill), splitMode: bill.split_mode == null ? null : String(bill.split_mode), splitSequence: bill.split_sequence == null ? null : n(bill.split_sequence),
      splitTotalCount: bill.split_total_count == null ? null : n(bill.split_total_count), finalizedAt: bill.finalized_at == null ? null : String(bill.finalized_at),
      finalizedBy: bill.finalized_by_id == null ? null : { id: n(bill.finalized_by_id), name: String(bill.finalized_by_name || '') },
    },
    order: {
      id: n(bill.order_id), orderNumber: String(bill.order_number), orderType: String(bill.order_type), orderStatus: String(bill.order_status), paymentStatus: String(bill.payment_status),
      tableId: bill.dining_table_id == null ? null : n(bill.dining_table_id), tableNumber: bill.table_number == null ? null : String(bill.table_number),
      waiter: bill.waiter_id == null ? null : { id: n(bill.waiter_id), name: String(bill.waiter_name || '') },
    },
    lines: lineRows.map((row) => ({
      id: n(row.id), orderItemId: row.order_item_id == null ? null : n(row.order_item_id), menuItemId: row.menu_item_id == null ? null : n(row.menu_item_id),
      itemName: String(row.item_name_snapshot), variantName: row.variant_name_snapshot == null ? null : String(row.variant_name_snapshot),
      modifiers: row.modifier_snapshot_json ? (typeof row.modifier_snapshot_json === 'string' ? JSON.parse(row.modifier_snapshot_json) : row.modifier_snapshot_json) : [],
      quantity: n(row.quantity), unitPrice: money(row.unit_price), lineSubtotal: money(row.line_subtotal), discountAmount: money(row.discount_amount),
      taxableAmount: money(row.taxable_amount), taxAmount: money(row.tax_amount), lineTotal: money(row.line_total), notes: row.notes == null ? null : String(row.notes),
    })),
    payments: paymentRows.map((row) => ({
      id: n(row.id), amount: money(row.amount), tenderAmount: row.tender_amount == null ? null : money(row.tender_amount), changeAmount: money(row.change_amount),
      businessDate: String(row.business_date), status: String(row.status), externalReference: row.external_reference == null ? null : String(row.external_reference), notes: row.notes == null ? null : String(row.notes),
      createdAt: String(row.created_at), paymentMethod: { id: n(row.payment_method_id), name: String(row.payment_method_name), type: String(row.payment_method_type) },
      cashier: row.cashier_id == null ? null : { id: n(row.cashier_id), name: String(row.cashier_name || '') },
      reversedAt: row.reversed_at == null ? null : String(row.reversed_at), reversalReason: row.reversal_reason == null ? null : String(row.reversal_reason),
      reversedBy: row.reversed_by_id == null ? null : { id: n(row.reversed_by_id), name: String(row.reversed_by_name || '') },
    })),
  };
}
