import { Request, Response, NextFunction } from 'express';
import { kitchenService } from './service';
import { kitchenRepository } from './repository';
import { identityRepository } from '../identity/repository';
import { orderRepository } from '../order/repository';
import { administrationRepository } from '../administration/repository';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { KotStatus, KotItemStatus, KitchenTicketItem } from './types';
import { realtimePublisher } from '../../realtime/publisher';

export class KitchenController {
  private getOrgId(req: Request): number {
    if (!req.user || !req.user.organizationId) throw new ForbiddenError('Authenticated tenant context is missing', 'MISSING_TENANT_CONTEXT');
    return req.user.organizationId;
  }

  private getBranchId(req: Request): number {
    if (!req.user || !req.user.activeBranchId) throw new ForbiddenError('Active branch context is missing', 'MISSING_BRANCH_CONTEXT');
    return req.user.activeBranchId;
  }

  private async ensureBranchAccess(req: Request, branchId: number): Promise<void> {
    if (!req.user) throw new ForbiddenError('Authentication required', 'AUTH_REQUIRED');
    const branch = await identityRepository.findBranchById(req.user.organizationId, branchId);
    if (!branch) throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
    const { SYSTEM_ROLES } = await import('../identity/types');
    if (req.user.role === SYSTEM_ROLES.OWNER || req.user.permissions.includes('admin:all') || req.user.permissions.includes('admin:branches:manage')) return;
    if (!req.user.allowedBranchIds.includes(branchId)) throw new ForbiddenError(`Unauthorized access to branch #${branchId}`, 'UNAUTHORIZED_BRANCH_ACCESS');
  }

  private async serviceContext(organizationId: number, branchId: number, orderId: number) {
    const order = await orderRepository.findById(orderId, organizationId, branchId);
    if (!order) return null;
    const table = order.diningTableId == null ? null : await administrationRepository.findTableById(order.diningTableId, organizationId);
    return {
      order,
      table,
      responsibleWaiterId: order.waiterId ?? table?.assignedWaiterId ?? null,
    };
  }

  private async publishOrderState(organizationId: number, branchId: number, orderId: number): Promise<void> {
    const context = await this.serviceContext(organizationId, branchId, orderId);
    if (!context) return;
    const { order, table, responsibleWaiterId } = context;
    realtimePublisher.publish({
      type: 'order.status_changed',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: order.id,
      data: {
        orderStatus: order.orderStatus,
        diningTableId: order.diningTableId,
        orderType: order.orderType,
        readyAt: order.readyAt,
        waiterId: responsibleWaiterId,
      },
    });
    if (order.orderStatus === 'READY') {
      realtimePublisher.publish({
        type: 'service.order_ready',
        organizationId,
        branchId,
        entityType: 'order',
        entityId: order.id,
        data: {
          orderStatus: order.orderStatus,
          diningTableId: order.diningTableId,
          tableLabel: table?.tableNumber ?? null,
          orderType: order.orderType,
          orderNumber: order.orderNumber,
          waiterId: responsibleWaiterId,
          readyAt: order.readyAt,
        },
      });
    }
  }

