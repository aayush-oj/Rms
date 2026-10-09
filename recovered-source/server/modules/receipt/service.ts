import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { billingService } from '../billing/service';

export type ReceiptPaperSize = 'AUTO' | '58MM' | '80MM' | 'A4';

export interface ReceiptSettings {
  title: string;
  paperSize: ReceiptPaperSize;
  printCopies: 1 | 2;
  headerNote: string | null;
  footerNote: string | null;
  showBranch: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showTaxId: boolean;
  showOrderNumber: boolean;
  showTable: boolean;
  showWaiter: boolean;
  showCashier: boolean;
  showPaymentSummary: boolean;
}

const defaults: ReceiptSettings = {
  title: 'RECEIPT',
  paperSize: '80MM',
  printCopies: 1,
  headerNote: null,
  footerNote: 'Thank you for dining with us!',
  showBranch: true,
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showTaxId: true,
  showOrderNumber: true,
  showTable: true,
  showWaiter: true,
  showCashier: true,
  showPaymentSummary: true,
};

function mapSettings(row?: RowDataPacket): ReceiptSettings {
  if (!row) return { ...defaults };
  return {
    title: String(row.receipt_title || defaults.title),
    paperSize: (row.receipt_paper_size || defaults.paperSize) as ReceiptPaperSize,
    printCopies: Number(row.receipt_print_copies) === 2 ? 2 : 1,
    headerNote: row.receipt_header == null ? null : String(row.receipt_header),
    footerNote: row.receipt_footer == null ? null : String(row.receipt_footer),
    showBranch: Boolean(row.receipt_show_branch),
    showAddress: Boolean(row.receipt_show_address),
    showPhone: Boolean(row.receipt_show_phone),
    showEmail: Boolean(row.receipt_show_email),
    showTaxId: Boolean(row.receipt_show_tax_id),
    showOrderNumber: Boolean(row.receipt_show_order_number),
    showTable: Boolean(row.receipt_show_table),
    showWaiter: Boolean(row.receipt_show_waiter),
    showCashier: Boolean(row.receipt_show_cashier),
    showPaymentSummary: Boolean(row.receipt_show_payment_summary),
  };
}

export async function getReceiptSettings(organizationId: number, branchId: number): Promise<ReceiptSettings> {
  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
    `SELECT receipt_header, receipt_footer, receipt_title, receipt_paper_size, receipt_print_copies,
            receipt_show_branch, receipt_show_address, receipt_show_phone, receipt_show_email,
            receipt_show_tax_id, receipt_show_order_number, receipt_show_table, receipt_show_waiter,
            receipt_show_cashier, receipt_show_payment_summary
       FROM operational_settings
      WHERE organization_id = ? AND branch_id = ?
      LIMIT 1`,
    [organizationId, branchId]
  );
  return mapSettings(rows[0]);
}

export async function updateReceiptSettings(
  organizationId: number,
  branchId: number,
  input: ReceiptSettings
): Promise<ReceiptSettings> {
  await getDatabasePool().execute(
    `INSERT INTO operational_settings
      (organization_id, branch_id, receipt_header, receipt_footer, receipt_title, receipt_paper_size, receipt_print_copies,
       receipt_show_branch, receipt_show_address, receipt_show_phone, receipt_show_email,
       receipt_show_tax_id, receipt_show_order_number, receipt_show_table, receipt_show_waiter,
       receipt_show_cashier, receipt_show_payment_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       receipt_header = VALUES(receipt_header),
       receipt_footer = VALUES(receipt_footer),
       receipt_title = VALUES(receipt_title),
       receipt_paper_size = VALUES(receipt_paper_size),
       receipt_print_copies = VALUES(receipt_print_copies),
       receipt_show_branch = VALUES(receipt_show_branch),
       receipt_show_address = VALUES(receipt_show_address),
       receipt_show_phone = VALUES(receipt_show_phone),
       receipt_show_email = VALUES(receipt_show_email),
       receipt_show_tax_id = VALUES(receipt_show_tax_id),
       receipt_show_order_number = VALUES(receipt_show_order_number),
       receipt_show_table = VALUES(receipt_show_table),
       receipt_show_waiter = VALUES(receipt_show_waiter),
       receipt_show_cashier = VALUES(receipt_show_cashier),
       receipt_show_payment_summary = VALUES(receipt_show_payment_summary),
       updated_at = NOW()`,
    [
      organizationId, branchId, input.headerNote, input.footerNote, input.title, input.paperSize, input.printCopies,
      input.showBranch, input.showAddress, input.showPhone, input.showEmail,
      input.showTaxId, input.showOrderNumber, input.showTable, input.showWaiter,
      input.showCashier, input.showPaymentSummary,
    ]
  );
  return getReceiptSettings(organizationId, branchId);
}

