import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration038ReconcileTableOccupancy: MigrationDefinition = {
  name: '038_reconcile_table_occupancy',
  up: async (connection: PoolConnection): Promise<void> => {
    // Active dine-in orders are the source of truth for operational OCCUPIED state.
    await connection.query(`
      UPDATE dining_tables dt
      SET dt.status = 'occupied', dt.updated_at = NOW()
      WHERE dt.status <> 'occupied'
        AND EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.organization_id = dt.organization_id
            AND o.branch_id = dt.branch_id
            AND o.dining_table_id = dt.id
            AND o.order_type = 'DINE_IN'
            AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
        )
    `);

    // Historical terminal orders, including MERGED orders, must never pin a table occupied.
    // Preserve explicit manual states (reserved/cleaning/disabled); only repair stale occupied rows.
    await connection.query(`
      UPDATE dining_tables dt
      SET dt.status = 'available', dt.updated_at = NOW()
      WHERE dt.status = 'occupied'
        AND NOT EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.organization_id = dt.organization_id
            AND o.branch_id = dt.branch_id
            AND o.dining_table_id = dt.id
            AND o.order_type = 'DINE_IN'
            AND o.order_status IN ('PLACED','PREPARING','READY','SERVED')
        )
    `);
  },
  down: async (_connection: PoolConnection): Promise<void> => {
    // Reconciliation corrects derived operational state and is intentionally not reversible.
  },
};
