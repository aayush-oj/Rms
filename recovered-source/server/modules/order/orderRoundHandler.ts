import { NextFunction, Request, Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { realtimePublisher } from '../../realtime/publisher';
import { managementRepository } from '../management/repository';
import { kitchenRepository } from '../kitchen/repository';
import { recipeRepository } from '../recipe/repository';
import { orderRepository } from './repository';
import { recalcOrder, refreshPendingBill } from './amendmentHandler';

function parsePositiveId(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new BadRequestError(`Valid ${label} is required`, 'INVALID_ORDER_ROUND_ID');
  }
  return value;
}

function authContext(req: Request) {
  if (!req.user?.organizationId || !req.user.activeBranchId) {
    throw new ForbiddenError('Authenticated branch context is required', 'MISSING_TENANT_CONTEXT');
  }
  return {
    organizationId: req.user.organizationId,
    branchId: req.user.activeBranchId,
    userId: req.user.id,
    permissions: req.user.permissions,
    role: req.user.role,
  };
}

async function assertOrderAccess(req: Request, order: RowDataPacket) {
  if (String(order.order_type) !== 'DINE_IN' || order.dining_table_id == null) return;
  const { organizationId, branchId, userId, permissions, role } = authContext(req);
  const privileged =
    role === 'OWNER' ||
    permissions.includes('admin:all') ||
    permissions.includes('admin:tables:manage') ||
    permissions.includes('admin:access:manage');
  if (privileged) return;
  if (!(await managementRepository.canAccessTable(
    organizationId,
    userId,
    branchId,
    Number(order.dining_table_id),
    permissions,
  ))) {
    throw new ForbiddenError('You do not have access to this table', 'TABLE_ACCESS_FORBIDDEN');
  }
}

async function lockRefreshableBill(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
): Promise<number | null> {
  const [bills] = await conn.execute<RowDataPacket[]>(
    `SELECT id,status,amount_paid,credit_total,split_batch_id
       FROM bills
      WHERE organization_id=? AND branch_id=? AND order_id=?
      ORDER BY id FOR UPDATE`,
    [organizationId, branchId, orderId],
  );
  if (!bills.length) return null;
  if (
    bills.length > 1 ||
    bills.some((bill) => bill.split_batch_id != null) ||
    bills.some((bill) => !['DRAFT', 'FINALIZED'].includes(String(bill.status))) ||
    bills.some((bill) => Number(bill.amount_paid || 0) > 0.0001 || Number(bill.credit_total || 0) > 0.0001)
  ) {
    throw new ConflictError(
      'An added order cannot be cancelled after bill splitting or financial settlement has started',
      'ORDER_ROUND_FINANCIAL_LOCK',
    );
  }
  const billId = Number(bills[0].id);
  const [payments] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM payments
      WHERE organization_id=? AND branch_id=? AND bill_id=? AND status='CAPTURED'
      LIMIT 1 FOR UPDATE`,
    [organizationId, branchId, billId],
  );
  if (payments.length) {
    throw new ConflictError('Payment has already been recorded for this bill', 'ORDER_ROUND_FINANCIAL_LOCK');
  }
  const [receivables] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM customer_receivables
      WHERE organization_id=? AND branch_id=? AND bill_id=?
      LIMIT 1 FOR UPDATE`,
    [organizationId, branchId, billId],
  );
  if (receivables.length) {
    throw new ConflictError('Customer credit has already been recorded for this bill', 'ORDER_ROUND_FINANCIAL_LOCK');
  }
  return billId;
}

