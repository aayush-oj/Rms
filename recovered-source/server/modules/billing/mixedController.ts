import { Request, Response, NextFunction } from 'express';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError } from '../../shared/errors';
import { realtimePublisher } from '../../realtime/publisher';
import { appendDomainAudit } from '../domainAudit/service';
import { billingService } from './service';

function context(req: Request) {
  if (!req.user?.organizationId) throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
  if (!req.user.activeBranchId) throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
  return { organizationId: req.user.organizationId, branchId: req.user.activeBranchId, userId: req.user.id };
}

function positiveId(value: string | undefined, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError(`Valid ${label} ID is required`, `INVALID_${label.toUpperCase()}_ID`);
  return id;
}

export const mixedBillingController = {
  discount: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req); const orderId = positiveId(req.params.orderId, 'order');
      const result = await billingService.applyDiscount(orderId, c.organizationId, c.branchId, req.body.type, Number(req.body.value));
      realtimePublisher.publish({ type: 'bill.discount_updated', organizationId: c.organizationId, branchId: c.branchId, entityType: 'order', entityId: orderId, data: { orderId, discountTotal: result.discountTotal, grandTotal: result.grandTotal } });
      appendDomainAudit(req, { action: 'BILL_DISCOUNT_UPDATED', entityType: 'order', entityId: orderId, after: result });
      res.json({ success: true, data: result } satisfies ApiSuccessResponse<any>);
    } catch (error) { next(error); }
  },

  settlementSummary: async (req: Request, res: Response, next: NextFunction) => {
    try { const c = context(req); const billId = positiveId(req.params.id, 'bill'); res.json({ success: true, data: await billingService.getSettlementSummary(billId, c.organizationId, c.branchId) } satisfies ApiSuccessResponse<any>); }
    catch (error) { next(error); }
  },

  settleMixed: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req); const billId = positiveId(req.params.id, 'bill');
      const result = await billingService.settleMixed(billId, c.organizationId, c.branchId, c.userId, req.body);
      realtimePublisher.publish({ type: 'bill.updated', organizationId: c.organizationId, branchId: c.branchId, entityType: 'bill', entityId: billId, data: { billId, orderId: result.orderId, amountPaid: result.amountPaid, creditTotal: result.creditTotal, balanceDue: result.balanceDue } });
      realtimePublisher.publish({ type: 'order.payment_status_changed', organizationId: c.organizationId, branchId: c.branchId, entityType: 'order', entityId: result.orderId, data: { orderId: result.orderId, paymentStatus: result.paymentStatus, settlementStatus: result.settlementStatus, orderStatus: result.orderStatus } });
      if (result.completedNow && result.tableId != null) realtimePublisher.publish({ type: 'table.order_released', organizationId: c.organizationId, branchId: c.branchId, entityType: 'table', entityId: result.tableId, data: { tableId: result.tableId, orderId: result.orderId, status: result.tableStatus || 'available' } });
      appendDomainAudit(req, { action: 'BILL_MIXED_SETTLEMENT_RECORDED', entityType: 'bill', entityId: billId, relatedEntityType: 'order', relatedEntityId: result.orderId, after: { amountPaid: result.amountPaid, creditTotal: result.creditTotal, balanceDue: result.balanceDue, settlementStatus: result.settlementStatus }, metadata: { paymentLines: req.body.payments?.length || 0, hasCredit: Boolean(req.body.credit) } });
      res.status(201).json({ success: true, data: result } satisfies ApiSuccessResponse<any>);
    } catch (error) { next(error); }
  },

  customers: async (req: Request, res: Response, next: NextFunction) => {
    try { const c = context(req); res.json({ success: true, data: await billingService.searchCustomers(c.organizationId, String(req.query.search || '')) } satisfies ApiSuccessResponse<any>); }
    catch (error) { next(error); }
  },

  quickCustomer: async (req: Request, res: Response, next: NextFunction) => {
    try { const c = context(req); const customer = await billingService.quickCreateCustomer(c.organizationId, req.body.name, req.body.phone, c.userId); res.status(201).json({ success: true, data: customer } satisfies ApiSuccessResponse<any>); }
    catch (error) { next(error); }
  },

  creditAccounts: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      res.json({ success: true, data: await billingService.customerCreditAccounts(c.organizationId) } satisfies ApiSuccessResponse<any>);
    } catch (error) { next(error); }
  },

  customerLedger: async (req: Request, res: Response, next: NextFunction) => {
    try { const c = context(req); const customerId = positiveId(req.params.customerId, 'customer'); res.json({ success: true, data: await billingService.customerCreditLedger(c.organizationId, customerId) } satisfies ApiSuccessResponse<any>); }
    catch (error) { next(error); }
  },

  repayCredit: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req); const receivableId = positiveId(req.params.receivableId, 'receivable');
      const result = await billingService.repayCustomerCredit(c.organizationId, c.branchId, c.userId, receivableId, req.body);
      appendDomainAudit(req, { action: 'CUSTOMER_CREDIT_REPAYMENT_RECORDED', entityType: 'customer_receivable', entityId: receivableId, after: { amount: req.body.amount, paymentMethodId: req.body.paymentMethodId } });
      res.status(201).json({ success: true, data: result } satisfies ApiSuccessResponse<any>);
    } catch (error) { next(error); }
  },
};
