import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration039PermissionMatrixHardening: MigrationDefinition = {
  name: '039_permission_matrix_hardening',
  up: async (connection: PoolConnection): Promise<void> => {
    const permissions = [
      ['pos:billing:reverse', 'pos', 'Reverse captured payments as a controlled financial correction'],
      ['pos:orders:serve', 'pos', 'Mark ready dine-in orders as served'],
      ['pos:orders:complete', 'pos', 'Complete financially settled orders'],
    ] as const;

    for (const [code, module, description] of permissions) {
      await connection.query(
        `INSERT INTO permissions (code, module, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description)`,
        [code, module, description]
      );
    }

    const [roles] = await connection.execute<RowDataPacket[]>(
      `SELECT id, name
       FROM roles
       WHERE organization_id IS NULL
         AND name IN ('FB_MANAGER', 'CASHIER', 'WAITER')`
    );
    const roleIds = new Map(roles.map((row) => [String(row.name), Number(row.id)]));

    const [permissionRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, code
       FROM permissions
       WHERE code IN ('pos:billing:reverse', 'pos:orders:serve', 'pos:orders:complete')`
    );
    const permissionIds = new Map(permissionRows.map((row) => [String(row.code), Number(row.id)]));

    const grants: Array<[string, string]> = [
      ['FB_MANAGER', 'pos:billing:reverse'],
      ['FB_MANAGER', 'pos:orders:serve'],
      ['FB_MANAGER', 'pos:orders:complete'],
      ['WAITER', 'pos:orders:serve'],
      ['CASHIER', 'pos:orders:complete'],
    ];

    for (const [roleName, permissionCode] of grants) {
      const roleId = roleIds.get(roleName);
      const permissionId = permissionIds.get(permissionCode);
      if (!roleId || !permissionId) continue;
      await connection.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [roleId, permissionId]
      );
    }

    // Reversal is intentionally not part of the default CASHIER permission set.
    const cashierRoleId = roleIds.get('CASHIER');
    const reversePermissionId = permissionIds.get('pos:billing:reverse');
    if (cashierRoleId && reversePermissionId) {
      await connection.query(
        `DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
        [cashierRoleId, reversePermissionId]
      );
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    const [permissionRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM permissions WHERE code = 'pos:billing:reverse'`
    );
    if (permissionRows.length) {
      const permissionId = Number(permissionRows[0].id);
      await connection.query(`DELETE FROM role_permissions WHERE permission_id = ?`, [permissionId]);
      await connection.query(`DELETE FROM user_permission_overrides WHERE permission_id = ?`, [permissionId]);
      await connection.query(`DELETE FROM permissions WHERE id = ?`, [permissionId]);
    }
  },
};
