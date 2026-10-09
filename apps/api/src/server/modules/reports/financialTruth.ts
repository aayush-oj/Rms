import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ReportFilters } from './types';

const n = (value: unknown) => Number(value || 0);
const money = (value: unknown) => Math.round((n(value) + Number.EPSILON) * 10000) / 10000;

export interface FinancialReportScope {
  organizationId: number;
  branchIds: number[];
}

function inClause(ids: number[]): string {
  return ids.map(() => '?').join(',');
}

function billScope(scope: FinancialReportScope, filters: ReportFilters) {
  const clauses = ['b.organization_id = ?', `b.branch_id IN (${inClause(scope.branchIds)})`, "b.status = 'FINALIZED'"];
  const params: Array<string | number> = [scope.organizationId, ...scope.branchIds];
  if (filters.businessDayId) { clauses.push('b.business_day_id = ?'); params.push(filters.businessDayId); }
  if (filters.from) { clauses.push('b.business_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('b.business_date <= ?'); params.push(filters.to); }
  if (filters.shiftId) { clauses.push('b.shift_id = ?'); params.push(filters.shiftId); }
  if (filters.registerId) { clauses.push('b.register_id = ?'); params.push(filters.registerId); }
  return { clauses, params };
}

/**
 * Reconciles invoice truth with current collection truth for the same finalized-bill cohort.
 * Sales/Tax reports intentionally measure finalized bill snapshots; Payments/Shift Cash
 * intentionally measure captured payments. This bridge makes the difference explicit.
 */
export async function financialReconciliationReport(scope: FinancialReportScope, filters: ReportFilters) {
  const scoped = billScope(scope, filters);
  const where = scoped.clauses.join(' AND ');
  const pool = getDatabasePool();

  const [billRows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS bill_count,
       COUNT(DISTINCT b.order_id) AS order_count,
       COALESCE(SUM(b.grand_total),0) AS billed_total,
       COALESCE(SUM(b.amount_paid),0) AS current_paid_total,
       COALESCE(SUM(b.balance_due),0) AS outstanding_total,
       SUM(CASE WHEN b.balance_due <= 0.0001 THEN 1 ELSE 0 END) AS settled_bills,
       SUM(CASE WHEN b.amount_paid > 0.0001 AND b.balance_due > 0.0001 THEN 1 ELSE 0 END) AS partial_bills,
       SUM(CASE WHEN b.amount_paid <= 0.0001 THEN 1 ELSE 0 END) AS unpaid_bills,
       COALESCE(SUM(b.tax_total),0) AS tax_total
     FROM bills b
     WHERE ${where}`,
    scoped.params
  );

  const [paymentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(SUM(CASE WHEN p.status = 'CAPTURED' THEN p.amount ELSE 0 END),0) AS captured_total,
       COALESCE(SUM(CASE WHEN p.status = 'REVERSED' THEN p.amount ELSE 0 END),0) AS reversed_total,
       SUM(CASE WHEN p.status = 'CAPTURED' THEN 1 ELSE 0 END) AS captured_count,
       SUM(CASE WHEN p.status = 'REVERSED' THEN 1 ELSE 0 END) AS reversed_count
     FROM payments p
     JOIN bills b ON b.id = p.bill_id
       AND b.organization_id = p.organization_id
       AND b.branch_id = p.branch_id
     WHERE ${where}`,
    scoped.params
  );

  const bill = billRows[0] ?? ({} as RowDataPacket);
  const payment = paymentRows[0] ?? ({} as RowDataPacket);
  const billed = money(bill.billed_total);
  const currentPaid = money(bill.current_paid_total);
  const outstanding = money(bill.outstanding_total);
  const captured = money(payment.captured_total);

  return {
    summary: {
      billedRevenue: billed,
      currentPaid: currentPaid,
      outstanding,
      capturedPayments: captured,
      reversedPayments: money(payment.reversed_total),
      billCount: n(bill.bill_count),
      orderCount: n(bill.order_count),
      settledBills: n(bill.settled_bills),
      partialBills: n(bill.partial_bills),
      unpaidBills: n(bill.unpaid_bills),
      capturedPaymentCount: n(payment.captured_count),
      reversedPaymentCount: n(payment.reversed_count),
      tax: money(bill.tax_total),
      collectionRatePercent: billed > 0 ? money((currentPaid * 100) / billed) : 0,
    },
    reconciliation: {
      billedEqualsPaidPlusOutstanding: Math.abs(billed - currentPaid - outstanding) <= 0.01,
      capturedMatchesCurrentPaid: Math.abs(captured - currentPaid) <= 0.01,
    },
    definitions: {
      billedRevenue: 'Finalized bill grand totals in the selected bill period.',
      currentPaid: 'Current amount_paid on those finalized bills after any reversals.',
      capturedPayments: 'Payments still in CAPTURED state for those same bills.',
      outstanding: 'Current balance still due on those finalized bills.',
      reversedPayments: 'Payments on those bills that are currently marked REVERSED.',
    },
  };
}

/** Shift/cash reporting with the same branch/date semantics as the other financial reports. */
export async function shiftFinancialReport(scope: FinancialReportScope, filters: ReportFilters) {
  const clauses = ['s.organization_id = ?', `s.branch_id IN (${inClause(scope.branchIds)})`];
  const params: Array<string | number> = [scope.organizationId, ...scope.branchIds];
  if (filters.businessDayId) { clauses.push('s.business_day_id = ?'); params.push(filters.businessDayId); }
  if (filters.from) { clauses.push('bd.business_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('bd.business_date <= ?'); params.push(filters.to); }
  if (filters.shiftId) { clauses.push('s.id = ?'); params.push(filters.shiftId); }
  if (filters.registerId) { clauses.push('s.register_id = ?'); params.push(filters.registerId); }
  if (filters.staffId) { clauses.push('s.cashier_id = ?'); params.push(filters.staffId); }

  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
    `SELECT s.id, bd.business_date, r.name register_name, u.name cashier, s.status,
            s.opening_cash, s.expected_cash, s.counted_cash, s.variance, s.variance_status,
            s.opened_at, s.closed_at,
            COALESCE(SUM(CASE WHEN pm.type='CASH' AND p.status='CAPTURED' THEN p.amount ELSE 0 END),0) cash_sales,
            COALESCE(SUM(CASE WHEN p.status='CAPTURED' THEN p.amount ELSE 0 END),0) captured_payments,
            COALESCE(SUM(CASE WHEN p.status='REVERSED' THEN p.amount ELSE 0 END),0) reversed_payments
       FROM shifts s
       JOIN business_days bd ON bd.id=s.business_day_id AND bd.organization_id=s.organization_id AND bd.branch_id=s.branch_id
       JOIN registers r ON r.id=s.register_id
       JOIN users u ON u.id=s.cashier_id
       LEFT JOIN payments p ON p.shift_id=s.id AND p.organization_id=s.organization_id AND p.branch_id=s.branch_id
       LEFT JOIN payment_methods pm ON pm.id=p.payment_method_id
      WHERE ${clauses.join(' AND ')}
      GROUP BY s.id,bd.business_date,r.name,u.name
      ORDER BY s.opened_at DESC`,
    params
  );

  return {
    rows: rows.map((row) => ({
      id: n(row.id),
      businessDate: String(row.business_date),
      register: String(row.register_name),
      cashier: String(row.cashier),
      status: String(row.status),
      openingCash: money(row.opening_cash),
      cashSales: money(row.cash_sales),
      capturedPayments: money(row.captured_payments),
      reversedPayments: money(row.reversed_payments),
      expectedCash: row.expected_cash == null ? null : money(row.expected_cash),
      countedCash: row.counted_cash == null ? null : money(row.counted_cash),
      variance: row.variance == null ? null : money(row.variance),
      varianceStatus: row.variance_status == null ? null : String(row.variance_status),
      openedAt: String(row.opened_at),
      closedAt: row.closed_at == null ? null : String(row.closed_at),
    })),
  };
}
