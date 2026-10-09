import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

/**
 * Migration 035: Operational role permission cleanup
 *
 * The operational UI is now role-first (Work Home -> task workspace). The legacy
 * dashboard:view mapping made WAITER/CASHIER/CHEF look like management users in
 * the frontend even though they should stay inside their operational workspaces.
 *
 * This migration:
 * - removes dashboard:view from the default WAITER/CASHIER/CHEF role mappings
 * - explicitly preserves WAITER -> pos:orders:serve
 *
 * It intentionally does NOT grant waiters billing, order completion, or void
 * authority. Those remain manager/cashier or explicit per-user overrides.
 */
export const migration035OperationalRolePermissionCleanup: MigrationDefinition = {
  name: '035_operational_role_permission_cleanup',
  up: async (connection: PoolConnection): Promise<void> => {
    const [roles] = await connection.execute<RowDataPacket[]>(
      `SELECT id, name
       FROM roles
       WHERE organization_id IS NULL
         AND name IN ('WAITER', 'CASHIER', 'CHEF')`
    );
    const roleIds = new Map(roles.map((row) => [String(row.name), Number(row.id)]));

    const [permissions] = await connection.execute<RowDataPacket[]>(
      `SELECT id, code
       FROM permissions
       WHERE code IN ('dashboard:view', 'pos:orders:serve')`
    );
    const permissionIds = new Map(permissions.map((row) => [String(row.code), Number(row.id)]));

    const dashboardPermissionId = permissionIds.get('dashboard:view');
    if (dashboardPermissionId) {
      for (const roleName of ['WAITER', 'CASHIER', 'CHEF']) {
        const roleId = roleIds.get(roleName);
        if (!roleId) continue;
        await connection.query(
          `DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
          [roleId, dashboardPermissionId]
        );
      }
    }

    const waiterRoleId = roleIds.get('WAITER');
    const servePermissionId = permissionIds.get('pos:orders:serve');
    if (waiterRoleId && servePermissionId) {
      await connection.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [waiterRoleId, servePermissionId]
      );
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    const [roles] = await connection.execute<RowDataPacket[]>(
      `SELECT id, name
       FROM roles
       WHERE organization_id IS NULL
         AND name IN ('WAITER', 'CASHIER', 'CHEF')`
    );
    const roleIds = new Map(roles.map((row) => [String(row.name), Number(row.id)]));

    const [permissions] = await connection.execute<RowDataPacket[]>(
      `SELECT id, code
       FROM permissions
       WHERE code IN ('dashboard:view', 'pos:orders:serve')`
    );
    const permissionIds = new Map(permissions.map((row) => [String(row.code), Number(row.id)]));

    const dashboardPermissionId = permissionIds.get('dashboard:view');
    if (dashboardPermissionId) {
      for (const roleName of ['WAITER', 'CASHIER', 'CHEF']) {
        const roleId = roleIds.get(roleName);
        if (!roleId) continue;
        await connection.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
          [roleId, dashboardPermissionId]
        );
      }
    }

    // Keep pos:orders:serve intact on rollback because migration 011 owns that mapping.
  },
};
