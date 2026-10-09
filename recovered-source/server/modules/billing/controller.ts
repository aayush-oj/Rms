import { Request, Response, NextFunction } from 'express';
import { ApiSuccessResponse } from '../../shared/types';
import { realtimePublisher } from '../../realtime/publisher';
import {
  publishBillUpdated,
  publishOrderCompleted,
  publishOrderPaymentStatusChanged,
  publishPaymentCompleted,
  publishPaymentReversed,
  publishTableOrderReleased,
} from '../../realtime/contracts';
import { appendDomainAudit } from '../domainAudit/service';
import { ForbiddenError, BadRequestError } from '../../shared/errors';
import { billingService } from './service';

function context(req: Request) {
  if (!req.user?.organizationId) throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
  if (!req.user.activeBranchId) throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
  return { organizationId: req.user.organizationId, branchId: req.user.activeBranchId, userId: req.user.id };
}

export class BillingController {
  preview = async (req: Request, res: Response, next: NextFunction) => {
    try { const c = context(req); const orderId = Number(req.params.orderId); if (!Number.isInteger(orderId)) throw new BadRequestError('Valid order ID is required','INVALID_ORDER_ID'); res.json({success:true,data:await billingService.preview(orderId,c.organizationId,c.branchId)} satisfies ApiSuccessResponse<any>); } catch(e){next(e)}
  };