export async function getReceiptDocument(billId: number, organizationId: number, branchId: number) {
  const bill = await billingService.getBill(billId, organizationId, branchId);
  const pool = getDatabasePool();
  const [organizationRows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, name, legal_name, tax_identifier, currency_code FROM organizations WHERE id = ?',
    [organizationId]
  );
  const [branchRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, code, address, phone, email, bill_prefix, timezone
       FROM branches WHERE id = ? AND organization_id = ?`,
    [branchId, organizationId]
  );
  const [orderRows] = await pool.execute<RowDataPacket[]>(
    `SELECT o.id, o.order_number, o.order_type, o.created_at, o.dining_table_id, o.waiter_id,
            dt.table_number, waiter.name AS waiter_name
       FROM orders o
       LEFT JOIN dining_tables dt ON dt.id = o.dining_table_id AND dt.organization_id = o.organization_id
       LEFT JOIN users waiter ON waiter.id = o.waiter_id AND waiter.organization_id = o.organization_id
      WHERE o.id = ? AND o.organization_id = ? AND o.branch_id = ?`,
    [bill.orderId, organizationId, branchId]
  );
  const [paymentRows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.id, p.amount, p.tender_amount, p.change_amount, p.status, p.external_reference,
            p.created_at, pm.name AS payment_method_name, cashier.name AS cashier_name
       FROM payments p
       LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id AND pm.organization_id = p.organization_id
       LEFT JOIN users cashier ON cashier.id = p.created_by AND cashier.organization_id = p.organization_id
      WHERE p.bill_id = ? AND p.organization_id = ? AND p.branch_id = ?
      ORDER BY p.id ASC`,
    [billId, organizationId, branchId]
  );
  const settings = await getReceiptSettings(organizationId, branchId);
  const lastCaptured = [...paymentRows].reverse().find((row) => row.status === 'CAPTURED');

  return {
    settings,
    organization: organizationRows[0] ? {
      name: String(organizationRows[0].name),
      legalName: organizationRows[0].legal_name == null ? null : String(organizationRows[0].legal_name),
      taxIdentifier: bill.taxRegistrationNumberSnapshot,
      currencyCode: String(organizationRows[0].currency_code || bill.currency || 'NPR'),
    } : null,
    branch: branchRows[0] ? {
      name: String(branchRows[0].name),
      code: String(branchRows[0].code),
      address: branchRows[0].address == null ? null : String(branchRows[0].address),
      phone: branchRows[0].phone == null ? null : String(branchRows[0].phone),
      email: branchRows[0].email == null ? null : String(branchRows[0].email),
      billPrefix: String(branchRows[0].bill_prefix || ''),
      timezone: String(branchRows[0].timezone || 'Asia/Kathmandu'),
    } : null,
    order: orderRows[0] ? {
      id: Number(orderRows[0].id),
      orderNumber: String(orderRows[0].order_number),
      orderType: String(orderRows[0].order_type),
      createdAt: new Date(orderRows[0].created_at).toISOString(),
      tableNumber: orderRows[0].table_number == null ? null : String(orderRows[0].table_number),
      waiterName: orderRows[0].waiter_name == null ? null : String(orderRows[0].waiter_name),
    } : null,
    cashierName: lastCaptured?.cashier_name == null ? null : String(lastCaptured.cashier_name),
    vatStatus: bill.vatRegisteredSnapshot ? 'VAT_REGISTERED' : 'NOT_VAT_REGISTERED',
    bill,
    payments: paymentRows.map((row) => ({
      id: Number(row.id),
      amount: Number(row.amount),
      tenderAmount: row.tender_amount == null ? null : Number(row.tender_amount),
      changeAmount: Number(row.change_amount || 0),
      status: String(row.status),
      externalReference: row.external_reference == null ? null : String(row.external_reference),
      paymentMethodName: row.payment_method_name == null ? 'Payment' : String(row.payment_method_name),
      cashierName: row.cashier_name == null ? null : String(row.cashier_name),
      createdAt: new Date(row.created_at).toISOString(),
    })),
  };
}
