import { Router } from 'express';
import { kitchenController } from './controller';
import { authenticate, requirePermission } from '../identity/middleware';

export const kitchenRouter = Router();
kitchenRouter.use(authenticate());

kitchenRouter.get(
  '/tickets',
  requirePermission('kitchen:tickets:view'),
  kitchenController.listTickets
);

kitchenRouter.get(
  '/tickets/:id',
  requirePermission('kitchen:tickets:view'),
  kitchenController.getTicket
);

kitchenRouter.patch(
  '/tickets/:id/status',
  requirePermission('kitchen:tickets:update'),
  kitchenController.updateTicketStatus
);

kitchenRouter.patch(
  '/ticket-items/:itemId/status',
  requirePermission('kitchen:tickets:update'),
  kitchenController.updateTicketItemStatus
);
