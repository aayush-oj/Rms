import { Router, Request, Response, NextFunction } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { authenticate, requirePermission } from '../identity/middleware';
import { managementRepository } from '../management/repository';
import { appendDomainAudit } from '../domainAudit/service';
import { realtimePublisher } from '../../realtime/publisher';
import { activeTableIdsForOrder, syncOrderTablesInTransaction } from '../tableOperations/orderTables';
import { tableOperationsRepository } from '../tableOperations/repository';

const ACTIVE_STATUSES = ['PLACED', 'PREPARING', 'READY', 'SERVED'] as const;

const manageTablesSchema = z.object({
  tableIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
  primaryTableId: z.coerce.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (new Set(value.tableIds).size !== value.tableIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tableIds'], message: 'Each table may only be selected once' });
  }
  if (value.primaryTableId != null && !value.tableIds.includes(value.primaryTableId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['primaryTableId'], message: 'Primary table must be one of the selected tables' });
  }
});

function context(req: Request) {
  if (!req.user?.organizationId || !req.user.activeBranchId) {
    throw new ForbiddenError('Active tenant and branch context are required', 'MISSING_TENANT_CONTEXT');
  }
  return {
    organizationId: req.user.organizationId,
    branchId: req.user.activeBranchId,
    userId: req.user.id,
    permissions: req.user.permissions,
  };
}

async function assertTableAccess(c: ReturnType<typeof context>, tableIds: number[]): Promise<void> {
  for (const tableId of [...new Set(tableIds)]) {
    if (!(await managementRepository.canAccessTable(c.organizationId, c.userId, c.branchId, tableId, c.permissions))) {
      throw new ForbiddenError('You do not have access to one or more selected tables', 'TABLE_ACCESS_FORBIDDEN');
    }
  }
}

async function activeOwnerForTable(organizationId: number, branchId: number, tableId: number): Promise<RowDataPacket> {
  const [rows] = await getDatabasePool().execute<RowDataPacket[]>(
    `SELECT o.*,ot.is_primary
       FROM order_tables ot
       JOIN orders o ON o.id=ot.order_id
      WHERE ot.organization_id=? AND ot.branch_id=? AND ot.dining_table_id=?
        AND ot.released_at IS NULL
        AND o.order_type='DINE_IN'
        AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
      ORDER BY ot.is_primary DESC,o.id DESC LIMIT 1`,
    [organizationId, branchId, tableId],
  );
  if (!rows.length) throw new NotFoundError('No active order owns this table', 'TABLE_ACTIVE_ORDER_NOT_FOUND');
  return rows[0];
}

function publishTableChanges(
  c: ReturnType<typeof context>,
  orderId: number,
  tableIds: number[],
  primaryTableId: number,
  changedIds: number[],
): void {
  realtimePublisher.publish({
    type: 'order.tables_changed',
    organizationId: c.organizationId,
    branchId: c.branchId,
    entityType: 'order',
    entityId: orderId,
    data: { orderId, tableIds, primaryTableId },
  });
  for (const tableId of [...new Set(changedIds)]) {
    realtimePublisher.publish({
      type: 'table.status_changed',
      organizationId: c.organizationId,
      branchId: c.branchId,
      entityType: 'table',
      entityId: tableId,
      data: { orderId, tableIds, primaryTableId },
    });
  }
}

export const multiTableDiningRouter = Router();
multiTableDiningRouter.use(authenticate());

multiTableDiningRouter.get(
  '/tables',
  requirePermission('pos:tables:manage', 'pos:orders:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      const data = await tableOperationsRepository.listTableSessions(c.organizationId, c.branchId, c.userId, c.permissions);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  },
);

multiTableDiningRouter.get(
  '/tables/:tableId/order',
  requirePermission('pos:tables:manage', 'pos:orders:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = context(req);
      const tableId = Number(req.params.tableId);
      if (!Number.isInteger(tableId) || tableId <= 0) throw new BadRequestError('Invalid table id', 'INVALID_TABLE_ID');
      await assertTableAccess(c, [tableId]);
      const row = await activeOwnerForTable(c.organizationId, c.branchId, tableId);
      res.json({ success: true, data: {
        id: Number(row.id),
        orderNumber: String(row.order_number),
        diningTableId: Number(row.dining_table_id),
        orderStatus: String(row.order_status),
        paymentStatus: String(row.payment_status),
      } });
    } catch (error) { next(error); }
  },
);

multiTableDiningRouter.post(
  '/orders/:orderId/tables',
  requirePermission('pos:tables:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    const conn = await getDatabasePool().getConnection();
    try {
      const c = context(req);
      const orderId = Number(req.params.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) throw new BadRequestError('Invalid order id', 'INVALID_ORDER_ID');
      const parsed = manageTablesSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message || 'Invalid table selection', 'INVALID_TABLE_SELECTION');
      const requested = [...new Set(parsed.data.tableIds.map(Number))];
      const primaryTableId = parsed.data.primaryTableId ?? requested[0];

      await conn.beginTransaction();
      const [orders] = await conn.execute<RowDataPacket[]>(
        `SELECT id,order_type,order_status,dining_table_id
           FROM orders WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,
        [orderId, c.organizationId, c.branchId],
      );
      if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      if (String(orders[0].order_type) !== 'DINE_IN') throw new BadRequestError('Only dine-in orders can occupy dining tables', 'ORDER_NOT_TABLE_ASSOCIATED');
      if (!ACTIVE_STATUSES.includes(String(orders[0].order_status) as typeof ACTIVE_STATUSES[number])) {
        throw new BadRequestError('Only an active dine-in order can manage tables', 'ORDER_NOT_OPEN');
      }

      const current = await activeTableIdsForOrder(conn, c.organizationId, c.branchId, orderId, true);
      await assertTableAccess(c, [...current, ...requested]);
      const result = await syncOrderTablesInTransaction(conn, {
        organizationId: c.organizationId,
        branchId: c.branchId,
        orderId,
        primaryTableId,
        tableIds: requested,
        performedBy: c.userId,
      });
      await conn.commit();

      const changedTableIds = [...new Set([...current, ...result.tableIds])];
      publishTableChanges(c, orderId, result.tableIds, result.primaryTableId, changedTableIds);
      appendDomainAudit(req, {
        action: 'ORDER_TABLES_CHANGED',
        entityType: 'order',
        entityId: orderId,
        before: { tableIds: current, primaryTableId: Number(orders[0].dining_table_id) },
        after: { tableIds: result.tableIds, primaryTableId: result.primaryTableId },
        metadata: { addedTableIds: result.addedTableIds, removedTableIds: result.removedTableIds },
      });
      res.json({ success: true, data: result });
    } catch (error) {
      try { await conn.rollback(); } catch {}
      next(error);
    } finally { conn.release(); }
  },
);
