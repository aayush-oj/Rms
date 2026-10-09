import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { BadRequestError, ForbiddenError } from '../../shared/errors';
import { getReceiptDocument, getReceiptSettings, updateReceiptSettings } from './service';

const receiptSettingsSchema = z.object({
  title: z.string().trim().min(1).max(80),
  paperSize: z.enum(['AUTO', '58MM', '80MM', 'A4']),
  printCopies: z.union([z.literal(1), z.literal(2)]),
  headerNote: z.string().trim().max(500).nullable(),
  footerNote: z.string().trim().max(500).nullable(),
  showBranch: z.boolean(),
  showAddress: z.boolean(),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showTaxId: z.boolean(),
  showOrderNumber: z.boolean(),
  showTable: z.boolean(),
  showWaiter: z.boolean(),
  showCashier: z.boolean(),
  showPaymentSummary: z.boolean(),
}).strict();

function context(req: Request) {
  if (!req.user?.organizationId) throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
  if (!req.user.activeBranchId) throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
  return { organizationId: req.user.organizationId, branchId: req.user.activeBranchId };
}

export const receiptSettingsRouter = Router();
receiptSettingsRouter.use(authenticate());

receiptSettingsRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const c = context(req);
    res.json({ success: true, data: await getReceiptSettings(c.organizationId, c.branchId) });
  } catch (error) {
    next(error);
  }
});

receiptSettingsRouter.put(
  '/settings',
  requirePermission('admin:settings:manage'),
  validateRequest({ body: receiptSettingsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      res.json({ success: true, data: await updateReceiptSettings(c.organizationId, c.branchId, req.body) });
    } catch (error) {
      next(error);
    }
  }
);

receiptSettingsRouter.get(
  '/bills/:billId',
  requirePermission('pos:billing:settle', 'reports.payment.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      const billId = Number(req.params.billId);
      if (!Number.isInteger(billId) || billId <= 0) {
        throw new BadRequestError('Valid bill ID is required', 'INVALID_BILL_ID');
      }
      res.json({ success: true, data: await getReceiptDocument(billId, c.organizationId, c.branchId) });
    } catch (error) {
      next(error);
    }
  }
);
