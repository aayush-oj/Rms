import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';

export const ACTIVE_TABLE_ORDER_STATUSES = ['PLACED', 'PREPARING', 'READY', 'SERVED'] as const;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

export function normalizeDiningTableIds(primaryTableId: number | null | undefined, tableIds?: number[] | null): number[] {
  const values = [primaryTableId ?? null, ...(tableIds ?? [])]
    .filter((value): value is number => Number.isInteger(value) && Number(value) > 0)
    .map(Number);
  return [...new Set(values)];
}

/**
 * Stage all tables for a new dine-in order inside the order creation transaction.
 * Migration 047's AFTER INSERT trigger consumes these connection-scoped rows and
 * creates every order_tables relation before the transaction can commit. If order
 * creation fails, the staged rows roll back with it.
 */
export async function stageOrderTablesForCreateInTransaction(
  conn: PoolConnection,
  data: {
    organizationId: number;
    branchId: number;
    primaryTableId: number;
    tableIds: number[];
    performedBy: number;
  },
): Promise<number[]> {
  const desired = normalizeDiningTableIds(data.primaryTableId, data.tableIds);
  if (!desired.length) throw new BadRequestError('A dine-in order must have at least one table', 'DINING_TABLE_REQUIRED');
  if (desired.length > 20) throw new BadRequestError('A dining party cannot occupy more than 20 tables', 'TOO_MANY_DINING_TABLES');

  const sorted = [...desired].sort((a, b) => a - b);
  const [tables] = await conn.execute<RowDataPacket[]>(
    `SELECT id,status,is_active
       FROM dining_tables
      WHERE organization_id=? AND branch_id=? AND id IN (${placeholders(sorted.length)})
      ORDER BY id FOR UPDATE`,
    [data.organizationId, data.branchId, ...sorted],
  );
  if (tables.length !== sorted.length) {
    throw new NotFoundError('One or more selected dining tables were not found in this branch', 'DINING_TABLE_NOT_FOUND');
  }
  for (const table of tables) {
    if (!Boolean(table.is_active)) throw new BadRequestError(`Dining table #${Number(table.id)} is inactive`, 'TABLE_INACTIVE');
    const status = String(table.status || '').toLowerCase();
    if (!['available', 'occupied'].includes(status)) {
      throw new ConflictError(`Dining table #${Number(table.id)} is ${status || 'unavailable'}`, 'DESTINATION_TABLE_NOT_AVAILABLE');
    }
  }

  const [owners] = await conn.execute<RowDataPacket[]>(
    `SELECT ot.dining_table_id,ot.order_id
       FROM order_tables ot
       JOIN orders o ON o.id=ot.order_id
      WHERE ot.organization_id=? AND ot.branch_id=?
        AND ot.dining_table_id IN (${placeholders(sorted.length)})
        AND ot.released_at IS NULL
        AND o.order_type='DINE_IN'
        AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
      FOR UPDATE`,
    [data.organizationId, data.branchId, ...sorted],
  );
  if (owners.length) {
    const conflict = owners[0];
    throw new ConflictError(
      `Dining table #${Number(conflict.dining_table_id)} already belongs to another active order`,
      'TABLE_ALREADY_OCCUPIED',
      { tableId: Number(conflict.dining_table_id), orderId: Number(conflict.order_id) },
    );
  }

  await conn.execute(
    `DELETE FROM pending_order_table_claims WHERE connection_id=CONNECTION_ID()`,
  );
  for (const tableId of desired) {
    await conn.execute(
      `INSERT INTO pending_order_table_claims
        (connection_id,organization_id,branch_id,dining_table_id,is_primary,performed_by)
       VALUES(CONNECTION_ID(),?,?,?,?,?)`,
      [data.organizationId, data.branchId, tableId, tableId === data.primaryTableId, data.performedBy],
    );
  }
  return desired;
}