  private async publishReadyItems(organizationId: number, branchId: number, orderId: number, items: KitchenTicketItem[]): Promise<void> {
    if (!items.length) return;
    const context = await this.serviceContext(organizationId, branchId, orderId);
    if (!context || context.order.orderType !== 'DINE_IN') return;
    realtimePublisher.publish({
      type: 'service.items_ready',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: context.order.id,
      data: {
        orderId: context.order.id,
        orderNumber: context.order.orderNumber,
        orderType: context.order.orderType,
        diningTableId: context.order.diningTableId,
        tableLabel: context.table?.tableNumber ?? null,
        waiterId: context.responsibleWaiterId,
        items: items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          itemName: item.itemNameSnapshot,
          variantName: item.variantNameSnapshot,
          prepStationName: item.prepStationName,
        })),
      },
    });
  }

  listTickets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const { ticketStatus, stationId, orderType } = req.query as { ticketStatus?: string; stationId?: string; orderType?: string };
      const tickets = await kitchenService.listTickets(orgId, branchId, {
        ticketStatus: ticketStatus as KotStatus | undefined,
        stationId: stationId ? parseInt(stationId, 10) : undefined,
        orderType: orderType as any,
      });
      const response: ApiSuccessResponse = { success: true, data: tickets };
      res.status(200).json(response);
    } catch (err) { next(err); }
  };

  getTicket = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) throw new BadRequestError('Valid ticket ID is required', 'INVALID_TICKET_ID');
      const ticket = await kitchenService.getTicket(ticketId, orgId, branchId);
      if (!ticket) throw new NotFoundError('Kitchen ticket not found', 'KITCHEN_TICKET_NOT_FOUND');
      const response: ApiSuccessResponse = { success: true, data: ticket };
      res.status(200).json(response);
    } catch (err) { next(err); }
  };

  updateTicketStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const ticketId = parseInt(req.params.id, 10);
      if (isNaN(ticketId)) throw new BadRequestError('Valid ticket ID is required', 'INVALID_TICKET_ID');
      const { ticketStatus } = req.body as { ticketStatus: KotStatus };
      const updatedTicket = await kitchenService.updateTicketStatus(ticketId, orgId, branchId, ticketStatus, req.user!.id);
      const type = ticketStatus === 'READY' ? 'kds.ticket.ready' : 'kot.status_changed';
      realtimePublisher.publish({
        type,
        organizationId: orgId,
        branchId,
        entityType: 'kds_ticket',
        entityId: updatedTicket.id,
        data: {
          ticketStatus: updatedTicket.ticketStatus,
          orderId: updatedTicket.orderId,
          orderNumber: updatedTicket.orderNumber,
          orderType: updatedTicket.orderType,
          kotNumber: updatedTicket.kotNumber,
          tableLabel: updatedTicket.tableLabel,
          items: updatedTicket.items.filter((item) => item.itemStatus !== 'CANCELLED').map((item) => ({
            id: item.id,
            quantity: item.quantity,
            itemName: item.itemNameSnapshot,
            variantName: item.variantNameSnapshot,
          })),
        },
      });
      if (ticketStatus === 'READY') {
        await this.publishReadyItems(orgId, branchId, updatedTicket.orderId, updatedTicket.items.filter((item) => item.itemStatus === 'READY'));
      }
      await this.publishOrderState(orgId, branchId, updatedTicket.orderId);
      const response: ApiSuccessResponse = { success: true, data: updatedTicket };
      res.status(200).json(response);
    } catch (err) { next(err); }
  };

  updateTicketItemStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const orgId = this.getOrgId(req);
      const branchId = this.getBranchId(req);
      await this.ensureBranchAccess(req, branchId);
      const itemId = parseInt(req.params.itemId, 10);
      if (isNaN(itemId)) throw new BadRequestError('Valid item ID is required', 'INVALID_ITEM_ID');
      const { itemStatus } = req.body as { itemStatus: KotItemStatus };
      const updatedItem = await kitchenService.updateTicketItemStatus(itemId, orgId, branchId, itemStatus, req.user!.id);
      const ticket = await kitchenRepository.findById(updatedItem.kitchenTicketId, orgId, branchId);
      realtimePublisher.publish({
        type: ticket?.ticketStatus === 'READY' ? 'kds.ticket.ready' : 'kds.ticket.updated',
        organizationId: orgId,
        branchId,
        entityType: 'kds_ticket',
        entityId: updatedItem.kitchenTicketId,
        data: {
          itemId: updatedItem.id,
          itemStatus: updatedItem.itemStatus,
          ticketStatus: ticket?.ticketStatus,
          orderId: ticket?.orderId,
        },
      });
      if (ticket && itemStatus === 'READY') await this.publishReadyItems(orgId, branchId, ticket.orderId, [updatedItem]);
      if (ticket) await this.publishOrderState(orgId, branchId, ticket.orderId);
      const response: ApiSuccessResponse = { success: true, data: updatedItem };
      res.status(200).json(response);
    } catch (err) { next(err); }
  };
}

export const kitchenController = new KitchenController();
