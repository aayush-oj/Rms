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

export const migration020RecipesFoodCosting: MigrationDefinition = {
  name: '020_recipes_food_costing',
  up: async (connection: PoolConnection): Promise<void> => {
    // Extend the authoritative inventory ledger rather than creating a second stock ledger.
    await connection.query(`
      ALTER TABLE inventory_movements
      MODIFY movement_type ENUM(
        'OPENING','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT',
        'COUNT_CORRECTION','PURCHASE_RECEIPT','SALE_CONSUMPTION','SALE_CONSUMPTION_REVERSAL'
      ) NOT NULL
    `);

    if (!(await columnExists(connection, 'menu_items', 'item_classification'))) {
      await connection.query(`
        ALTER TABLE menu_items
        ADD COLUMN item_classification ENUM('FOOD','BEVERAGE','OTHER') NOT NULL DEFAULT 'OTHER'
        AFTER is_combo
      `);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS recipes (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(180) NOT NULL,
        description TEXT NULL,
        status ENUM('DRAFT','ACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
        active_version_id BIGINT UNSIGNED NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_recipe_branch_menu_item (organization_id, branch_id, menu_item_id),
        INDEX idx_recipe_scope (organization_id, branch_id, status, menu_item_id),
        CONSTRAINT fk_recipe_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_recipe_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS recipe_versions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        recipe_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        version_number INT UNSIGNED NOT NULL,
        status ENUM('DRAFT','ACTIVE','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
        yield_quantity DECIMAL(18,6) NOT NULL DEFAULT 1.000000,
        yield_unit_id BIGINT UNSIGNED NOT NULL,
        effective_from DATETIME NULL,
        notes TEXT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        activated_at DATETIME NULL,
        UNIQUE KEY uk_recipe_version_number (recipe_id, version_number),
        INDEX idx_recipe_versions_scope (organization_id, branch_id, recipe_id, status),
        INDEX idx_recipe_versions_effective (recipe_id, effective_from),
        CONSTRAINT fk_recipe_version_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_version_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_recipe_version_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_version_yield_unit FOREIGN KEY (yield_unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_version_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT chk_recipe_version_yield CHECK (yield_quantity > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS recipe_version_ingredients (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        recipe_version_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        quantity DECIMAL(18,6) NOT NULL,
        unit_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_recipe_version_ingredient (recipe_version_id, inventory_item_id, location_id),
        INDEX idx_recipe_ingredient_inventory (organization_id, branch_id, inventory_item_id),
        CONSTRAINT fk_recipe_ing_version FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE CASCADE,
        CONSTRAINT fk_recipe_ing_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_recipe_ing_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_ing_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_ing_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_ing_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT chk_recipe_ing_quantity CHECK (quantity > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Explicit modifier and variant ingredient impacts. Display names never become business identifiers.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS modifier_option_ingredient_impacts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        modifier_option_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        quantity_delta DECIMAL(18,6) NOT NULL,
        unit_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_modifier_ingredient_impact (branch_id, modifier_option_id, inventory_item_id, location_id),
        CONSTRAINT fk_mod_ing_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_mod_ing_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mod_ing_option FOREIGN KEY (modifier_option_id) REFERENCES modifier_options(id) ON DELETE CASCADE,
        CONSTRAINT fk_mod_ing_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mod_ing_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mod_ing_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT chk_mod_ing_nonzero CHECK (quantity_delta <> 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS variant_ingredient_impacts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        variant_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        quantity_delta DECIMAL(18,6) NOT NULL,
        unit_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_variant_ingredient_impact (branch_id, variant_id, inventory_item_id, location_id),
        CONSTRAINT fk_variant_ing_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_variant_ing_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_variant_ing_variant FOREIGN KEY (variant_id) REFERENCES menu_item_variants(id) ON DELETE CASCADE,
        CONSTRAINT fk_variant_ing_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_variant_ing_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_variant_ing_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT chk_variant_ing_nonzero CHECK (quantity_delta <> 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Packaged goods can consume stock directly without forcing a fake recipe.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_item_stock_links (
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        inventory_item_id BIGINT UNSIGNED NOT NULL,
        location_id BIGINT UNSIGNED NOT NULL,
        quantity_per_sale DECIMAL(18,6) NOT NULL DEFAULT 1.000000,
        unit_id BIGINT UNSIGNED NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (branch_id, menu_item_id),
        CONSTRAINT fk_stock_link_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_link_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_link_menu FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_link_item FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_link_location FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_link_unit FOREIGN KEY (unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
        CONSTRAINT chk_stock_link_quantity CHECK (quantity_per_sale > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_item_recipe_snapshots (
        order_item_id BIGINT UNSIGNED PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        recipe_id BIGINT UNSIGNED NULL,
        recipe_version_id BIGINT UNSIGNED NULL,
        consumption_mode ENUM('RECIPE','DIRECT_STOCK') NOT NULL,
        recipe_cost_per_portion DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
        total_cost_snapshot DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
        expected_ingredients_json JSON NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recipe_snapshot_order (organization_id, branch_id, order_id),
        CONSTRAINT fk_recipe_snapshot_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_snapshot_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_snapshot_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_recipe_snapshot_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_recipe_snapshot_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL,
        CONSTRAINT fk_recipe_snapshot_version FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS inventory_consumption_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        order_item_id BIGINT UNSIGNED NOT NULL,
        recipe_version_id BIGINT UNSIGNED NULL,
        status ENUM('CONSUMED','REVERSED') NOT NULL DEFAULT 'CONSUMED',
        consumed_by BIGINT UNSIGNED NOT NULL,
        consumed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reversed_by BIGINT UNSIGNED NULL,
        reversed_at DATETIME NULL,
        reversal_reason VARCHAR(500) NULL,
        UNIQUE KEY uk_consumption_order_item (order_item_id),
        INDEX idx_consumption_order (organization_id, branch_id, order_id, status),
        CONSTRAINT fk_consumption_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_consumption_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_consumption_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
        CONSTRAINT fk_consumption_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_consumption_recipe_version FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE SET NULL,
        CONSTRAINT fk_consumption_actor FOREIGN KEY (consumed_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_consumption_reversal_actor FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Link the active version only after recipe_versions exists, avoiding a circular create-table dependency.
    try {
      await connection.query(`
        ALTER TABLE recipes
        ADD CONSTRAINT fk_recipe_active_version FOREIGN KEY (active_version_id) REFERENCES recipe_versions(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      if (String(error?.code) !== 'ER_DUP_KEYNAME' && String(error?.code) !== 'ER_FK_DUP_NAME') throw error;
    }

    const permissions: Array<[string, string, string]> = [
      ['recipe:view', 'recipes', 'View recipes'],
      ['recipe:create', 'recipes', 'Create recipes'],
      ['recipe:update', 'recipes', 'Edit draft recipe versions and ingredient mappings'],
      ['recipe:activate', 'recipes', 'Activate recipe versions'],
      ['recipe:archive', 'recipes', 'Archive recipes'],
      ['recipe:view_cost', 'recipes', 'View recipe cost, food cost and gross margin'],
    ];
    for (const permission of permissions) {
      await connection.query(
        `INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        permission
      );
    }

    const [managerRoles] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM roles WHERE organization_id IS NULL AND name = 'FB_MANAGER' LIMIT 1`
    );
    if (managerRoles.length) {
      for (const [code] of permissions) {
        const [permissionRows] = await connection.query<RowDataPacket[]>(
          `SELECT id FROM permissions WHERE code = ? LIMIT 1`,
          [code]
        );
        if (permissionRows.length) {
          await connection.query(
            `INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
            [managerRoles[0].id, permissionRows[0].id]
          );
        }
      }
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    try { await connection.query('ALTER TABLE recipes DROP FOREIGN KEY fk_recipe_active_version'); } catch {}
    await connection.query('DROP TABLE IF EXISTS inventory_consumption_events');
    await connection.query('DROP TABLE IF EXISTS order_item_recipe_snapshots');
    await connection.query('DROP TABLE IF EXISTS menu_item_stock_links');
    await connection.query('DROP TABLE IF EXISTS variant_ingredient_impacts');
    await connection.query('DROP TABLE IF EXISTS modifier_option_ingredient_impacts');
    await connection.query('DROP TABLE IF EXISTS recipe_version_ingredients');
    await connection.query('DROP TABLE IF EXISTS recipe_versions');
    await connection.query('DROP TABLE IF EXISTS recipes');
    await connection.query(`
      ALTER TABLE inventory_movements
      MODIFY movement_type ENUM('OPENING','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT','COUNT_CORRECTION','PURCHASE_RECEIPT') NOT NULL
    `);
    // item_classification is intentionally retained on rollback because removing a populated classification can destroy data.
  },
};
