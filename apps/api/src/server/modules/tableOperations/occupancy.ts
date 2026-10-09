import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { NotFoundError } from '../../shared/errors';
import { TABLE_OWNING_ORDER_STATUSES, canOrderOwnTable } from '../../domain/orderLifecycle';

export type ReconciledTableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning' | 'disabled';

const TABLE_OWNING_STATUS_SQL = TABLE_OWNING_ORDER_STATUSES.map(() => '?').join(',');

async function lockedTableStatus(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  tableId: number
): Promise<ReconciledTableStatus> {
  const [tableRows] = await conn.execute<RowDataPacket[]>(
    `SELECT status FROM dining_tables
     WHERE id = ? AND organization_id = ? AND branch_id = ?
     FOR UPDATE`,
    [tableId, organizationId, branchId]
  );
  if (!tableRows.length) {
    throw new NotFoundError(`Dining table #${tableId} not found in this branch`, 'TABLE_NOT_FOUND');
  }
  return String(tableRows[0].status) as ReconciledTableStatus;
}

async function activeDineInOrderCount(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  tableId: number
): Promise<number> {
  const [activeRows] = await conn.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT o.id) AS active_count
       FROM order_tables ot
       JOIN orders o ON o.id = ot.order_id
      WHERE ot.organization_id = ? AND ot.branch_id = ? AND ot.dining_table_id = ?
        AND ot.released_at IS NULL
        AND o.order_type = 'DINE_IN'
        AND o.order_status IN (${TABLE_OWNING_STATUS_SQL})`,
    [organizationId, branchId, tableId, ...TABLE_OWNING_ORDER_STATUSES]
  );
  return Number(activeRows[0]?.active_count || 0);
}

/**
 * Authoritative table lifecycle reconciliation for callers that already own a DB transaction.
 * Active dine-in ownership comes from order_tables so every table joined to the same party
 * stays occupied until the relation is released or the order reaches a terminal state.
 */
export async function reconcileTableOccupancyInTransaction(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  tableId: number
): Promise<ReconciledTableStatus> {
  const currentStatus = await lockedTableStatus(conn, organizationId, branchId, tableId);
  const activeCount = await activeDineInOrderCount(conn, organizationId, branchId, tableId);

  let nextStatus: ReconciledTableStatus = currentStatus;
  if (activeCount > 0) {
    nextStatus = 'occupied';
  } else if (currentStatus === 'occupied') {
    nextStatus = 'available';
  }

  if (nextStatus !== currentStatus) {
    await conn.execute(
      `UPDATE dining_tables SET status = ?, updated_at = NOW()
       WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [nextStatus, tableId, organizationId, branchId]
    );
  }

  return nextStatus;
}

export async function reconcileTableOccupancy(
  organizationId: number,
  branchId: number,
  tableId: number
): Promise<ReconciledTableStatus> {
  const conn = await getDatabasePool().getConnection();
  try {
    await conn.beginTransaction();
    const status = await reconcileTableOccupancyInTransaction(conn, organizationId, branchId, tableId);
    await conn.commit();
    return status;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export function isActiveDineInOrderStatus(status: string): boolean {
  return canOrderOwnTable(status);
}
