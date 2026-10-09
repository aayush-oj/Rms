import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration011ServiceLifecycle: MigrationDefinition = {
  name: '011_service_lifecycle',
  up: async (connection: PoolConnection): Promise<void> => {
    const additions = [
      ['ready_at', 'DATETIME NULL'],
      ['served_at', 'DATETIME NULL'],
      ['served_by', 'BIGINT UNSIGNED NULL'],
      ['completed_at', 'DATETIME NULL'],
      ['completed_by', 'BIGINT UNSIGNED NULL'],
    ] as const;

    for (const [column, definition] of additions) {
      if (!(await columnExists(connection, 'orders', column))) {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
      }
    }

    try {
      await connection.query(`
        ALTER TABLE orders
          ADD CONSTRAINT fk_orders_served_by FOREIGN KEY (served_by) REFERENCES users(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }

    try {
      await connection.query(`
        ALTER TABLE orders
          ADD CONSTRAINT fk_orders_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }

    try {
      await connection.query(`
        CREATE INDEX idx_orders_service_lifecycle
        ON orders (organization_id, branch_id, order_status, payment_status, dining_table_id)
      `);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }

    const permissions = [
      ['pos:orders:serve', 'pos', 'Mark ready dine-in orders as served'],
      ['pos:orders:complete', 'pos', 'Complete financially settled orders'],
    ] as const;

    for (const [code, module, description] of permissions) {
      await connection.query(
        `INSERT INTO permissions (code, module, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [code, module, description]
      );
    }

    const [roleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, name FROM roles WHERE organization_id IS NULL AND name IN ('FB_MANAGER', 'WAITER', 'CASHIER')`
    );
    const roleIds = new Map(roleRows.map((row) => [String(row.name), Number(row.id)]));
    const [permRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, code FROM permissions WHERE code IN ('pos:orders:serve', 'pos:orders:complete')`
    );
    const permIds = new Map(permRows.map((row) => [String(row.code), Number(row.id)]));

    const mappings: Array<[string, string]> = [
      ['FB_MANAGER', 'pos:orders:serve'],
      ['WAITER', 'pos:orders:serve'],
      ['FB_MANAGER', 'pos:orders:complete'],
      ['CASHIER', 'pos:orders:complete'],
    ];

    for (const [roleName, permissionCode] of mappings) {
      const roleId = roleIds.get(roleName);
      const permissionId = permIds.get(permissionCode);
      if (!roleId || !permissionId) continue;
      await connection.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleId, permissionId]
      );
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      ALTER TABLE orders
        DROP FOREIGN KEY fk_orders_completed_by,
        DROP FOREIGN KEY fk_orders_served_by
    `);
    await connection.query(`ALTER TABLE orders
      DROP COLUMN completed_by,
      DROP COLUMN completed_at,
      DROP COLUMN served_by,
      DROP COLUMN served_at,
      DROP COLUMN ready_at`);
    await connection.query(`DROP INDEX idx_orders_service_lifecycle ON orders`);
    await connection.query(`DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code IN ('pos:orders:serve','pos:orders:complete')`);
    await connection.query(`DELETE FROM permissions WHERE code IN ('pos:orders:serve','pos:orders:complete')`);
  },
};
