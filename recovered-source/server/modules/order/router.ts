import { Router } from 'express';
import { orderController } from './controller';
import { authenticate, requirePermission } from '../identity/middleware';
import { validateRequest } from '../../middleware/validate';
import {
  createOrderSchema,
  updateOrderStatusSchema,
  cancelOrderSchema,
  listOrdersQuerySchema,
} from './validation';
import { serveOrderAndCloseKot } from './serveHandler';
import { pickupTakeawayOrder } from './takeawayPickupHandler';
import { appendOrderItems, moveOrderItems } from './amendmentHandler';
import { listReadyServiceItems, serveReadyServiceItem } from './serviceItemHandler';
import { reconcileRequestedDineInTable } from './tableAvailabilityReconciler';
import { cancelOrderRound } from './orderRoundHandler';

export const ordersRouter = Router();
ordersRouter.use(authenticate());

ordersRouter.post(
  '/',
  requirePermission('pos:orders:create'),
  validateRequest({ body: createOrderSchema }),
  reconcileRequestedDineInTable,
  orderController.createOrder
);

ordersRouter.get(
  '/',
  requirePermission('pos:orders:view'),
  validateRequest({ query: listOrdersQuerySchema }),
  orderController.listOrders
);

ordersRouter.get(
  '/service-ready',
  requirePermission('pos:orders:serve'),
  listReadyServiceItems
);

ordersRouter.get(
  '/:id',
  requirePermission('pos:orders:view'),
  orderController.getOrder
);

ordersRouter.post(
  '/:id/items',
  requirePermission('pos:orders:create'),
  appendOrderItems
);

ordersRouter.post(
  '/:id/move-items',
  requirePermission('pos:tables:manage'),
  moveOrderItems
);

ordersRouter.post(
  '/:id/service-items/:itemId/serve',
  requirePermission('pos:orders:serve'),
  serveReadyServiceItem
);

ordersRouter.patch(
  '/:id/status',
  requirePermission('pos:orders:create'),
  validateRequest({ body: updateOrderStatusSchema }),
  orderController.updateStatus
);

ordersRouter.post(
  '/:id/serve',
  requirePermission('pos:orders:serve'),
  serveOrderAndCloseKot
);

ordersRouter.post(
  '/:id/pickup',
  requirePermission('pos:orders:serve'),
  pickupTakeawayOrder
);

ordersRouter.post(
  '/:id/complete',
  requirePermission('pos:orders:complete'),
  orderController.completeOrder
);

ordersRouter.post(
  '/:id/rounds/:roundId/cancel',
  requirePermission('pos:orders:void'),
  validateRequest({ body: cancelOrderSchema }),
  cancelOrderRound
);

ordersRouter.post(
  '/:id/cancel',
  requirePermission('pos:orders:void'),
  validateRequest({ body: cancelOrderSchema }),
  orderController.cancelOrder
);
