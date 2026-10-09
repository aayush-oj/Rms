import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

const SYSTEM_ROLE_NAMES = ['OWNER', 'FB_MANAGER', 'CASHIER', 'WAITER', 'CHEF'];

export const migration036DedupeSystemRoles: MigrationDefinition = {
  name: '036_dedupe_system_roles',
  up: async (connection: PoolConnection): Promise<void> => {
    for (const roleName of SYSTEM_ROLE_NAMES) {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id
         FROM roles
         WHERE organization_id IS NULL AND name = ?
         ORDER BY id ASC`,
        [roleName]
      );

      if (rows.length <= 1) continue;

      const canonicalRoleId = Number(rows[0].id);
      const duplicateRoleIds = rows.slice(1).map(row => Number(row.id));
      const placeholders = duplicateRoleIds.map(() => '?').join(', ');

      // Preserve every permission currently attached to any duplicate role.
      await connection.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT ?, permission_id
         FROM role_permissions
         WHERE role_id IN (${placeholders})`,
        [canonicalRoleId, ...duplicateRoleIds]
      );

      // Existing staff must continue to work; only their role FK changes.
      await connection.query(
        `UPDATE users
         SET role_id = ?
         WHERE role_id IN (${placeholders})`,
        [canonicalRoleId, ...duplicateRoleIds]
      );

      await connection.query(
        `DELETE FROM role_permissions
         WHERE role_id IN (${placeholders})`,
        duplicateRoleIds
      );

      await connection.query(
        `DELETE FROM roles
         WHERE id IN (${placeholders})`,
        duplicateRoleIds
      );
    }

    // MySQL UNIQUE(organization_id, name) allows repeated NULL organization IDs.
    // A generated scope converts NULL (global/system role) to 0 so global names
    // are truly unique while organization-specific role names remain tenant-scoped.
    const [columnRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND COLUMN_NAME = 'organization_scope_id'`
    );

    if (Number(columnRows[0].cnt) === 0) {
      await connection.query(`
        ALTER TABLE roles
        ADD COLUMN organization_scope_id BIGINT UNSIGNED
          GENERATED ALWAYS AS (IFNULL(organization_id, 0)) STORED
      `);
    }

    const [indexRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND INDEX_NAME = 'uk_role_scope_name'`
    );

    if (Number(indexRows[0].cnt) === 0) {
      await connection.query(`
        ALTER TABLE roles
        ADD UNIQUE KEY uk_role_scope_name (organization_scope_id, name)
      `);
    }

    // Final invariant: exactly one global row per supported system role.
    const [duplicates] = await connection.execute<RowDataPacket[]>(
      `SELECT name, COUNT(*) AS cnt
       FROM roles
       WHERE organization_id IS NULL
         AND name IN ('OWNER', 'FB_MANAGER', 'CASHIER', 'WAITER', 'CHEF')
       GROUP BY name
       HAVING COUNT(*) > 1`
    );

    if (duplicates.length > 0) {
      throw new Error(`Migration 036 failed: duplicate system roles remain: ${duplicates.map(row => `${row.name} (${row.cnt})`).join(', ')}`);
    }
  },

  down: async (connection: PoolConnection): Promise<void> => {
    const [indexRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND INDEX_NAME = 'uk_role_scope_name'`
    );
    if (Number(indexRows[0].cnt) > 0) {
      await connection.query('ALTER TABLE roles DROP INDEX uk_role_scope_name');
    }

    const [columnRows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND COLUMN_NAME = 'organization_scope_id'`
    );
    if (Number(columnRows[0].cnt) > 0) {
      await connection.query('ALTER TABLE roles DROP COLUMN organization_scope_id');
    }
  },
};
