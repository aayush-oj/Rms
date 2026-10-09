import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { managementRepository } from '../management/repository';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { MergeInput, SwapInput, TransferInput, TableOperationResult } from './types';
import { activeTableIdsForOrder, syncOrderTablesInTransaction } from './orderTables';
import { lockAndValidateMergeBillingInTransaction, reconcileMergeBillingInTransaction } from '../billing/mergeReconciliation';

const ACTIVE_ORDER_STATUSES = ['PLACED', 'PREPARING', 'READY', 'SERVED'] as const;
const STATUS_RANK: Record<(typeof ACTIVE_ORDER_STATUSES)[number], number> = {
  PLACED: 1,
  PREPARING: 2,
  READY: 3,
  SERVED: 4,
};

function assertActiveDineInOrder(order: RowDataPacket, label: string): void {
  if (!order) throw new NotFoundError(`${label} order not found`, 'ORDER_NOT_FOUND');
  if (order.order_type !== 'DINE_IN' || order.dining_table_id == null) {
    throw new BadRequestError(`${label} is not a dine-in table order`, 'ORDER_NOT_TABLE_ASSOCIATED');
  }
  if (!ACTIVE_ORDER_STATUSES.includes(order.order_status)) {
    throw new ConflictError(`${label} is not an open order`, 'ORDER_NOT_OPEN', { orderStatus: order.order_status });
  }
}

function sortIds(a: number, b: number): [number, number] { return a < b ? [a, b] : [b, a]; }

async function selectLockedTable(conn: PoolConnection, organizationId: number, branchId: number, tableId: number): Promise<RowDataPacket> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT * FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
    [tableId, organizationId, branchId]
  );
  if (!rows.length) throw new NotFoundError(`Dining table #${tableId} not found in this branch`, 'TABLE_NOT_FOUND');
  return rows[0];
}

async function selectLockedOrder(conn: PoolConnection, organizationId: number, branchId: number, orderId: number): Promise<RowDataPacket> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
    [orderId, organizationId, branchId]
  );
  if (!rows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
  return rows[0];
}

async function activeOrdersForTable(conn: PoolConnection, organizationId: number, branchId: number, tableId: number, lock = true): Promise<RowDataPacket[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT o.*
       FROM order_tables ot
       JOIN orders o ON o.id=ot.order_id
      WHERE ot.organization_id=? AND ot.branch_id=? AND ot.dining_table_id=?
        AND ot.released_at IS NULL
        AND o.order_type='DINE_IN'
        AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
      ORDER BY o.id ASC${lock ? ' FOR UPDATE' : ''}`,
    [organizationId, branchId, tableId]
  );
  return rows;
}

async function assertAccessToTables(
  organizationId: number,
  branchId: number,
  userId: number,
  permissions: string[],
  tableIds: number[],
): Promise<void> {
  for (const tableId of [...new Set(tableIds)]) {
    if (!(await managementRepository.canAccessTable(organizationId, userId, branchId, tableId, permissions))) {
      throw new ForbiddenError('You do not have access to one or more tables in this operation', 'TABLE_ACCESS_FORBIDDEN');
    }
  }
}

async function insertEvent(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  operationType: 'TRANSFER' | 'SWAP' | 'MERGE',
  performedBy: number,
  data: { orderId?: number; relatedOrderId?: number; sourceTableId: number; destinationTableId: number; metadata?: Record<string, unknown> }
): Promise<number> {
  const [result] = await conn.execute<ResultSetHeader>(
    `INSERT INTO order_operation_events
      (organization_id, branch_id, operation_type, order_id, related_order_id, source_table_id, destination_table_id, performed_by, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [organizationId, branchId, operationType, data.orderId ?? null, data.relatedOrderId ?? null,
      data.sourceTableId, data.destinationTableId, performedBy, JSON.stringify(data.metadata ?? {})]
  );
  return Number(result.insertId);
}

function mergedOrderStatus(source: RowDataPacket, destination: RowDataPacket): string {
  return STATUS_RANK[source.order_status as keyof typeof STATUS_RANK] < STATUS_RANK[destination.order_status as keyof typeof STATUS_RANK]
    ? source.order_status
    : destination.order_status;
}

async function attachSingleTable(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  tableId: number,
  performedBy: number,
): Promise<void> {
  await conn.execute(
    `INSERT INTO order_tables
      (organization_id,branch_id,order_id,dining_table_id,is_primary,attached_at,attached_by,released_at,released_by)
     VALUES(?,?,?,?,TRUE,NOW(),?,NULL,NULL)
     ON DUPLICATE KEY UPDATE
       is_primary=TRUE,
       attached_at=IF(released_at IS NULL,attached_at,NOW()),
       attached_by=VALUES(attached_by),
       released_at=NULL,released_by=NULL,updated_at=NOW()`,
    [organizationId, branchId, orderId, tableId, performedBy],
  );
}

