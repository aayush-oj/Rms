import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration025MembershipTransactionIntegration: MigrationDefinition = {
  name: '025_membership_transaction_integration',
  up: async (connection: PoolConnection): Promise<void> => {
    const addColumn = async (table: string, column: string, ddl: string) => {
      const [rows] = await connection.query<any[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
      if (rows.length === 0) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };

    await addColumn('orders', 'membership_id', 'membership_id BIGINT UNSIGNED NULL AFTER customer_id');
    await addColumn('orders', 'membership_number_snapshot', 'membership_number_snapshot VARCHAR(50) NULL AFTER membership_id');
    await addColumn('orders', 'membership_tier_snapshot', 'membership_tier_snapshot VARCHAR(50) NULL AFTER membership_number_snapshot');
    await addColumn('orders', 'membership_discount', 'membership_discount DECIMAL(12,4) NOT NULL DEFAULT 0.0000 AFTER discount');
    await addColumn('orders', 'manual_discount', 'manual_discount DECIMAL(12,4) NOT NULL DEFAULT 0.0000 AFTER membership_discount');

    await connection.query(`UPDATE orders SET manual_discount = discount WHERE manual_discount = 0 AND discount <> 0`);

    const [membershipIndex] = await connection.query<any[]>(`SHOW INDEX FROM orders WHERE Key_name = 'idx_orders_membership'`);
    if (membershipIndex.length === 0) {
      await connection.query(`ALTER TABLE orders ADD INDEX idx_orders_membership (organization_id, membership_id)`);
    }
    const [membershipFk] = await connection.query<any[]>(`
      SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_membership'
    `);
    if (membershipFk.length === 0) {
      await connection.query(`ALTER TABLE orders ADD CONSTRAINT fk_orders_membership FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE SET NULL`);
    }

    const [usageIndex] = await connection.query<any[]>(`SHOW INDEX FROM membership_usages WHERE Key_name = 'idx_membership_usage_order_benefit'`);
    if (usageIndex.length === 0) {
      await connection.query(`ALTER TABLE membership_usages ADD INDEX idx_membership_usage_order_benefit (organization_id, order_id, benefit_type)`);
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    const [usageIndex] = await connection.query<any[]>(`SHOW INDEX FROM membership_usages WHERE Key_name = 'idx_membership_usage_order_benefit'`);
    if (usageIndex.length) await connection.query(`ALTER TABLE membership_usages DROP INDEX idx_membership_usage_order_benefit`);
    const [membershipFk] = await connection.query<any[]>(`
      SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_membership'
    `);
    if (membershipFk.length) await connection.query(`ALTER TABLE orders DROP FOREIGN KEY fk_orders_membership`);
    const [membershipIndex] = await connection.query<any[]>(`SHOW INDEX FROM orders WHERE Key_name = 'idx_orders_membership'`);
    if (membershipIndex.length) await connection.query(`ALTER TABLE orders DROP INDEX idx_orders_membership`);
    for (const column of ['manual_discount', 'membership_discount', 'membership_tier_snapshot', 'membership_number_snapshot', 'membership_id']) {
      const [rows] = await connection.query<any[]>(`SHOW COLUMNS FROM orders LIKE ?`, [column]);
      if (rows.length) await connection.query(`ALTER TABLE orders DROP COLUMN ${column}`);
    }
  },
};
