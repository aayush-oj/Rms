import { Router } from 'express';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import { alertsController } from './controller';
import { alertListQuerySchema, alertSettingsQuerySchema, alertSettingsRequestSchema } from './validation';

export const alertsRouter=Router();
alertsRouter.use(authenticate());
alertsRouter.get('/',requirePermission('alerts.view'),validateRequest({query:alertListQuerySchema}),alertsController.list);
alertsRouter.get('/:id',requirePermission('alerts.view'),alertsController.get);

// There are deliberately no acknowledge, dismiss or manual resolve routes.
// An actionable alert closes only when its underlying business condition clears.
export const alertSettingsRouter=Router();
alertSettingsRouter.use(authenticate());
alertSettingsRouter.get('/',requirePermission('alerts.view'),validateRequest({query:alertSettingsQuerySchema}),alertsController.settings);
alertSettingsRouter.patch('/',requirePermission('alerts.settings.manage'),validateRequest({body:alertSettingsRequestSchema}),alertsController.updateSettings);
