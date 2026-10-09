import { Router } from 'express';
import { validateRequest } from '../../middleware/validate';
import { authenticatePlatformAdmin } from './middleware';
import { platformActivationRequestReadController } from './activationRequestReadController';
import { platformActivationRequestReviewController } from './activationRequestReviewController';
import {
  platformActivationRequestApproveBodySchema,
  platformActivationRequestApproveUntilBodySchema,
  platformActivationRequestIdParamsSchema,
  platformActivationRequestListQuerySchema,
  platformActivationRequestRejectBodySchema,
} from './validation';

export const platformActivationRequestsRouter = Router();

platformActivationRequestsRouter.use(authenticatePlatformAdmin());

platformActivationRequestsRouter.get(
  '/',
  validateRequest({ query: platformActivationRequestListQuerySchema }),
  platformActivationRequestReadController.list,
);

platformActivationRequestsRouter.get(
  '/:requestId',
  validateRequest({ params: platformActivationRequestIdParamsSchema }),
  platformActivationRequestReadController.detail,
);


platformActivationRequestsRouter.post(
  '/:requestId/approve',
  validateRequest({
    params: platformActivationRequestIdParamsSchema,
    body: platformActivationRequestApproveBodySchema,
  }),
  platformActivationRequestReviewController.approve,
);

platformActivationRequestsRouter.post(
  '/:requestId/approve-until',
  validateRequest({
    params: platformActivationRequestIdParamsSchema,
    body: platformActivationRequestApproveUntilBodySchema,
  }),
  platformActivationRequestReviewController.approveUntil,
);

platformActivationRequestsRouter.post(
  '/:requestId/reject',
  validateRequest({
    params: platformActivationRequestIdParamsSchema,
    body: platformActivationRequestRejectBodySchema,
  }),
  platformActivationRequestReviewController.reject,
);
