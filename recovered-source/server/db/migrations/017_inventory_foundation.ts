import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration017InventoryFoundation: MigrationDefinition = {
  name: '017_inventory_foundation',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_categories (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        code VARCHAR(50) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_inventory_category_branch_name (organization_id, branch_id, name),
        UNIQUE KEY uk_inventory_category_branch_code (organization_id, branch_id, code),
        INDEX idx_inventory_category_branch (organization_id, branch_id, is_active),
        CONSTRAINT fk_inventory_category_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_category_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_locations (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        code VARCHAR(50) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        notes VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_inventory_location_branch_name (organization_id, branch_id, name),
        UNIQUE KEY uk_inventory_location_branch_code (organization_id, branch_id, code),
        INDEX idx_inventory_location_branch (organization_id, branch_id, is_active),
        CONSTRAINT fk_inventory_location_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_location_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        category_id BIGINT UNSIGNED NULL,
        unit_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(180) NOT NULL,
        sku VARCHAR(80) NULL,
        cost_per_unit DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
        reorder_point DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
        reorder_quantity DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        notes VARCHAR(1000) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_inventory_item_branch_sku (organization_id, branch_id, sku),
        INDEX idx_inventory_item_branch (organization_id, branch_id, is_active),
        INDEX idx_inventory_item_category (organization_id, branch_id, category_id),
        CONSTRAINT fk_inventory_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_item_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_item_category FOREIGN KEY (category_id) REFERENCES inventory_categories(id) ON DELETE SET NULL,
        CONSTRAINT fk_inventory_item_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT chk_inventory_cost_nonnegative CHECK (cost_per_unit >= 0),
        CONSTRAINT chk_inventory_reorder_point_nonnegative CHECK (reorder_point >= 0),
        CONSTRAINT chk_inventory_reorder_quantity_nonnegative CHECK (reorder_quantity >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_balances (
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        current_quantity DECIMAL(18,4) NOT NULL DEFAULT 0.0000,
        opening_recorded BOOLEAN NOT NULL DEFAULT FALSE,
        version BIGINT UNSIGNED NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (inventory_item_id, location_id),
        INDEX idx_inventory_balance_branch (organization_id, branch_id, location_id, inventory_item_id),
        CONSTRAINT fk_inventory_balance_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_balance_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_balance_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_balance_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE CASCADE,
        CONSTRAINT chk_inventory_balance_nonnegative CHECK (current_quantity >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        movement_type ENUM('OPENING','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT','COUNT_CORRECTION','PURCHASE_RECEIPT') NOT NULL,
        quantity DECIMAL(18,4) NOT NULL,
        unit_id BIGINT UNSIGNED NOT NULL,
        before_quantity DECIMAL(18,4) NOT NULL,
        after_quantity DECIMAL(18,4) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        reference_type VARCHAR(50) NULL,
        reference_id BIGINT UNSIGNED NULL,
        performed_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inventory_movements_scope (organization_id, branch_id, inventory_item_id, location_id, created_at),
        INDEX idx_inventory_movements_type (organization_id, branch_id, movement_type, created_at),
        INDEX idx_inventory_movements_user (organization_id, branch_id, performed_by, created_at),
        CONSTRAINT fk_inventory_movement_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_movement_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movement_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movement_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movement_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_movement_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT chk_inventory_movement_quantity_positive CHECK (quantity > 0),
        CONSTRAINT chk_inventory_movement_after_nonnegative CHECK (after_quantity >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_counts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        status ENUM('DRAFT','CONFIRMED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        created_by BIGINT UNSIGNED NOT NULL,
        confirmed_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME NULL,
        notes VARCHAR(500) NULL,
        INDEX idx_inventory_counts_scope (organization_id, branch_id, location_id, status, created_at),
        CONSTRAINT fk_inventory_count_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_count_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_count_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_count_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_count_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_count_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        count_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        system_quantity DECIMAL(18,4) NOT NULL,
        counted_quantity DECIMAL(18,4) NOT NULL,
        variance_quantity DECIMAL(18,4) NOT NULL,
        unit_id BIGINT UNSIGNED NOT NULL,
        INDEX idx_inventory_count_items_count (count_id, inventory_item_id),
        UNIQUE KEY uk_inventory_count_item (count_id, inventory_item_id),
        CONSTRAINT fk_inventory_count_item_count FOREIGN KEY (count_id) REFERENCES inventory_counts(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_count_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_inventory_count_item_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_count_item_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_inventory_count_item_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT chk_inventory_count_counted_nonnegative CHECK (counted_quantity >= 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const units = [
      ['Gram', 'g', 'MASS', 'g', 1],
      ['Kilogram', 'kg', 'MASS', 'g', 1000],
      ['Milliliter', 'ml', 'VOLUME', 'ml', 1],
      ['Liter', 'L', 'VOLUME', 'ml', 1000],
      ['Piece', 'pcs', 'COUNT', 'pcs', 1],
    ];
    for (const [name, symbol, dimension, base, factor] of units) {
      await connection.query(
        `INSERT INTO units_of_measure (organization_id, name, symbol, dimension, base_unit_symbol, conversion_factor, is_active)
         SELECT NULL, ?, ?, ?, ?, ?, TRUE FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM units_of_measure WHERE organization_id IS NULL AND symbol = ? LIMIT 1)`,
        [name, symbol, dimension, base, factor, symbol]
      );
    }

    const permissions = [
      ['inventory:items:manage', 'inventory', 'Create, edit, activate and deactivate inventory items'],
      ['inventory:categories:manage', 'inventory', 'Manage branch inventory categories'],
      ['inventory:locations:manage', 'inventory', 'Manage branch inventory locations'],
      ['inventory:opening:manage', 'inventory', 'Record opening stock'],
      ['inventory:adjust', 'inventory', 'Adjust stock quantities'],
      ['inventory:count', 'inventory', 'Perform and confirm physical stock counts'],
      ['inventory:transfer', 'inventory', 'Transfer stock between locations'],
      ['inventory:history:view', 'inventory', 'View inventory movement history and stock details'],
    ];
    for (const [code, module, description] of permissions) {
      await connection.query(`INSERT INTO permissions (code, module, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)`, [code, module, description]);
    }

    const [manager] = await connection.query<any[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name = 'FB_MANAGER' LIMIT 1`);
    if (manager.length) {
      for (const [code] of permissions) {
        const [perm] = await connection.query<any[]>(`SELECT id FROM permissions WHERE code = ? LIMIT 1`, [code]);
        if (perm.length) await connection.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [manager[0].id, perm[0].id]);
      }
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS inventory_count_items');
    await connection.query('DROP TABLE IF EXISTS inventory_counts');
    await connection.query('DROP TABLE IF EXISTS inventory_movements');
    await connection.query('DROP TABLE IF EXISTS inventory_balances');
    await connection.query('DROP TABLE IF EXISTS inventory_items');
    await connection.query('DROP TABLE IF EXISTS inventory_locations');
    await connection.query('DROP TABLE IF EXISTS inventory_categories');
  },
};
