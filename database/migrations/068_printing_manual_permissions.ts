import type { MigrationDefinition } from './types';

var PERMISSIONS = [
  ["printing:print", "printing", "Create manual durable KOT and receipt print jobs"],
  ["printing:reprint", "printing", "Create audited durable KOT and receipt reprint jobs"]
];
var ROLE_DEFAULTS = {
  FB_MANAGER: ["printing:print", "printing:reprint"],
  CASHIER: ["printing:print", "printing:reprint"],
  WAITER: ["printing:print"],
  CHEF: ["printing:print"]
};
export const migration068PrintingManualPermissions: MigrationDefinition = {
  name: "068_printing_manual_permissions",
  up: async (connection) => {
    for (const [code, module2, description] of PERMISSIONS) {
      await connection.query(
        `INSERT INTO permissions (code, module, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           module = VALUES(module),
           description = VALUES(description)`,
        [code, module2, description]
      );
    }
    const [permissionRows] = await connection.query(
      `SELECT id, code
         FROM permissions
        WHERE code IN ('printing:print', 'printing:reprint')`
    );
    const permissionIds = new Map(
      permissionRows.map((row) => [String(row.code), Number(row.id)])
    );
    const [roleRows] = await connection.query(
      `SELECT id, name
         FROM roles
        WHERE organization_id IS NULL
          AND name IN ('FB_MANAGER', 'CASHIER', 'WAITER', 'CHEF')`
    );
    for (const role of roleRows) {
      const codes = ROLE_DEFAULTS[String(role.name)] ?? [];
      for (const code of codes) {
        const permissionId = permissionIds.get(code);
        if (!permissionId) continue;
        await connection.query(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id)
           VALUES (?, ?)`,
          [Number(role.id), permissionId]
        );
      }
    }
  },
  down: async (connection) => {
    const [permissionRows] = await connection.query(
      `SELECT id
         FROM permissions
        WHERE code IN ('printing:print', 'printing:reprint')`
    );
    const ids = permissionRows.map((row) => Number(row.id));
    if (ids.length) {
      const placeholders3 = ids.map(() => "?").join(",");
      await connection.query(
        `DELETE FROM role_permissions
          WHERE permission_id IN (${placeholders3})`,
        ids
      );
      await connection.query(
        `DELETE FROM user_permissions
          WHERE permission_id IN (${placeholders3})`,
        ids
      );
      await connection.query(
        `DELETE FROM permissions
          WHERE id IN (${placeholders3})`,
        ids
      );
    }
  }
};
