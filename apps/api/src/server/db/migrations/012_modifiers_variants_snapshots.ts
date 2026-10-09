import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration012ModifiersVariantsSnapshots: MigrationDefinition = {
  name: '012_modifiers_variants_snapshots',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_item_variants (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        price DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        price_mode ENUM('OVERRIDE','ADDITIONAL') NOT NULL DEFAULT 'OVERRIDE',
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_variant_org_item_name (organization_id, menu_item_id, name),
        INDEX idx_variant_org_item (organization_id, menu_item_id, is_active, display_order),
        CONSTRAINT fk_variant_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_variant_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS modifier_groups (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        selection_mode ENUM('SINGLE','MULTI') NOT NULL DEFAULT 'SINGLE',
        min_selections INT UNSIGNED NOT NULL DEFAULT 0,
        max_selections INT UNSIGNED NOT NULL DEFAULT 1,
        pricing_strategy ENUM('NO_CHARGE','SHARED_PRICE','INDIVIDUAL') NOT NULL DEFAULT 'INDIVIDUAL',
        shared_price DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_modifier_group_org_name (organization_id, name),
        INDEX idx_modifier_group_org_active (organization_id, is_active, display_order),
        CONSTRAINT fk_modifier_groups_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS modifier_options (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        modifier_group_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        price_adjustment DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        display_order INT NOT NULL DEFAULT 0,
        allow_repeat BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_modifier_option_group_name (organization_id, modifier_group_id, name),
        INDEX idx_modifier_option_group (organization_id, modifier_group_id, is_active, display_order),
        CONSTRAINT fk_modifier_options_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_modifier_options_group FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_item_modifier_groups (
        organization_id BIGINT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        modifier_group_id BIGINT UNSIGNED NOT NULL,
        display_order INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (menu_item_id, modifier_group_id),
        INDEX idx_item_modifier_groups_org (organization_id, menu_item_id, display_order),
        CONSTRAINT fk_mimg_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_mimg_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_mimg_group FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    if (!(await columnExists(connection, 'orders', 'rounding_delta'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN rounding_delta DECIMAL(12,4) NOT NULL DEFAULT 0.0000`);
    }

    const additions: Array<[string, string]> = [
      ['variant_id', 'BIGINT UNSIGNED NULL'],
      ['variant_name_snapshot', 'VARCHAR(100) NULL'],
      ['base_unit_price_snapshot', 'DECIMAL(12,4) NOT NULL DEFAULT 0.0000'],
      ['modifier_total', 'DECIMAL(12,4) NOT NULL DEFAULT 0.0000'],
      ['modifier_snapshot_json', 'JSON NULL'],
    ];
    for (const [column, definition] of additions) {
      if (!(await columnExists(connection, 'order_items', column))) {
        await connection.query(`ALTER TABLE order_items ADD COLUMN ${column} ${definition}`);
      }
    }

    if (!(await columnExists(connection, 'kitchen_ticket_items', 'variant_name_snapshot'))) {
      await connection.query(`ALTER TABLE kitchen_ticket_items ADD COLUMN variant_name_snapshot VARCHAR(100) NULL`);
    }
    if (!(await columnExists(connection, 'kitchen_ticket_items', 'modifier_summary'))) {
      await connection.query(`ALTER TABLE kitchen_ticket_items ADD COLUMN modifier_summary TEXT NULL`);
    }

    if (!(await columnExists(connection, 'bill_lines', 'variant_name_snapshot'))) {
      await connection.query(`ALTER TABLE bill_lines ADD COLUMN variant_name_snapshot VARCHAR(100) NULL`);
    }
    if (!(await columnExists(connection, 'bill_lines', 'modifier_snapshot_json'))) {
      await connection.query(`ALTER TABLE bill_lines ADD COLUMN modifier_snapshot_json JSON NULL`);
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS menu_item_modifier_groups');
    await connection.query('DROP TABLE IF EXISTS modifier_options');
    await connection.query('DROP TABLE IF EXISTS modifier_groups');
    await connection.query('DROP TABLE IF EXISTS menu_item_variants');
    // Snapshot columns are intentionally left in place for production safety; rollback should not destroy historical facts.
  },
};
