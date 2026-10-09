import { NextFunction, Request, Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { kitchenService } from '../kitchen/service';
import { managementRepository } from '../management/repository';
import { realtimePublisher } from '../../realtime/publisher';
import { orderRepository } from './repository';

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

function isPrivileged(req: Request): boolean {
  return req.user!.role === 'OWNER' ||
    req.user!.permissions.includes('admin:all') ||
    req.user!.permissions.includes('admin:tables:manage') ||
    req.user!.permissions.includes('admin:access:manage');
}

async function ensureTableAccess(req: Request, tableId: number): Promise<void> {
  if (isPrivileged(req)) return;
  const { organizationId, branchId, userId, permissions } = authContext(req);
  const allowed = await managementRepository.canAccessTable(organizationId, userId, branchId, tableId, permissions);
  if (!allowed) throw new ForbiddenError('You do not have access to this table order', 'TABLE_ACCESS_FORBIDDEN');
}

export async function listReadyServiceItems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { organizationId, branchId } = authContext(req);
    const accessibleTableIds = isPrivileged(req)
      ? null
      : await managementRepository.accessibleTableIds(organizationId, req.user!.id, branchId, req.user!.permissions);

    if (accessibleTableIds && accessibleTableIds.length === 0) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    const binds: any[] = [organizationId, branchId];
    let tableScope = '';
    if (accessibleTableIds) {
      tableScope = ` AND o.dining_table_id IN (${accessibleTableIds.map(() => '?').join(',')})`;
      binds.push(...accessibleTableIds);
    }

    const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT
         o.id AS order_id, o.order_number, o.dining_table_id, o.waiter_id, o.order_status, o.ready_at,
         dt.table_number, dt.assigned_waiter_id,
         kt.id AS ticket_id, kt.kot_number,
         kti.id AS item_id, kti.quantity, kti.item_name_snapshot, kti.variant_name_snapshot,
         kti.modifier_summary, kti.notes, kti.prep_station_name, kti.updated_at AS item_ready_at
       FROM kitchen_ticket_items kti
       JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
       JOIN orders o ON o.id = kt.order_id
       JOIN dining_tables dt ON dt.id = o.dining_table_id
       WHERE o.organization_id = ? AND o.branch_id = ?
         AND kt.organization_id = o.organization_id AND kt.branch_id = o.branch_id
         AND o.order_type = 'DINE_IN'
         AND o.order_status NOT IN ('SERVED','COMPLETED','CANCELLED','MERGED')
         AND kti.item_status = 'READY'
         ${tableScope}
       ORDER BY kti.updated_at ASC, kti.id ASC`,
      binds
    );

    const groups = new Map<number, any>();
    for (const row of rows) {
      const orderId = Number(row.order_id);
      let group = groups.get(orderId);
      if (!group) {
        group = {
          orderId,
          orderNumber: String(row.order_number),
          diningTableId: Number(row.dining_table_id),
          tableNumber: String(row.table_number),
          waiterId: row.waiter_id == null ? null : Number(row.waiter_id),
          responsibleWaiterId: row.waiter_id == null
            ? (row.assigned_waiter_id == null ? null : Number(row.assigned_waiter_id))
            : Number(row.waiter_id),
          orderStatus: String(row.order_status),
          readyAt: row.ready_at == null ? null : (row.ready_at instanceof Date ? row.ready_at.toISOString() : String(row.ready_at)),
          items: [],
        };
        groups.set(orderId, group);
      }
      group.items.push({
        id: Number(row.item_id),
        kitchenTicketId: Number(row.ticket_id),
        kotNumber: String(row.kot_number),
        quantity: Number(row.quantity),
        itemNameSnapshot: String(row.item_name_snapshot),
        variantNameSnapshot: row.variant_name_snapshot == null ? null : String(row.variant_name_snapshot),
        modifierSummary: row.modifier_summary == null ? null : String(row.modifier_summary),
        notes: row.notes == null ? null : String(row.notes),
        prepStationName: row.prep_station_name == null ? null : String(row.prep_station_name),
        readyAt: row.item_ready_at instanceof Date ? row.item_ready_at.toISOString() : String(row.item_ready_at),
      });
    }

    res.status(200).json({ success: true, data: Array.from(groups.values()) });
  } catch (error) {
    next(error);
  }
}

export async function serveReadyServiceItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { organizationId, branchId, userId } = authContext(req);
    const orderId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
      throw new BadRequestError('Valid order and service item IDs are required', 'INVALID_SERVICE_ITEM');
    }

    const [scopeRows] = await getDatabasePool().execute<RowDataPacket[]>(
      `SELECT o.dining_table_id
       FROM kitchen_ticket_items kti
       JOIN kitchen_tickets kt ON kt.id = kti.kitchen_ticket_id
       JOIN orders o ON o.id = kt.order_id
       WHERE kti.id = ? AND o.id = ? AND o.organization_id = ? AND o.branch_id = ?
       LIMIT 1`,
      [itemId, orderId, organizationId, branchId]
    );
    if (!scopeRows.length) throw new NotFoundError('Ready service item not found', 'SERVICE_ITEM_NOT_FOUND');
    if (scopeRows[0].dining_table_id == null) throw new BadRequestError('Only dine-in table items use service', 'ORDER_NOT_SERVABLE');
    await ensureTableAccess(req, Number(scopeRows[0].dining_table_id));

    const result = await kitchenService.serveReadyItem(itemId, organizationId, branchId, userId);
    if (result.orderId !== orderId) throw new NotFoundError('Ready service item not found on this order', 'SERVICE_ITEM_NOT_FOUND');

    const order = await orderRepository.findById(orderId, organizationId, branchId);
    realtimePublisher.publish({
      type: 'service.item_served',
      organizationId,
      branchId,
      entityType: 'order',
      entityId: orderId,
      data: {
        orderId,
        itemId,
        ticketId: result.ticketId,
        orderServed: result.orderServed,
        diningTableId: order?.diningTableId ?? null,
        orderStatus: order?.orderStatus ?? null,
      },
    });
    if (result.orderServed && order) {
      realtimePublisher.publish({
        type: 'order.served',
        organizationId,
        branchId,
        entityType: 'order',
        entityId: order.id,
        data: { orderStatus: order.orderStatus, diningTableId: order.diningTableId, servedAt: order.servedAt },
      });
    }

    res.status(200).json({ success: true, data: { ...result, order } });
  } catch (error) {
    next(error);
  }
}