export async function activeTableIdsForOrder(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  lock = false,
): Promise<number[]> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT dining_table_id
       FROM order_tables
      WHERE organization_id = ? AND branch_id = ? AND order_id = ? AND released_at IS NULL
      ORDER BY is_primary DESC, id ASC${lock ? ' FOR UPDATE' : ''}`,
    [organizationId, branchId, orderId],
  );
  return rows.map((row) => Number(row.dining_table_id));
}

async function releaseTableStatusIfFree(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  tableId: number,
): Promise<void> {
  const [owners] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS active_count
       FROM order_tables ot
       JOIN orders o ON o.id = ot.order_id
      WHERE ot.organization_id = ? AND ot.branch_id = ? AND ot.dining_table_id = ?
        AND ot.released_at IS NULL
        AND o.order_type = 'DINE_IN'
        AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')`,
    [organizationId, branchId, tableId],
  );
  if (Number(owners[0]?.active_count || 0) === 0) {
    await conn.execute(
      `UPDATE dining_tables
          SET status = CASE WHEN status = 'occupied' THEN 'available' ELSE status END,
              updated_at = NOW()
        WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [tableId, organizationId, branchId],
    );
  }
}

export async function syncOrderTablesInTransaction(
  conn: PoolConnection,
  data: {
    organizationId: number;
    branchId: number;
    orderId: number;
    primaryTableId: number;
    tableIds: number[];
    performedBy: number;
    allowOwnedByOrderIds?: number[];
  },
): Promise<{ tableIds: number[]; addedTableIds: number[]; removedTableIds: number[]; primaryTableId: number }> {
  const desired = normalizeDiningTableIds(data.primaryTableId, data.tableIds);
  if (!desired.length) throw new BadRequestError('A dine-in order must have at least one table', 'DINING_TABLE_REQUIRED');
  if (desired.length > 20) throw new BadRequestError('A dining party cannot occupy more than 20 tables', 'TOO_MANY_DINING_TABLES');
  if (!desired.includes(data.primaryTableId)) desired.unshift(data.primaryTableId);

  const current = await activeTableIdsForOrder(conn, data.organizationId, data.branchId, data.orderId, true);
  const allToLock = [...new Set([...current, ...desired])].sort((a, b) => a - b);
  if (allToLock.length) {
    const [tables] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status, is_active
         FROM dining_tables
        WHERE organization_id = ? AND branch_id = ? AND id IN (${placeholders(allToLock.length)})
        ORDER BY id FOR UPDATE`,
      [data.organizationId, data.branchId, ...allToLock],
    );
    const found = new Map(tables.map((row) => [Number(row.id), row]));
    for (const tableId of desired) {
      const table = found.get(tableId);
      if (!table) throw new NotFoundError(`Dining table #${tableId} was not found in this branch`, 'DINING_TABLE_NOT_FOUND');
      if (!Boolean(table.is_active)) throw new BadRequestError(`Dining table #${tableId} is inactive`, 'TABLE_INACTIVE');
      const status = String(table.status || '').toLowerCase();
      const alreadyOwned = current.includes(tableId);
      if (!alreadyOwned && !['available', 'occupied'].includes(status)) {
        throw new ConflictError(`Dining table #${tableId} is ${status || 'unavailable'}`, 'DESTINATION_TABLE_NOT_AVAILABLE');
      }
    }
  }

  const allowedOwnerIds = new Set([data.orderId, ...(data.allowOwnedByOrderIds ?? [])]);
  if (desired.length) {
    const [owners] = await conn.execute<RowDataPacket[]>(
      `SELECT ot.dining_table_id, ot.order_id
         FROM order_tables ot
         JOIN orders o ON o.id = ot.order_id
        WHERE ot.organization_id = ? AND ot.branch_id = ?
          AND ot.dining_table_id IN (${placeholders(desired.length)})
          AND ot.released_at IS NULL
          AND o.order_type = 'DINE_IN'
          AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
        FOR UPDATE`,
      [data.organizationId, data.branchId, ...desired],
    );
    const conflict = owners.find((row) => !allowedOwnerIds.has(Number(row.order_id)));
    if (conflict) {
      throw new ConflictError(
        `Dining table #${Number(conflict.dining_table_id)} already belongs to another active order`,
        'TABLE_ALREADY_OCCUPIED',
        { tableId: Number(conflict.dining_table_id), orderId: Number(conflict.order_id) },
      );
    }
  }

  const desiredSet = new Set(desired);
  const currentSet = new Set(current);
  const removedTableIds = current.filter((tableId) => !desiredSet.has(tableId));
  const addedTableIds = desired.filter((tableId) => !currentSet.has(tableId));

  if (removedTableIds.length) {
    await conn.execute(
      `UPDATE order_tables
          SET released_at = NOW(), released_by = ?, is_primary = FALSE, updated_at = NOW()
        WHERE organization_id = ? AND branch_id = ? AND order_id = ?
          AND released_at IS NULL AND dining_table_id IN (${placeholders(removedTableIds.length)})`,
      [data.performedBy, data.organizationId, data.branchId, data.orderId, ...removedTableIds],
    );
  }

  await conn.execute(
    `UPDATE order_tables SET is_primary = FALSE, updated_at = NOW()
      WHERE organization_id = ? AND branch_id = ? AND order_id = ? AND released_at IS NULL`,
    [data.organizationId, data.branchId, data.orderId],
  );

  for (const tableId of desired) {
    await conn.execute(
      `INSERT INTO order_tables
        (organization_id, branch_id, order_id, dining_table_id, is_primary, attached_at, attached_by, released_at, released_by)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         is_primary = VALUES(is_primary),
         attached_at = IF(released_at IS NULL, attached_at, NOW()),
         attached_by = VALUES(attached_by),
         released_at = NULL, released_by = NULL, updated_at = NOW()`,
      [data.organizationId, data.branchId, data.orderId, tableId, tableId === data.primaryTableId, data.performedBy],
    );
  }

  await conn.execute(
    `UPDATE orders SET dining_table_id = ?, updated_at = NOW()
      WHERE id = ? AND organization_id = ? AND branch_id = ?`,
    [data.primaryTableId, data.orderId, data.organizationId, data.branchId],
  );

  if (desired.length) {
    await conn.execute(
      `UPDATE dining_tables SET status = 'occupied', updated_at = NOW()
        WHERE organization_id = ? AND branch_id = ? AND id IN (${placeholders(desired.length)})`,
      [data.organizationId, data.branchId, ...desired],
    );
  }
  for (const tableId of removedTableIds) {
    await releaseTableStatusIfFree(conn, data.organizationId, data.branchId, tableId);
  }

  return { tableIds: desired, addedTableIds, removedTableIds, primaryTableId: data.primaryTableId };
}

export async function releaseOrderTablesInTransaction(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  releasedBy: number,
): Promise<number[]> {
  const tableIds = await activeTableIdsForOrder(conn, organizationId, branchId, orderId, true);
  if (!tableIds.length) return [];
  await conn.execute(
    `UPDATE order_tables
        SET released_at = NOW(), released_by = ?, is_primary = FALSE, updated_at = NOW()
      WHERE organization_id = ? AND branch_id = ? AND order_id = ? AND released_at IS NULL`,
    [releasedBy, organizationId, branchId, orderId],
  );
  for (const tableId of tableIds) await releaseTableStatusIfFree(conn, organizationId, branchId, tableId);
  return tableIds;
}
