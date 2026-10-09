import { Router } from 'express';
import { validateRequest } from '../../middleware/validate';
import { authenticatePlatformAdmin } from './middleware';
import { platformAuditReadController } from './platformAuditReadController';
import {
  platformAuditIdParamsSchema,
  platformAuditListQuerySchema,
} from './validation';

export const platformAuditRouter = Router();

platformAuditRouter.use(authenticatePlatformAdmin());

platformAuditRouter.get(
  '/',
  validateRequest({ query: platformAuditListQuerySchema }),
  platformAuditReadController.list,
);

platformAuditRouter.get(
  '/:auditId',
  validateRequest({ params: platformAuditIdParamsSchema }),
  platformAuditReadController.detail,
);
