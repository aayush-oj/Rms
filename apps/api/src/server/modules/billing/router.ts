import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { z } from 'zod';
import { billingController } from './controller';
import { mixedBillingController } from './mixedController';
import {
  billingCustomerSearchSchema,
  creditRepaymentSchema,
  discountSchema,
  mixedSettlementSchema,
  paymentSchema,
  quickBillingCustomerSchema,
  reversePaymentSchema,
  splitBillSchema,
} from './validation';

export const billingRouter = Router();
billingRouter.use(authenticate());
billingRouter.get('/orders/:orderId/preview', requirePermission('pos:billing:settle'), billingController.preview);
billingRouter.post('/orders/:orderId/finalize', requirePermission('pos:billing:settle'), validateRequest({body:z.object({}).default({})}), billingController.finalize);
billingRouter.patch('/orders/:orderId/discount', requirePermission('pos:discounts:apply'), validateRequest({ body: discountSchema }), mixedBillingController.discount);
billingRouter.get('/orders/:orderId', requirePermission('pos:billing:settle'), billingController.getForOrder);
billingRouter.get('/orders/:orderId/bills', requirePermission('pos:billing:settle'), billingController.getBillsForOrder);
billingRouter.post('/orders/:orderId/split', requirePermission('pos:billing:settle'), validateRequest({body:splitBillSchema}), billingController.split);

billingRouter.get('/customers', requirePermission('pos:billing:settle'), validateRequest({ query: billingCustomerSearchSchema }), mixedBillingController.customers);
billingRouter.post('/customers', requirePermission('pos:billing:settle'), validateRequest({ body: quickBillingCustomerSchema }), mixedBillingController.quickCustomer);
billingRouter.get('/credit/accounts', requirePermission('reports.payment.view', 'admin:customers:manage', 'pos:billing:settle'), mixedBillingController.creditAccounts);
billingRouter.get('/customers/:customerId/credit', requirePermission('reports.payment.view', 'admin:customers:manage', 'pos:billing:settle'), mixedBillingController.customerLedger);
billingRouter.post('/credit/:receivableId/repay', requirePermission('pos:billing:settle'), validateRequest({ body: creditRepaymentSchema }), mixedBillingController.repayCredit);

billingRouter.get('/bills/:id', requirePermission('pos:billing:settle'), billingController.get);
billingRouter.get('/bills/:id/settlement', requirePermission('pos:billing:settle'), mixedBillingController.settlementSummary);
billingRouter.get('/bills/:id/payments', requirePermission('pos:billing:settle'), billingController.listPayments);
billingRouter.post('/bills/:id/settle', requirePermission('pos:billing:settle'), validateRequest({ body: mixedSettlementSchema }), mixedBillingController.settleMixed);
billingRouter.post('/bills/:id/payments', requirePermission('pos:billing:settle'), validateRequest({body:paymentSchema}), billingController.pay);
billingRouter.post('/payments/:id/reverse', requirePermission('pos:billing:reverse'), validateRequest({body:reversePaymentSchema}), billingController.reverse);
billingRouter.get('/bills/:id/receipt', requirePermission('pos:billing:settle'), billingController.get);
billingRouter.get('/bills/:id/invoice', requirePermission('pos:billing:settle'), billingController.get);
