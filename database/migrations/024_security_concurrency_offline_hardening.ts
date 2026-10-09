import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function hasColumn(c: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await c.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

async function hasIndex(c: PoolConnection, table: string, index: string): Promise<boolean> {
  const [rows] = await c.query<RowDataPacket[]>(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [index]);
  return rows.length > 0;
}

export const migration024SecurityConcurrencyOfflineHardening: MigrationDefinition = {
  name: '024_security_concurrency_offline_hardening',
  up: async (c) => {
    if (!(await hasColumn(c, 'orders', 'idempotency_key'))) {
      await c.query(`ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(120) NULL AFTER register_id`);
    }
    if (!(await hasColumn(c, 'orders', 'idempotency_hash'))) {
      await c.query(`ALTER TABLE orders ADD COLUMN idempotency_hash CHAR(64) NULL AFTER idempotency_key`);
    }
    if (!(await hasIndex(c, 'orders', 'uk_orders_idempotency'))) {
      await c.query(`ALTER TABLE orders ADD UNIQUE KEY uk_orders_idempotency (organization_id, branch_id, idempotency_key)`);
    }
    if (!(await hasColumn(c, 'payments', 'request_hash'))) {
      await c.query(`ALTER TABLE payments ADD COLUMN request_hash CHAR(64) NULL AFTER idempotency_key`);
    }
    if (!(await hasColumn(c, 'purchase_receipts', 'request_hash'))) {
      await c.query(`ALTER TABLE purchase_receipts ADD COLUMN request_hash CHAR(64) NULL AFTER idempotency_key`);
    }
    if (!(await hasIndex(c, 'sessions', 'idx_sessions_user_active'))) {
      await c.query(`ALTER TABLE sessions ADD INDEX idx_sessions_user_active (organization_id, user_id, is_revoked, expires_at)`);
    }
    if (!(await hasIndex(c, 'payments', 'idx_payments_bill_status'))) {
      await c.query(`ALTER TABLE payments ADD INDEX idx_payments_bill_status (organization_id, branch_id, bill_id, status, created_at)`);
    }
    if (!(await hasIndex(c, 'inventory_movements', 'idx_inventory_reference'))) {
      await c.query(`ALTER TABLE inventory_movements ADD INDEX idx_inventory_reference (organization_id, branch_id, reference_type, reference_id)`);
    }
  },
  down: async (c) => {
    if (await hasColumn(c, 'purchase_receipts', 'request_hash')) await c.query(`ALTER TABLE purchase_receipts DROP COLUMN request_hash`);
    if (await hasColumn(c, 'payments', 'request_hash')) await c.query(`ALTER TABLE payments DROP COLUMN request_hash`);
    if (await hasIndex(c, 'inventory_movements', 'idx_inventory_reference')) await c.query(`ALTER TABLE inventory_movements DROP INDEX idx_inventory_reference`);
    if (await hasIndex(c, 'payments', 'idx_payments_bill_status')) await c.query(`ALTER TABLE payments DROP INDEX idx_payments_bill_status`);
    if (await hasIndex(c, 'sessions', 'idx_sessions_user_active')) await c.query(`ALTER TABLE sessions DROP INDEX idx_sessions_user_active`);
    if (await hasIndex(c, 'orders', 'uk_orders_idempotency')) await c.query(`ALTER TABLE orders DROP INDEX uk_orders_idempotency`);
    if (await hasColumn(c, 'orders', 'idempotency_hash')) await c.query(`ALTER TABLE orders DROP COLUMN idempotency_hash`);
    if (await hasColumn(c, 'orders', 'idempotency_key')) await c.query(`ALTER TABLE orders DROP COLUMN idempotency_key`);
  },
};