async function deriveRemainingStatus(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  orderType: string,
): Promise<'PLACED' | 'PREPARING' | 'READY' | 'SERVED'> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT kt.ticket_status, kti.item_status
       FROM kitchen_tickets kt
       JOIN order_rounds r ON r.id=kt.order_round_id AND r.status='ACTIVE'
       JOIN kitchen_ticket_items kti ON kti.kitchen_ticket_id=kt.id
      WHERE kt.organization_id=? AND kt.branch_id=? AND kt.order_id=?
        AND kt.ticket_status <> 'VOIDED'
      ORDER BY kt.id,kti.sequence_number
      FOR UPDATE`,
    [organizationId, branchId, orderId],
  );
  if (!rows.length) return 'PLACED';

  const itemStatuses = rows.map((row) => String(row.item_status));
  const ticketStatuses = rows.map((row) => String(row.ticket_status));
  const activePrep = itemStatuses.some((status) => status === 'PENDING' || status === 'PREPARING');
  const allPending = itemStatuses.every((status) => status === 'PENDING');
  const allNew = ticketStatuses.every((status) => status === 'NEW');
  const anyReady = itemStatuses.some((status) => status === 'READY');
  const allServed = itemStatuses.every((status) => status === 'SERVED');

  if (activePrep) return allPending && allNew ? 'PLACED' : 'PREPARING';
  if (allServed && orderType === 'DINE_IN') return 'SERVED';
  if (anyReady || allServed) return 'READY';
  return 'PREPARING';
}

async function applyRemainingStatus(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  nextStatus: 'PLACED' | 'PREPARING' | 'READY' | 'SERVED',
  round: RowDataPacket,
  userId: number,
) {
  if (nextStatus === 'SERVED') {
    await conn.execute(
      `UPDATE orders
          SET order_status='SERVED',
              ready_at=COALESCE(?,ready_at,NOW()),
              served_at=COALESCE(?,served_at,NOW()),
              served_by=COALESCE(?,served_by,?),
              updated_at=NOW()
        WHERE id=? AND organization_id=? AND branch_id=?`,
      [
        round.prior_ready_at ?? null,
        round.prior_served_at ?? null,
        round.prior_served_by ?? null,
        userId,
        orderId,
        organizationId,
        branchId,
      ],
    );
    return;
  }
  if (nextStatus === 'READY') {
    await conn.execute(
      `UPDATE orders
          SET order_status='READY',
              ready_at=COALESCE(?,ready_at,NOW()),
              served_at=NULL,served_by=NULL,updated_at=NOW()
        WHERE id=? AND organization_id=? AND branch_id=?`,
      [round.prior_ready_at ?? null, orderId, organizationId, branchId],
    );
    return;
  }
  await conn.execute(
    `UPDATE orders
        SET order_status=?,ready_at=NULL,served_at=NULL,served_by=NULL,updated_at=NOW()
      WHERE id=? AND organization_id=? AND branch_id=?`,
    [nextStatus, orderId, organizationId, branchId],
  );
}

export async function cancelOrderRound(req: Request, res: Response, next: NextFunction) {
  const conn = await getDatabasePool().getConnection();
  try {
    const { organizationId, branchId, userId } = authContext(req);
    const orderId = parsePositiveId(req.params.id, 'order ID');
    const roundId = parsePositiveId(req.params.roundId, 'order round ID');
    const reason = String(req.body?.cancellationReason || '').trim();
    if (!reason) throw new BadRequestError('Cancellation reason is required', 'CANCELLATION_REASON_REQUIRED');

    await conn.beginTransaction();

    const [orders] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM orders WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE',
      [orderId, organizationId, branchId],
    );
    if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const order = orders[0];
    await assertOrderAccess(req, order);

    if (['COMPLETED', 'CANCELLED', 'MERGED'].includes(String(order.order_status))) {
      throw new ConflictError('Closed orders cannot cancel an added round', 'ORDER_ROUND_CLOSED');
    }
    if (String(order.payment_status) !== 'UNPAID' || String(order.settlement_status || 'OPEN') !== 'OPEN') {
      throw new ConflictError('Financially settled orders cannot cancel an added round', 'ORDER_ROUND_FINANCIAL_LOCK');
    }
    if (String(order.order_type) === 'TAKEAWAY' && order.picked_up_at != null) {
      throw new ConflictError('Picked-up takeaway orders cannot cancel an added round', 'TAKEAWAY_ALREADY_PICKED_UP');
    }

    const [roundRows] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM order_rounds
        WHERE id=? AND order_id=? AND organization_id=? AND branch_id=?
        FOR UPDATE`,
      [roundId, orderId, organizationId, branchId],
    );
    if (!roundRows.length) throw new NotFoundError('Added order round not found', 'ORDER_ROUND_NOT_FOUND');
    const round = roundRows[0];
    if (String(round.round_type) !== 'ADDITION') {
      throw new ConflictError('The original order must use the normal whole-order cancellation flow', 'INITIAL_ROUND_NOT_CANCELLABLE');
    }
    if (String(round.status) !== 'ACTIVE') {
      throw new ConflictError('This added order is already cancelled', 'ORDER_ROUND_ALREADY_CANCELLED');
    }

    const [latestRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id,round_number FROM order_rounds
        WHERE order_id=? AND organization_id=? AND branch_id=? AND status='ACTIVE'
        ORDER BY round_number DESC LIMIT 1 FOR UPDATE`,
      [orderId, organizationId, branchId],
    );
    if (!latestRows.length || Number(latestRows[0].id) !== roundId) {
      throw new ConflictError('Cancel the most recently added order first', 'ORDER_ROUND_NOT_LATEST');
    }

    const [servedRows] = await conn.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS served_count
         FROM kitchen_ticket_items kti
         JOIN kitchen_tickets kt ON kt.id=kti.kitchen_ticket_id
        WHERE kt.organization_id=? AND kt.branch_id=? AND kt.order_id=? AND kt.order_round_id=?
          AND kti.item_status='SERVED'
        FOR UPDATE`,
      [organizationId, branchId, orderId, roundId],
    );
    if (Number(servedRows[0]?.served_count || 0) > 0) {
      throw new ConflictError(
        'This added order already contains served items. Served items must stay in the history.',
        'ORDER_ROUND_HAS_SERVED_ITEMS',
      );
    }

    const pendingBillId = await lockRefreshableBill(conn, organizationId, branchId, orderId);
    const [itemRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM order_items WHERE order_id=? AND order_round_id=? ORDER BY id FOR UPDATE',
      [orderId, roundId],
    );
    const itemIds = itemRows.map((row) => Number(row.id));
    if (!itemIds.length) throw new ConflictError('This added order has no items', 'ORDER_ROUND_EMPTY');

    await conn.execute(
      `UPDATE order_rounds
          SET status='CANCELLED',cancelled_at=NOW(),cancelled_by=?,cancellation_reason=?,updated_at=NOW()
        WHERE id=?`,
      [userId, reason, roundId],
    );
    await kitchenRepository.voidActiveTicketsForRound(conn, orderId, roundId, userId);
    await recipeRepository.reverseOrderItemsConsumptionInTransaction(
      conn,
      organizationId,
      branchId,
      orderId,
      itemIds,
      userId,
      reason,
    );

    await recalcOrder(conn, organizationId, branchId, orderId);
    if (pendingBillId != null) {
      await refreshPendingBill(conn, organizationId, branchId, orderId, pendingBillId);
    }

    const nextStatus = await deriveRemainingStatus(
      conn,
      organizationId,
      branchId,
      orderId,
      String(order.order_type),
    );
    await applyRemainingStatus(conn, organizationId, branchId, orderId, nextStatus, round, userId);

    await conn.commit();

    const updated = await orderRepository.findById(orderId, organizationId, branchId);
    if (!updated) throw new NotFoundError('Order not found after cancelling the added round', 'ORDER_NOT_FOUND');

    realtimePublisher.publish({
      type: 'order.round_cancelled',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: orderId,
      data: {
        orderId,
        orderRoundId: roundId,
        roundNumber: Number(round.round_number),
        diningTableId: updated.diningTableId,
        orderStatus: updated.orderStatus,
      },
    });
    realtimePublisher.publish({
      type: 'inventory.stock_changed',
      organizationId,
      branchId,
      entityType: 'inventory_balance',
      entityId: orderId,
      data: { source: 'ORDER_ROUND_CANCELLATION_REVERSAL', orderId, orderRoundId: roundId },
    });

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    await conn.rollback();
    next(error);
  } finally {
    conn.release();
  }
}