export class TableOperationsRepository {
  private pool() { return getDatabasePool(); }

  async transfer(organizationId: number, branchId: number, performedBy: number, permissions: string[], input: TransferInput): Promise<TableOperationResult> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const sourceOrder = await selectLockedOrder(conn, organizationId, branchId, input.orderId);
      assertActiveDineInOrder(sourceOrder, 'Source');
      const sourceTableId = Number(sourceOrder.dining_table_id);
      const sourceTableIds = await activeTableIdsForOrder(conn, organizationId, branchId, input.orderId, true);
      if (sourceTableIds.includes(input.destinationTableId)) {
        throw new BadRequestError('Destination table already belongs to this dining party', 'TABLE_OPERATION_SAME_TABLE');
      }
      await assertAccessToTables(organizationId, branchId, performedBy, permissions, [...sourceTableIds, input.destinationTableId]);

      const result = await syncOrderTablesInTransaction(conn, {
        organizationId,
        branchId,
        orderId: input.orderId,
        primaryTableId: input.destinationTableId,
        tableIds: [input.destinationTableId],
        performedBy,
      });
      const eventId = await insertEvent(conn, organizationId, branchId, 'TRANSFER', performedBy, {
        orderId: input.orderId,
        sourceTableId,
        destinationTableId: input.destinationTableId,
        metadata: { previousTableIds: sourceTableIds, tableIds: result.tableIds },
      });
      await conn.commit();
      const [orderRows] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ?',
        [input.orderId, organizationId, branchId]
      );
      return { operationType: 'TRANSFER', sourceTableId, destinationTableId: input.destinationTableId, order: orderRows[0], eventId };
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }

  async swap(organizationId: number, branchId: number, performedBy: number, permissions: string[], input: SwapInput): Promise<TableOperationResult> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      if (input.sourceTableId === input.destinationTableId) throw new BadRequestError('Source and destination tables must be different', 'TABLE_OPERATION_SAME_TABLE');
      await assertAccessToTables(organizationId, branchId, performedBy, permissions, [input.sourceTableId, input.destinationTableId]);

      const sourceProbe = await activeOrdersForTable(conn, organizationId, branchId, input.sourceTableId, false);
      const destinationProbe = await activeOrdersForTable(conn, organizationId, branchId, input.destinationTableId, false);
      if (sourceProbe.length !== 1 || destinationProbe.length !== 1) {
        throw new ConflictError('Swap requires one active order on each table', 'SWAP_REQUIRES_SINGLE_ORDER_PER_TABLE');
      }
      if (Number(sourceProbe[0].id) === Number(destinationProbe[0].id)) {
        throw new ConflictError('Both tables already belong to the same dining party', 'SWAP_SAME_ORDER');
      }

      const [lowOrderId, highOrderId] = sortIds(Number(sourceProbe[0].id), Number(destinationProbe[0].id));
      const first = await selectLockedOrder(conn, organizationId, branchId, lowOrderId);
      const second = await selectLockedOrder(conn, organizationId, branchId, highOrderId);
      const source = Number(first.id) === Number(sourceProbe[0].id) ? first : second;
      const destination = Number(second.id) === Number(destinationProbe[0].id) ? second : first;
      assertActiveDineInOrder(source, 'Source');
      assertActiveDineInOrder(destination, 'Destination');

      const sourceTables = await activeTableIdsForOrder(conn, organizationId, branchId, Number(source.id), true);
      const destinationTables = await activeTableIdsForOrder(conn, organizationId, branchId, Number(destination.id), true);
      if (sourceTables.length !== 1 || destinationTables.length !== 1) {
        throw new ConflictError('Swap is only available for single-table parties. Use Manage Tables for joined parties.', 'SWAP_JOINED_TABLES_UNSUPPORTED');
      }
      if (sourceTables[0] !== input.sourceTableId || destinationTables[0] !== input.destinationTableId) {
        throw new ConflictError('Table assignments changed; refresh and retry', 'TABLE_OPERATION_STALE_STATE');
      }

      const [lowTableId, highTableId] = sortIds(input.sourceTableId, input.destinationTableId);
      await selectLockedTable(conn, organizationId, branchId, lowTableId);
      await selectLockedTable(conn, organizationId, branchId, highTableId);

      await conn.execute(
        `UPDATE order_tables
            SET released_at=NOW(),released_by=?,is_primary=FALSE,updated_at=NOW()
          WHERE organization_id=? AND branch_id=? AND order_id IN (?,?) AND released_at IS NULL`,
        [performedBy, organizationId, branchId, source.id, destination.id],
      );
      await attachSingleTable(conn, organizationId, branchId, Number(source.id), input.destinationTableId, performedBy);
      await attachSingleTable(conn, organizationId, branchId, Number(destination.id), input.sourceTableId, performedBy);

      await conn.execute(
        `UPDATE orders SET dining_table_id = CASE
          WHEN id = ? THEN ?
          WHEN id = ? THEN ?
          ELSE dining_table_id END, updated_at = NOW()
         WHERE organization_id = ? AND branch_id = ? AND id IN (?, ?)`,
        [source.id, input.destinationTableId, destination.id, input.sourceTableId,
          organizationId, branchId, source.id, destination.id]
      );
      await conn.execute(
        `UPDATE dining_tables SET status='occupied',updated_at=NOW()
          WHERE organization_id=? AND branch_id=? AND id IN (?,?)`,
        [organizationId, branchId, input.sourceTableId, input.destinationTableId],
      );

      const eventId = await insertEvent(conn, organizationId, branchId, 'SWAP', performedBy, {
        sourceTableId: input.sourceTableId, destinationTableId: input.destinationTableId,
        metadata: { sourceOrderId: Number(source.id), destinationOrderId: Number(destination.id) },
      });
      await conn.commit();
      const [orders] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id IN (?, ?) AND organization_id = ? AND branch_id = ? ORDER BY id',
        [source.id, destination.id, organizationId, branchId]
      );
      const sourceUpdated = orders.find((row) => Number(row.id) === Number(source.id));
      const destinationUpdated = orders.find((row) => Number(row.id) === Number(destination.id));
      return { operationType: 'SWAP', sourceTableId: input.sourceTableId, destinationTableId: input.destinationTableId, order: sourceUpdated, relatedOrder: destinationUpdated, eventId };
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }

  async merge(organizationId: number, branchId: number, performedBy: number, permissions: string[], input: MergeInput): Promise<TableOperationResult> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      if (input.sourceTableId === input.destinationTableId) throw new BadRequestError('Source and destination tables must be different', 'TABLE_OPERATION_SAME_TABLE');
      const sourceProbe = await activeOrdersForTable(conn, organizationId, branchId, input.sourceTableId, false);
      const destinationProbe = await activeOrdersForTable(conn, organizationId, branchId, input.destinationTableId, false);
      if (sourceProbe.length !== 1 || destinationProbe.length !== 1) {
        throw new ConflictError('Merge requires an active order on each selected table', 'MERGE_REQUIRES_SINGLE_ORDER_PER_TABLE');
      }
      if (Number(sourceProbe[0].id) === Number(destinationProbe[0].id)) {
        throw new ConflictError('Both tables already belong to the same dining party', 'MERGE_SAME_ORDER');
      }

      const [lowOrderId, highOrderId] = sortIds(Number(sourceProbe[0].id), Number(destinationProbe[0].id));
      const firstOrder = await selectLockedOrder(conn, organizationId, branchId, lowOrderId);
      const secondOrder = await selectLockedOrder(conn, organizationId, branchId, highOrderId);
      const sourceOrder = Number(firstOrder.id) === Number(sourceProbe[0].id) ? firstOrder : secondOrder;
      const destinationOrder = Number(secondOrder.id) === Number(destinationProbe[0].id) ? secondOrder : firstOrder;
      assertActiveDineInOrder(sourceOrder, 'Source');
      assertActiveDineInOrder(destinationOrder, 'Destination');

      const sourceTableIds = await activeTableIdsForOrder(conn, organizationId, branchId, Number(sourceOrder.id), true);
      const destinationTableIds = await activeTableIdsForOrder(conn, organizationId, branchId, Number(destinationOrder.id), true);
      await assertAccessToTables(organizationId, branchId, performedBy, permissions, [...sourceTableIds, ...destinationTableIds]);
      if (!sourceTableIds.includes(input.sourceTableId) || !destinationTableIds.includes(input.destinationTableId)) {
        throw new ConflictError('Table assignments changed; refresh and retry', 'TABLE_OPERATION_STALE_STATE');
      }
      if (sourceOrder.payment_status !== 'UNPAID' || destinationOrder.payment_status !== 'UNPAID') {
        throw new ConflictError('Merge requires both orders to be unpaid', 'MERGE_FINANCIAL_SETTLEMENT_EXISTS');
      }
      if (
        Boolean(sourceOrder.vat_registered_snapshot) !== Boolean(destinationOrder.vat_registered_snapshot) ||
        String(sourceOrder.tax_registration_number_snapshot || '') !== String(destinationOrder.tax_registration_number_snapshot || '') ||
        Number(sourceOrder.vat_rate_snapshot || 0) !== Number(destinationOrder.vat_rate_snapshot || 0) ||
        String(sourceOrder.rounding_method_snapshot || 'HALF_EVEN') !== String(destinationOrder.rounding_method_snapshot || 'HALF_EVEN')
      ) {
        throw new ConflictError('Orders created under different VAT profiles cannot be merged', 'MERGE_VAT_PROFILE_MISMATCH');
      }

      const combinedStatus = mergedOrderStatus(sourceOrder, destinationOrder);
      const combinedManualDiscount = Number(destinationOrder.manual_discount || 0) + Number(sourceOrder.manual_discount || 0);
      const billingState = await lockAndValidateMergeBillingInTransaction(conn, {
        organizationId,
        branchId,
        sourceOrderId: Number(sourceOrder.id),
        destinationOrderId: Number(destinationOrder.id),
        combinedOrderStatus: combinedStatus,
      });

      const [roundOffsetRows] = await conn.execute<RowDataPacket[]>(
        'SELECT COALESCE(MAX(round_number),0) AS max_round FROM order_rounds WHERE order_id=? FOR UPDATE',
        [destinationOrder.id],
      );
      const roundOffset = Number(roundOffsetRows[0]?.max_round || 0);
      await conn.execute(
        `UPDATE order_rounds
            SET order_id=?, round_number=round_number+?, updated_at=NOW()
          WHERE order_id=? AND organization_id=? AND branch_id=?`,
        [destinationOrder.id, roundOffset, sourceOrder.id, organizationId, branchId],
      );
      await conn.execute(
        `UPDATE kitchen_tickets SET order_id=?, updated_at=NOW()
          WHERE order_id=? AND organization_id=? AND branch_id=?`,
        [destinationOrder.id, sourceOrder.id, organizationId, branchId],
      );
      await conn.execute(
        `UPDATE inventory_consumption_events SET order_id=?
          WHERE order_id=? AND organization_id=? AND branch_id=?`,
        [destinationOrder.id, sourceOrder.id, organizationId, branchId],
      );
      await conn.execute(
        `UPDATE order_item_recipe_snapshots SET order_id=?
          WHERE order_id=? AND organization_id=? AND branch_id=?`,
        [destinationOrder.id, sourceOrder.id, organizationId, branchId],
      );
      await conn.execute(
        `UPDATE order_items SET origin_order_id = COALESCE(origin_order_id, order_id), order_id = ?, updated_at = NOW() WHERE order_id = ?`,
        [destinationOrder.id, sourceOrder.id]
      );
      await conn.execute(
        `UPDATE orders SET subtotal = subtotal + ?, discount = discount + ?, membership_discount = membership_discount + ?, manual_discount = manual_discount + ?, taxable_amount = taxable_amount + ?,
           tax = tax + ?, rounding_delta = rounding_delta + ?, grand_total = grand_total + ?, order_status = ?,
           billing_discount_type = CASE WHEN ? > 0 THEN 'AMOUNT' ELSE billing_discount_type END,
           billing_discount_value = CASE WHEN ? > 0 THEN ? ELSE billing_discount_value END,
           updated_at = NOW()
         WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [
          Number(sourceOrder.subtotal),
          Number(sourceOrder.discount),
          Number(sourceOrder.membership_discount || 0),
          Number(sourceOrder.manual_discount || 0),
          Number(sourceOrder.taxable_amount || 0),
          Number(sourceOrder.tax),
          Number(sourceOrder.rounding_delta || 0),
          Number(sourceOrder.grand_total),
          combinedStatus,
          combinedManualDiscount,
          combinedManualDiscount,
          combinedManualDiscount,
          destinationOrder.id,
          organizationId,
          branchId,
        ]
      );

      await conn.execute(
        `UPDATE orders SET order_status = 'MERGED', merged_into_order_id = ?, merged_at = NOW(), merged_by = ?, updated_at = NOW()
         WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [destinationOrder.id, performedBy, sourceOrder.id, organizationId, branchId]
      );

      const billingResult = await reconcileMergeBillingInTransaction(conn, {
        organizationId,
        branchId,
        sourceOrderId: Number(sourceOrder.id),
        destinationOrderId: Number(destinationOrder.id),
        performedBy,
        state: billingState,
      });

      const mergedTableIds = [...new Set([...destinationTableIds, ...sourceTableIds])];
      await syncOrderTablesInTransaction(conn, {
        organizationId,
        branchId,
        orderId: Number(destinationOrder.id),
        primaryTableId: Number(destinationOrder.dining_table_id),
        tableIds: mergedTableIds,
        performedBy,
      });

      const eventId = await insertEvent(conn, organizationId, branchId, 'MERGE', performedBy, {
        orderId: Number(sourceOrder.id),
        relatedOrderId: Number(destinationOrder.id),
        sourceTableId: input.sourceTableId,
        destinationTableId: input.destinationTableId,
        metadata: {
          sourceOrderId: Number(sourceOrder.id),
          destinationOrderId: Number(destinationOrder.id),
          sourceTableIds,
          destinationTableIds,
          mergedTableIds,
          billing: billingResult,
        },
      });
      await conn.commit();
      const [orders] = await this.pool().execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id IN (?, ?) AND organization_id = ? AND branch_id = ? ORDER BY id',
        [sourceOrder.id, destinationOrder.id, organizationId, branchId]
      );
      const mergedSource = orders.find((row) => Number(row.id) === Number(sourceOrder.id));
      const canonical = orders.find((row) => Number(row.id) === Number(destinationOrder.id));
      return { operationType: 'MERGE', sourceTableId: input.sourceTableId, destinationTableId: input.destinationTableId, order: canonical, relatedOrder: mergedSource, eventId };
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  }

  async listTableSessions(organizationId: number, branchId: number, userId?: number, permissions: string[] = []): Promise<any[]> {
    const [tableRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT id, table_number, capacity, status, is_active FROM dining_tables WHERE organization_id = ? AND branch_id = ? AND is_active = TRUE ORDER BY table_number',
      [organizationId, branchId]
    );
    const [ownershipRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT ot.dining_table_id AS attached_table_id,ot.is_primary,
              o.id,o.order_number,o.dining_table_id,o.waiter_id,o.order_status,o.payment_status,o.subtotal,o.grand_total,o.created_at
         FROM order_tables ot
         JOIN orders o ON o.id=ot.order_id
        WHERE ot.organization_id=? AND ot.branch_id=? AND ot.released_at IS NULL
          AND o.order_type='DINE_IN'
          AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
        ORDER BY o.id,ot.is_primary DESC,ot.id`,
      [organizationId, branchId]
    );

    const visibleTableIds = userId == null ? null : new Set(await managementRepository.accessibleTableIds(organizationId, userId, branchId, permissions));
    const visibleTables = visibleTableIds == null ? tableRows : tableRows.filter(table => visibleTableIds.has(Number(table.id)));
    const tableIdsByOrder = new Map<number, number[]>();
    const ownerByTable = new Map<number, RowDataPacket>();
    for (const row of ownershipRows) {
      const orderId = Number(row.id);
      const tableIds = tableIdsByOrder.get(orderId) ?? [];
      tableIds.push(Number(row.attached_table_id));
      tableIdsByOrder.set(orderId, tableIds);
      if (!ownerByTable.has(Number(row.attached_table_id))) ownerByTable.set(Number(row.attached_table_id), row);
    }

    return visibleTables.map((table) => {
      const owner = ownerByTable.get(Number(table.id));
      const persistedStatus = String(table.status || '').toLowerCase();
      const operationalStatus = owner ? 'occupied' : persistedStatus === 'occupied' ? 'available' : persistedStatus;
      return {
        id: Number(table.id), tableNumber: String(table.table_number), capacity: Number(table.capacity), status: operationalStatus,
        activeOrderCount: owner ? 1 : 0,
        activeOrder: owner ? {
          id: Number(owner.id), orderNumber: String(owner.order_number), diningTableId: Number(owner.dining_table_id),
          primaryTableId: Number(owner.dining_table_id), tableIds: tableIdsByOrder.get(Number(owner.id)) ?? [Number(table.id)],
          isPrimaryTable: Boolean(owner.is_primary),
          waiterId: owner.waiter_id == null ? null : Number(owner.waiter_id), orderStatus: String(owner.order_status),
          paymentStatus: String(owner.payment_status), subtotal: Number(owner.subtotal), grandTotal: Number(owner.grand_total),
          createdAt: owner.created_at instanceof Date ? owner.created_at.toISOString() : String(owner.created_at),
        } : null,
      };
    });
  }
}

export const tableOperationsRepository = new TableOperationsRepository();
