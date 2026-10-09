import { createHash } from 'node:crypto';
import { identityRepository } from '../identity/repository';
import { getDatabasePool } from '../../db/pool';
import { withTransactionRetry } from '../../db/transactionRetry';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { BillingRepository, billingRepository } from './repository';
import { Bill, PaymentInput, BillLine, SplitBillInput } from './types';
import { requireOpenShiftForUser, shiftRepository } from '../shift/repository';
import { assertOrderReadyForBilling } from './eligibility';
import { recordPaymentAndSettle, reversePaymentFinancially, type SettlementResult } from './settlement';
import { applyBillingDiscount } from './discount';
import {
  createBillingCustomer,
  getBillSettlementSummary,
  listCustomerCreditAccounts,
  listCustomerCreditLedger,
  recordCustomerCreditPayment,
  searchBillingCustomers,
  settleBillMixed,
  type CreditInput,
  type DiscountType,
  type MixedPaymentLineInput,
} from './mixedSettlement';

export class BillingService {
  constructor(private repo: BillingRepository = billingRepository) {}

  async preview(orderId: number, organizationId: number, branchId: number) {
    const pool = getDatabasePool();
    const [orders] = await pool.execute<any[]>('SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ?', [orderId, organizationId, branchId]);
    if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const order = orders[0];
    assertOrderReadyForBilling(order);
    const [items] = await pool.execute<any[]>(
      `SELECT oi.*
         FROM order_items oi
         JOIN order_rounds r ON r.id=oi.order_round_id
        WHERE oi.order_id=? AND r.status='ACTIVE'
        ORDER BY oi.id`,
      [orderId],
    );
    if (!items.length) throw new BadRequestError('Order has no items', 'ORDER_HAS_NO_ITEMS');
    const subtotal = Number(order.subtotal), discount = Number(order.discount), tax = Number(order.tax), grandTotal = Number(order.grand_total);
    const taxableAmount = Number(order.taxable_amount || 0);
    const roundingDelta = Number(order.rounding_delta ?? 0);
    const existingBill = await this.repo.findBillByOrder(orderId, organizationId, branchId);
    return { order, items, subtotal, discount, taxableAmount, tax, grandTotal, roundingDelta, businessDate: new Date(order.created_at).toISOString().slice(0, 10), existingBill };
  }

