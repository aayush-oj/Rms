import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { tableOperationsController } from './controller';
import { mergeSchema, swapSchema, transferSchema } from './validation';

export const tableOperationsRouter = Router();
tableOperationsRouter.use(authenticate());
tableOperationsRouter.get('/overview', requirePermission('pos:tables:manage'), tableOperationsController.overview);
tableOperationsRouter.post('/transfer', requirePermission('pos:tables:manage'), validateRequest({ body: transferSchema }), tableOperationsController.transfer);
tableOperationsRouter.post('/swap', requirePermission('pos:tables:manage'), validateRequest({ body: swapSchema }), tableOperationsController.swap);
tableOperationsRouter.post('/merge', requirePermission('pos:tables:manage'), validateRequest({ body: mergeSchema }), tableOperationsController.merge);
