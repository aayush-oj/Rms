import { Router } from 'express';
import { validateRequest } from '../../middleware/validate';
import { authenticatePlatformAdmin } from './middleware';
import { platformOrganizationReadController } from './organizationReadController';
import { platformOrganizationLifecycleActionController } from './organizationLifecycleActionController';
import { platformOrganizationAccessExpiryController } from './organizationAccessExpiryController';
import { platformOrganizationGraceController } from './organizationGraceController';
import { platformOrganizationSuspensionScheduleController } from './organizationSuspensionScheduleController';
import { platformOrganizationSecuritySuspensionController } from './organizationSecuritySuspensionController';
import { platformOrganizationCancellationController } from './organizationCancellationController';
import {
  platformOrganizationIdParamsSchema,
  platformOrganizationListQuerySchema,
  platformLifecycleActiveActionBodySchema,
  platformLifecycleCommonActionBodySchema,
  platformAccessExpiryBodySchema,
  platformStartGraceBodySchema,
  platformExtendGraceBodySchema,
  platformEndGraceBodySchema,
  platformScheduleSuspensionBodySchema,
  platformRescheduleSuspensionBodySchema,
  platformCancelScheduledSuspensionBodySchema,
  platformSecuritySuspendBodySchema,
  platformClearSecuritySuspensionBodySchema,
  platformCancelOrganizationBodySchema,
} from './validation';

export const platformOrganizationsRouter = Router();

platformOrganizationsRouter.use(authenticatePlatformAdmin());

platformOrganizationsRouter.get(
  '/',
  validateRequest({ query: platformOrganizationListQuerySchema }),
  platformOrganizationReadController.list,
);

platformOrganizationsRouter.get(
  '/:organizationId',
  validateRequest({ params: platformOrganizationIdParamsSchema }),
  platformOrganizationReadController.detail,
);


platformOrganizationsRouter.post(
  '/:organizationId/lifecycle/activate',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformLifecycleActiveActionBodySchema,
  }),
  platformOrganizationLifecycleActionController.activate,
);

platformOrganizationsRouter.post(
  '/:organizationId/lifecycle/suspend',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformLifecycleCommonActionBodySchema,
  }),
  platformOrganizationLifecycleActionController.suspend,
);

platformOrganizationsRouter.post(
  '/:organizationId/lifecycle/reactivate',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformLifecycleActiveActionBodySchema,
  }),
  platformOrganizationLifecycleActionController.reactivate,
);


platformOrganizationsRouter.post(
  '/:organizationId/access-expiry',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformAccessExpiryBodySchema,
  }),
  platformOrganizationAccessExpiryController.update,
);


platformOrganizationsRouter.post(
  '/:organizationId/lifecycle/start-grace',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformStartGraceBodySchema,
  }),
  platformOrganizationLifecycleActionController.startGrace,
);

platformOrganizationsRouter.post(
  '/:organizationId/grace/extend',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformExtendGraceBodySchema,
  }),
  platformOrganizationGraceController.extend,
);

platformOrganizationsRouter.post(
  '/:organizationId/lifecycle/end-grace',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformEndGraceBodySchema,
  }),
  platformOrganizationLifecycleActionController.endGrace,
);


platformOrganizationsRouter.post(
  '/:organizationId/suspension-schedule',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformScheduleSuspensionBodySchema,
  }),
  platformOrganizationSuspensionScheduleController.schedule,
);

platformOrganizationsRouter.post(
  '/:organizationId/suspension-schedule/reschedule',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformRescheduleSuspensionBodySchema,
  }),
  platformOrganizationSuspensionScheduleController.reschedule,
);

platformOrganizationsRouter.post(
  '/:organizationId/suspension-schedule/cancel',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformCancelScheduledSuspensionBodySchema,
  }),
  platformOrganizationSuspensionScheduleController.cancel,
);


platformOrganizationsRouter.post(
  '/:organizationId/security-suspension',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformSecuritySuspendBodySchema,
  }),
  platformOrganizationSecuritySuspensionController.securitySuspend,
);

platformOrganizationsRouter.post(
  '/:organizationId/security-suspension/clear',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformClearSecuritySuspensionBodySchema,
  }),
  platformOrganizationSecuritySuspensionController.clearSecuritySuspension,
);


platformOrganizationsRouter.post(
  '/:organizationId/cancel',
  validateRequest({
    params: platformOrganizationIdParamsSchema,
    body: platformCancelOrganizationBodySchema,
  }),
  platformOrganizationCancellationController.cancel,
);