  finalize = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      const orderId = Number(req.params.orderId);
      if (!Number.isInteger(orderId)) throw new BadRequestError('Valid order ID is required','INVALID_ORDER_ID');
      const bill = await billingService.finalize(orderId,c.organizationId,c.branchId,c.userId);
      realtimePublisher.publish({ type: 'bill.finalized', organizationId: c.organizationId, branchId: c.branchId, entityType: 'bill', entityId: bill.id, data: { orderId: bill.orderId, status: bill.status, grandTotal: bill.grandTotal } });
      appendDomainAudit(req, {
        action: 'BILL_FINALIZED',
        entityType: 'bill',
        entityId: bill.id,
        relatedEntityType: 'order',
        relatedEntityId: bill.orderId,
        after: { status: bill.status, grandTotal: bill.grandTotal, amountPaid: bill.amountPaid, balanceDue: bill.balanceDue },
        metadata: { businessDate: bill.businessDate, billNumber: bill.billNumber },
      });
      res.status(201).json({success:true,data:bill} satisfies ApiSuccessResponse<any>);
    } catch(e){next(e)}
  };

  get = async (req: Request,res: Response,next: NextFunction)=>{ try{const c=context(req); const id=Number(req.params.id); if(!Number.isInteger(id)) throw new BadRequestError('Valid bill ID is required','INVALID_BILL_ID'); res.json({success:true,data:await billingService.getBill(id,c.organizationId,c.branchId)} satisfies ApiSuccessResponse<any>)}catch(e){next(e)} };
  getForOrder = async (req: Request,res: Response,next: NextFunction)=>{ try{const c=context(req); const id=Number(req.params.orderId); if(!Number.isInteger(id)) throw new BadRequestError('Valid order ID is required','INVALID_ORDER_ID'); const bill=await billingService.getBillForOrder(id,c.organizationId,c.branchId); if(!bill) throw new BadRequestError('Bill has not been finalized for this order','BILL_NOT_FINALIZED'); res.json({success:true,data:bill} satisfies ApiSuccessResponse<any>)}catch(e){next(e)} };
  getBillsForOrder = async (req: Request,res: Response,next: NextFunction)=>{ try{const c=context(req); const id=Number(req.params.orderId); if(!Number.isInteger(id)) throw new BadRequestError('Valid order ID is required','INVALID_ORDER_ID'); res.json({success:true,data:await billingService.getBillsForOrder(id,c.organizationId,c.branchId)} satisfies ApiSuccessResponse<any>)}catch(e){next(e)} };

  split = async (req: Request,res: Response,next: NextFunction)=>{
    try{
      const c=context(req);
      const id=Number(req.params.orderId);
      if(!Number.isInteger(id)) throw new BadRequestError('Valid order ID is required','INVALID_ORDER_ID');
      const key = req.get('Idempotency-Key')?.trim();
      if (key && (key.length < 8 || key.length > 120)) throw new BadRequestError('Invalid split idempotency key', 'INVALID_IDEMPOTENCY_KEY');
      const result = await billingService.split(id,c.organizationId,c.branchId,c.userId,req.body,key);
      realtimePublisher.publish({ type: 'bill.split', organizationId: c.organizationId, branchId: c.branchId, entityType: 'bill', entityId: id, data: { orderId: id, split: true } });
      appendDomainAudit(req, {
        action: 'BILL_SPLIT_CREATED',
        entityType: 'order',
        entityId: id,
        after: {
          paymentStatus: result.order.paymentStatus,
          billCount: result.bills.length,
          splitMode: result.split?.splitMode ?? null,
          splitStatus: result.split?.status ?? null,
        },
        metadata: {
          billIds: result.bills.map((bill) => bill.id),
          splitBatchId: result.split?.id ?? null,
          idempotencyKey: key ?? null,
        },
      });
      res.status(201).json({success:true,data:result} satisfies ApiSuccessResponse<any>);
    }catch(e){next(e)}
  };

  listPayments = async (req: Request,res: Response,next: NextFunction)=>{ try{const c=context(req); const id=Number(req.params.id); if(!Number.isInteger(id)) throw new BadRequestError('Valid bill ID is required','INVALID_BILL_ID'); res.json({success:true,data:await billingService.listPayments(id,c.organizationId,c.branchId)} satisfies ApiSuccessResponse<any>)}catch(e){next(e)} };

  pay = async (req: Request,res: Response,next: NextFunction)=>{
    try {
      const c=context(req); const id=Number(req.params.id);
      if(!Number.isInteger(id)) throw new BadRequestError('Valid bill ID is required','INVALID_BILL_ID');
      const result=await billingService.pay(id,c.organizationId,c.branchId,c.userId,req.body);
      const tenant = { organizationId: c.organizationId, branchId: c.branchId };
      publishPaymentCompleted(tenant, {
        paymentId: result.payment.id,
        billId: result.bill.id,
        amount: result.payment.amount,
        paymentStatus: result.settlement.paymentStatus,
        orderId: result.bill.orderId,
      });
      publishBillUpdated(tenant, {
        billId: result.bill.id,
        orderId: result.bill.orderId,
        status: result.bill.status,
        amountPaid: result.bill.amountPaid,
        balanceDue: result.bill.balanceDue,
      });
      publishOrderPaymentStatusChanged(tenant, {
        orderId: result.settlement.orderId,
        paymentStatus: result.settlement.paymentStatus,
        orderStatus: result.settlement.orderStatus,
        billId: result.bill.id,
      });
      if (result.settlement.completedNow) {
        publishOrderCompleted(tenant, {
          orderId: result.settlement.orderId,
          paymentStatus: 'PAID',
          diningTableId: result.settlement.diningTableId,
        });
        if (result.settlement.diningTableId != null) {
          publishTableOrderReleased(tenant, {
            tableId: result.settlement.diningTableId,
            orderId: result.settlement.orderId,
            status: String(result.settlement.tableStatus || 'available'),
          });
        }
      }
      appendDomainAudit(req, {
        action: 'PAYMENT_CAPTURED',
        entityType: 'payment',
        entityId: result.payment.id,
        relatedEntityType: 'bill',
        relatedEntityId: result.bill.id,
        after: {
          paymentStatus: result.payment.status,
          amount: result.payment.amount,
          billAmountPaid: result.bill.amountPaid,
          billBalanceDue: result.bill.balanceDue,
          orderPaymentStatus: result.settlement.paymentStatus,
          orderStatus: result.settlement.orderStatus,
        },
        metadata: {
          orderId: result.bill.orderId,
          paymentMethodId: result.payment.paymentMethodId,
          idempotencyKey: result.payment.idempotencyKey,
          completedNow: result.settlement.completedNow,
          diningTableId: result.settlement.diningTableId,
        },
      });
      res.status(201).json({success:true,data:result} satisfies ApiSuccessResponse<any>);
    } catch(e){next(e)}
  };

  reverse = async (req: Request,res: Response,next: NextFunction)=>{
    try {
      const c=context(req); const id=Number(req.params.id);
      if(!Number.isInteger(id)) throw new BadRequestError('Valid payment ID is required','INVALID_PAYMENT_ID');
      const result = await billingService.reversePayment(id,c.organizationId,c.branchId,c.userId,req.body.reason);
      const tenant = { organizationId: c.organizationId, branchId: c.branchId };
      publishPaymentReversed(tenant, {
        paymentId: id,
        billId: result.payment.billId,
        status: result.payment.status,
        orderId: result.orderId,
        paymentStatus: result.paymentStatus,
      });
      publishOrderPaymentStatusChanged(tenant, {
        orderId: result.orderId,
        paymentStatus: result.paymentStatus,
        orderStatus: result.orderStatus,
        reversedPaymentId: id,
      });
      appendDomainAudit(req, {
        action: 'PAYMENT_REVERSED',
        entityType: 'payment',
        entityId: id,
        relatedEntityType: 'bill',
        relatedEntityId: result.payment.billId,
        after: {
          paymentStatus: result.payment.status,
          orderPaymentStatus: result.paymentStatus,
          orderStatus: result.orderStatus,
        },
        metadata: { orderId: result.orderId, amount: result.payment.amount },
        reason: req.body.reason,
      });
      // Preserve the existing response contract: callers receive the Payment object directly.
      res.json({success:true,data:result.payment} satisfies ApiSuccessResponse<any>);
    }catch(e){next(e)}
  };
}
export const billingController = new BillingController();
