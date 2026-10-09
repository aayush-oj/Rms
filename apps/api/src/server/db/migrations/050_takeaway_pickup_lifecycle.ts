import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function hasColumn(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

async function hasConstraint(connection: PoolConnection, constraint: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND CONSTRAINT_NAME = ?
      LIMIT 1`,
    [constraint]
  );
  return rows.length > 0;
}

export const migration050TakeawayPickupLifecycle: MigrationDefinition = {
  name: '050_takeaway_pickup_lifecycle',
  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await hasColumn(connection, 'orders', 'picked_up_at'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN picked_up_at DATETIME NULL AFTER served_by`);
    }
    if (!(await hasColumn(connection, 'orders', 'picked_up_by'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN picked_up_by BIGINT UNSIGNED NULL AFTER picked_up_at`);
    }
    if (!(await hasConstraint(connection, 'fk_orders_picked_up_by'))) {
      await connection.query(
        `ALTER TABLE orders
         ADD CONSTRAINT fk_orders_picked_up_by
         FOREIGN KEY (picked_up_by) REFERENCES users(id) ON DELETE RESTRICT`
      );
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    if (await hasConstraint(connection, 'fk_orders_picked_up_by')) {
      await connection.query('ALTER TABLE orders DROP FOREIGN KEY fk_orders_picked_up_by');
    }
    if (await hasColumn(connection, 'orders', 'picked_up_by')) {
      await connection.query('ALTER TABLE orders DROP COLUMN picked_up_by');
    }
    if (await hasColumn(connection, 'orders', 'picked_up_at')) {
      await connection.query('ALTER TABLE orders DROP COLUMN picked_up_at');
    }
  },
};
