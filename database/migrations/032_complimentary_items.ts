import { MigrationDefinition } from './types';

export const migration032ComplimentaryItems: MigrationDefinition = {
  name: '032_complimentary_items',
  async up(connection) {
    await connection.query(`
      ALTER TABLE order_items
        ADD COLUMN is_complimentary BOOLEAN NOT NULL DEFAULT FALSE AFTER line_total,
        ADD COLUMN complimentary_reason VARCHAR(500) NULL AFTER is_complimentary,
        ADD COLUMN complimentary_by BIGINT UNSIGNED NULL AFTER complimentary_reason,
        ADD COLUMN original_unit_price DECIMAL(12,4) NOT NULL DEFAULT 0 AFTER complimentary_by,
        ADD INDEX idx_order_items_complimentary (is_complimentary, complimentary_by),
        ADD CONSTRAINT fk_order_items_complimentary_by FOREIGN KEY (complimentary_by) REFERENCES users(id) ON DELETE SET NULL;
    `);

    await connection.query(
      `INSERT INTO permissions (code, module, description)
       VALUES ('pos:complimentary:apply', 'pos', 'Mark ordered items as complimentary with a mandatory reason')
       ON DUPLICATE KEY UPDATE description = VALUES(description)`
    );

    const [roleRows] = await connection.query<any[]>(
      `SELECT id FROM roles WHERE organization_id IS NULL AND name = 'FB_MANAGER' LIMIT 1`
    );
    const [permissionRows] = await connection.query<any[]>(
      `SELECT id FROM permissions WHERE code = 'pos:complimentary:apply' LIMIT 1`
    );
    if (roleRows.length && permissionRows.length) {
      await connection.query(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
        [Number(roleRows[0].id), Number(permissionRows[0].id)]
      );
    }
  },
  async down(connection) {
    await connection.query(`
      ALTER TABLE order_items
        DROP FOREIGN KEY fk_order_items_complimentary_by,
        DROP INDEX idx_order_items_complimentary,
        DROP COLUMN original_unit_price,
        DROP COLUMN complimentary_by,
        DROP COLUMN complimentary_reason,
        DROP COLUMN is_complimentary;
    `);
    await connection.query(
      `DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'pos:complimentary:apply'`
    );
    await connection.query(`DELETE FROM permissions WHERE code = 'pos:complimentary:apply'`);
  },
};
