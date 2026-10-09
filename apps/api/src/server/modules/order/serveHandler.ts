import { Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { managementRepository } from '../management/repository';
import { realtimePublisher } from '../../realtime/publisher';
import { orderRepository } from './repository';
import { orderService } from './service';

export async function serveOrderAndCloseKot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.organizationId || !req.user.activeBranchId) {
      throw new ForbiddenError('Active tenant and branch context is required', 'MISSING_TENANT_CONTEXT');
    }

    const organizationId = req.user.organizationId;
    const branchId = req.user.activeBranchId;
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
    }

    const order = await orderRepository.findById(orderId, organizationId, branchId);
    if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');

    const privileged =
      req.user.role === 'OWNER' ||
      req.user.permissions.includes('admin:all') ||
      req.user.permissions.includes('admin:tables:manage') ||
      req.user.permissions.includes('admin:access:manage');

    if (
      order.diningTableId != null &&
      !privileged &&
      !(await managementRepository.canAccessTable(
        organizationId,
        req.user.id,
        branchId,
        order.diningTableId,
        req.user.permissions
      ))
    ) {
      throw new ForbiddenError('You do not have access to this table order', 'TABLE_ACCESS_FORBIDDEN');
    }

    orderService.validateStatusTransition(order.orderStatus, 'SERVED');
    if (order.orderType !== 'DINE_IN') {
      throw new BadRequestError('Only dine-in orders require a served action', 'ORDER_NOT_SERVABLE');
    }

    const pool = getDatabasePool();
    const conn = await pool.getConnection();
    let completedTicketIds: number[] = [];
    try {
      await conn.beginTransaction();

      const [lockedOrders] = await conn.execute<RowDataPacket[]>(
        `SELECT order_status, order_type
         FROM orders
         WHERE id = ? AND organization_id = ? AND branch_id = ?
         FOR UPDATE`,
        [orderId, organizationId, branchId]
      );
      if (!lockedOrders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      if (String(lockedOrders[0].order_status) !== 'READY') {
        throw new BadRequestError('Only ready orders can be marked served', 'INVALID_ORDER_STATUS');
      }
      if (String(lockedOrders[0].order_type) !== 'DINE_IN') {
        throw new BadRequestError('Only dine-in orders require a served action', 'ORDER_NOT_SERVABLE');
      }

      const [readyTickets] = await conn.execute<RowDataPacket[]>(
        `SELECT id
         FROM kitchen_tickets
         WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND ticket_status = 'READY'
         FOR UPDATE`,
        [orderId, organizationId, branchId]
      );
      completedTicketIds = readyTickets.map((row) => Number(row.id));

      await conn.execute(
        `UPDATE kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
         SET kti.item_status = 'SERVED',
             kti.served_at = COALESCE(kti.served_at, NOW()),
             kti.served_by = ?,
             kti.updated_at = NOW()
         WHERE kt.order_id = ? AND kt.organization_id = ? AND kt.branch_id = ?
           AND kti.item_status = 'READY'`,
        [req.user.id, orderId, organizationId, branchId]
      );

      await conn.execute(
        `UPDATE orders
         SET order_status = 'SERVED', served_at = COALESCE(served_at, NOW()), served_by = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [req.user.id, orderId, organizationId, branchId]
      );

      await conn.execute(
        `UPDATE kitchen_tickets
         SET ticket_status = 'COMPLETED', updated_at = NOW()
         WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND ticket_status = 'READY'`,
        [orderId, organizationId, branchId]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const updatedOrder = await orderRepository.findById(orderId, organizationId, branchId);
    if (!updatedOrder) throw new NotFoundError('Order not found after serving', 'ORDER_NOT_FOUND');

    realtimePublisher.publish({
      type: 'order.served',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: updatedOrder.id,
      data: { orderStatus: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId, servedAt: updatedOrder.servedAt },
    });
    realtimePublisher.publish({
      type: 'service.status_changed',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: updatedOrder.id,
      data: { status: updatedOrder.orderStatus, diningTableId: updatedOrder.diningTableId },
    });
    for (const ticketId of completedTicketIds) {
      realtimePublisher.publish({
        type: 'kot.completed',
        organizationId,
        branchId,
        entityType: 'kot',
        entityId: ticketId,
        data: { orderId, ticketStatus: 'COMPLETED' },
      });
      realtimePublisher.publish({
        type: 'kds.ticket.completed',
        organizationId,
        branchId,
        entityType: 'kds_ticket',
        entityId: ticketId,
        data: { orderId, ticketStatus: 'COMPLETED' },
      });
    }

    res.status(200).json({ success: true, data: updatedOrder } satisfies ApiSuccessResponse);
  } catch (error) {
    next(error);
  }
}