  async finalize(orderId: number, organizationId: number, branchId: number, finalizedBy: number): Promise<Bill> {
    const existing = await this.repo.findBillByOrder(orderId, organizationId, branchId);
    const splitSummary = await this.repo.getOrderBills(orderId, organizationId, branchId);
    if (splitSummary.bills.length > 1 || splitSummary.split) throw new ConflictError('This order uses split bills; finalize the split checks instead', 'ORDER_HAS_SPLIT_BILLS');
    if (existing) return existing;
    const day = await shiftRepository.getCurrentBusinessDay(organizationId, branchId);
    if (!day) throw new ConflictError('Open the business day before finalizing a bill', 'BUSINESS_DAY_REQUIRED');
    const shift = await requireOpenShiftForUser(organizationId, branchId, finalizedBy);
    if (shift.businessDayId !== day.id) throw new ConflictError('Active cashier shift does not belong to the current business day', 'SHIFT_CONTEXT_MISMATCH');
    const preview = await this.preview(orderId, organizationId, branchId);
    const branch = await identityRepository.findBranchById(organizationId, branchId);
    if (!branch) throw new NotFoundError('Branch not found', 'BRANCH_NOT_FOUND');
    const billNumber = String(preview.order.order_number);
    const lines: Omit<BillLine, 'id'|'billId'>[] = preview.items.map((i: any) => {
      const lineSubtotal = Number(i.line_subtotal);
      const discountAmount = Number(i.discount_amount_snapshot || 0);
      const taxableAmount = Number(i.taxable_amount || 0);
      const taxAmount = Number(i.tax_amount || 0);
      return {
        orderItemId: Number(i.id), menuItemId: Number(i.menu_item_id), itemNameSnapshot: String(i.item_name_snapshot),
        variantNameSnapshot: i.variant_name_snapshot == null ? null : String(i.variant_name_snapshot),
        modifierSnapshot: i.modifier_snapshot_json ? (typeof i.modifier_snapshot_json === 'string' ? JSON.parse(i.modifier_snapshot_json) : i.modifier_snapshot_json) : [],
        quantity: Number(i.quantity), unitPrice: Number(i.unit_price), lineSubtotal, discountAmount, taxableAmount, taxAmount,
        lineTotal: Number(i.line_total),
        notes: i.notes == null ? null : String(i.notes),
      };
    });
    const created = await this.repo.createFinalizedBill({
      organizationId, branchId, businessDayId: day.id, shiftId: shift.id, registerId: shift.registerId, orderId, billNumber, businessDate: day.businessDate, currency: 'NPR', subtotal: preview.subtotal,
      discountTotal: preview.discount, taxableAmount: preview.taxableAmount, taxTotal: preview.tax,
      vatRegisteredSnapshot: Boolean(preview.order.vat_registered_snapshot),
      taxRegistrationNumberSnapshot: preview.order.tax_registration_number_snapshot == null ? null : String(preview.order.tax_registration_number_snapshot),
      vatRateSnapshot: Number(preview.order.vat_rate_snapshot || 0),
      roundingMethodSnapshot: String(preview.order.rounding_method_snapshot || 'HALF_EVEN') as Bill['roundingMethodSnapshot'],
      roundingDelta: preview.roundingDelta,
      grandTotal: preview.grandTotal, finalizedBy, lines,
    });

    const discountType = String(preview.order.billing_discount_type || (Number(preview.order.manual_discount || 0) > 0 ? 'AMOUNT' : 'NONE'));
    const discountValue = Number(preview.order.billing_discount_value ?? (discountType === 'AMOUNT' ? preview.order.manual_discount || 0 : 0));
    await getDatabasePool().execute(
      `UPDATE bills SET discount_type = ?, discount_value = ?, discount_reason = NULL, updated_at = NOW()
       WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [discountType, discountValue, created.id, organizationId, branchId]
    );
    return (await this.repo.findBillById(created.id, organizationId, branchId)) || created;
  }

  async split(orderId: number, organizationId: number, branchId: number, performedBy: number, input: SplitBillInput, key?: string) {
    const idempotency = key ? { key, hash: createHash('sha256').update(JSON.stringify({ orderId, input })).digest('hex') } : undefined;
    if (idempotency && await this.repo.findSplitReplay(organizationId, branchId, orderId, idempotency)) return this.repo.getOrderBills(orderId, organizationId, branchId);
    const branch = await identityRepository.findBranchById(organizationId, branchId);
    if (!branch) throw new NotFoundError('Branch not found', 'BRANCH_NOT_FOUND');
    await this.preview(orderId, organizationId, branchId);
    const day = await shiftRepository.getCurrentBusinessDay(organizationId, branchId);
    if (!day) throw new ConflictError('Open the business day before splitting a bill', 'BUSINESS_DAY_REQUIRED');
    const shift = await requireOpenShiftForUser(organizationId, branchId, performedBy);
    if (shift.businessDayId !== day.id) throw new ConflictError('Active cashier shift does not belong to the current business day', 'SHIFT_CONTEXT_MISMATCH');
    return this.repo.splitOrder({
      organizationId, branchId, orderId, performedBy, mode: input.mode, bills: input.bills, billCount: input.billCount,
      idempotency,
      billPrefix: branch.billPrefix, businessDate: day.businessDate, businessDayId: day.id, shiftId: shift.id, registerId: shift.registerId,
    });
  }

  async getBill(id: number, organizationId: number, branchId: number): Promise<Bill> {
    const bill = await this.repo.findBillById(id, organizationId, branchId);
    if (!bill) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
    return bill;
  }

  async getBillForOrder(orderId: number, organizationId: number, branchId: number) {
    const result = await this.repo.getOrderBills(orderId, organizationId, branchId);
    if (!result.bills.length) return null;
    if (result.bills.length > 1) throw new ConflictError('Order has multiple bills; use the split-bill list', 'ORDER_HAS_MULTIPLE_BILLS');
    return result.bills[0];
  }

  async getBillsForOrder(orderId: number, organizationId: number, branchId: number) {
    return this.repo.getOrderBills(orderId, organizationId, branchId);
  }

  async pay(billId: number, organizationId: number, branchId: number, createdBy: number, input: PaymentInput) {
    const bill = await this.getBill(billId, organizationId, branchId);
    const amount = Number(input.amount);
    const isCash = input.tenderAmount != null;
    const changeAmount = isCash ? Math.max(0, Number(input.tenderAmount) - amount) : 0;
    const requestHash = createHash('sha256').update(JSON.stringify({
      billId, paymentMethodId: input.paymentMethodId, amount, tenderAmount: input.tenderAmount ?? null,
      externalReference: input.externalReference ?? null, notes: input.notes ?? null,
    })).digest('hex');

    const replay = await this.repo.findPaymentReplay(organizationId, branchId, input.idempotencyKey, requestHash);
    if (replay) {
      const updatedBill = await this.getBill(billId, organizationId, branchId);
      const state = await this.repo.getOrderBills(updatedBill.orderId, organizationId, branchId);
      const settlement: SettlementResult = {
        orderId: state.order.id,
        orderStatus: state.order.orderStatus,
        paymentStatus: state.order.paymentStatus as SettlementResult['paymentStatus'],
        completedNow: false,
        diningTableId: null,
        tableStatus: null,
        payment: replay,
      };
      return { payment: replay, bill: updatedBill, settlement };
    }

    const shift = await requireOpenShiftForUser(organizationId, branchId, createdBy);
    if (bill.businessDayId != null && bill.businessDayId !== shift.businessDayId) throw new ConflictError('Bill belongs to a different business day', 'BILL_BUSINESS_DAY_MISMATCH');

    const settlement = await withTransactionRetry(() => recordPaymentAndSettle({
      organizationId, branchId, billId, paymentMethodId: input.paymentMethodId, amount,
      tenderAmount: input.tenderAmount, changeAmount, businessDate: bill.businessDate,
      businessDayId: shift.businessDayId, shiftId: shift.id, registerId: shift.registerId,
      externalReference: input.externalReference, notes: input.notes, idempotencyKey: input.idempotencyKey,
      requestHash, createdBy,
    }));
    const updatedBill = await this.getBill(billId, organizationId, branchId);
    return { payment: settlement.payment, bill: updatedBill, settlement };
  }

  async applyDiscount(orderId: number, organizationId: number, branchId: number, type: DiscountType, value: number) {
    await this.preview(orderId, organizationId, branchId);
    return applyBillingDiscount({ organizationId, branchId, orderId, type, value });
  }

  async settleMixed(billId: number, organizationId: number, branchId: number, userId: number, input: { payments: MixedPaymentLineInput[]; credit?: CreditInput | null; idempotencyKey: string }) {
    const bill = await this.getBill(billId, organizationId, branchId);
    const shift = await requireOpenShiftForUser(organizationId, branchId, userId);
    if (bill.businessDayId != null && bill.businessDayId !== shift.businessDayId) throw new ConflictError('Bill belongs to a different business day', 'BILL_BUSINESS_DAY_MISMATCH');
    return withTransactionRetry(() => settleBillMixed({
      organizationId, branchId, userId, billId, businessDayId: shift.businessDayId, shiftId: shift.id, registerId: shift.registerId,
      businessDate: bill.businessDate, payments: input.payments, credit: input.credit, idempotencyKey: input.idempotencyKey,
    }));
  }

  async getSettlementSummary(billId: number, organizationId: number, branchId: number) {
    return getBillSettlementSummary(organizationId, branchId, billId);
  }

  async searchCustomers(organizationId: number, search: string) { return searchBillingCustomers(organizationId, search); }
  async quickCreateCustomer(organizationId: number, name: string, phone: string, userId: number) { return createBillingCustomer(organizationId, name, phone, userId); }
  async customerCreditAccounts(organizationId: number) { return listCustomerCreditAccounts(organizationId); }
  async customerCreditLedger(organizationId: number, customerId: number) { return listCustomerCreditLedger(organizationId, customerId); }

  async repayCustomerCredit(organizationId: number, branchId: number, userId: number, receivableId: number, input: { paymentMethodId: number; amount: number; tenderAmount?: number; externalReference?: string; notes?: string; idempotencyKey: string }) {
    const shift = await requireOpenShiftForUser(organizationId, branchId, userId);
    const day = await shiftRepository.getCurrentBusinessDay(organizationId, branchId);
    if (!day || day.id !== shift.businessDayId) throw new ConflictError('Open the current business day before recording credit repayment', 'BUSINESS_DAY_REQUIRED');
    return recordCustomerCreditPayment({ organizationId, branchId, userId, receivableId, businessDate: day.businessDate, ...input });
  }

  async listPayments(billId: number, organizationId: number, branchId: number) {
    await this.getBill(billId, organizationId, branchId);
    return this.repo.listPayments(billId, organizationId, branchId);
  }

  async reversePayment(id: number, organizationId: number, branchId: number, actor: number, reason: string) {
    await requireOpenShiftForUser(organizationId, branchId, actor);
    return withTransactionRetry(() => reversePaymentFinancially(id, organizationId, branchId, actor, reason));
  }
}

export const billingService = new BillingService();
