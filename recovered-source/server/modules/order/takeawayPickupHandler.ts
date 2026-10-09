import { NextFunction, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { canCompleteOrderAfterSettlement } from '../../domain/orderLifecycle';
import { getDatabasePool } from '../../db/pool';
import { ApiSuccessResponse } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { realtimePublisher } from '../../realtime/publisher';
import { orderRepository } from './repository';

export async function pickupTakeawayOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
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

    const pool = getDatabasePool();
    const conn = await pool.getConnection();
    let completedNow = false;
    let completedTicketIds: number[] = [];

    try {
      await conn.beginTransaction();
      const [orders] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
        [orderId, organizationId, branchId]
      );
      if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');

      const order = orders[0];
      if (String(order.order_type) !== 'TAKEAWAY') {
        throw new BadRequestError('Pickup is available only for takeaway orders', 'ORDER_NOT_TAKEAWAY');
      }

      // Treat repeated pickup requests as idempotent. This also covers a pickup
      // that immediately completed because the bill was already settled.
      if (order.picked_up_at != null) {
        await conn.rollback();
        const existing = await orderRepository.findById(orderId, organizationId, branchId);
        if (!existing) throw new NotFoundError('Order not found after pickup', 'ORDER_NOT_FOUND');
        res.status(200).json({ success: true, data: existing } satisfies ApiSuccessResponse);
        return;
      }

      if (String(order.order_status) !== 'READY') {
        throw new BadRequestError('Only ready takeaway orders can be picked up', 'ORDER_NOT_READY_FOR_PICKUP');
      }

      const [readyTickets] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM kitchen_tickets
          WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND ticket_status = 'READY'
          FOR UPDATE`,
        [orderId, organizationId, branchId]
      );
      completedTicketIds = readyTickets.map((row) => Number(row.id));

      // KDS item SERVED means the prepared item left the kitchen. The order itself
      // deliberately stays READY until pickup + financial settlement are both true.
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
        `UPDATE kitchen_tickets
          SET ticket_status = 'COMPLETED', updated_at = NOW()
          WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND ticket_status = 'READY'`,
        [orderId, organizationId, branchId]
      );

      const financiallySettled =
        ['SETTLED', 'SETTLED_WITH_CREDIT'].includes(String(order.settlement_status || 'OPEN')) ||
        String(order.payment_status) === 'PAID';
      completedNow = canCompleteOrderAfterSettlement('TAKEAWAY', 'READY', financiallySettled, true);

      await conn.execute(
        `UPDATE orders
          SET picked_up_at = COALESCE(picked_up_at, NOW()),
              picked_up_by = COALESCE(picked_up_by, ?),
              order_status = ?,
              completed_at = CASE WHEN ? THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
              completed_by = CASE WHEN ? THEN COALESCE(completed_by, ?) ELSE completed_by END,
              updated_at = NOW()
          WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [
          req.user.id,
          completedNow ? 'COMPLETED' : 'READY',
          completedNow,
          completedNow,
          req.user.id,
          orderId,
          organizationId,
          branchId,
        ]
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const updatedOrder = await orderRepository.findById(orderId, organizationId, branchId);
    if (!updatedOrder) throw new NotFoundError('Order not found after pickup', 'ORDER_NOT_FOUND');

    realtimePublisher.publish({
      type: 'order.picked_up',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: orderId,
      data: {
        orderId,
        orderStatus: updatedOrder.orderStatus,
        pickedUpAt: updatedOrder.pickedUpAt,
        pickedUpBy: updatedOrder.pickedUpBy,
        paymentStatus: updatedOrder.paymentStatus,
      },
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
    if (completedNow) {
      realtimePublisher.publish({
        type: 'order.completed',
        organizationId,
        branchId,
        entityType: 'order',
        entityId: orderId,
        data: { orderStatus: updatedOrder.orderStatus, diningTableId: null },
      });
    }

    res.status(200).json({ success: true, data: updatedOrder } satisfies ApiSuccessResponse);
  } catch (error) {
    next(error);
  }
}
