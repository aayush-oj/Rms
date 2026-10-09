import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration049SimpleStockInventory: MigrationDefinition = {
  name: '049_simple_stock_inventory',
  async up(connection: PoolConnection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(150) NOT NULL,
        image_url VARCHAR(500) NULL,
        current_quantity BIGINT UNSIGNED NOT NULL DEFAULT 0,
        package_name VARCHAR(60) NULL,
        package_size INT UNSIGNED NULL,
        low_threshold BIGINT UNSIGNED NULL,
        critical_threshold BIGINT UNSIGNED NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT UNSIGNED NOT NULL,
        updated_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_stock_item_branch_name (organization_id, branch_id, name),
        INDEX idx_stock_item_branch_active (organization_id, branch_id, is_active),
        CONSTRAINT fk_stock_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_item_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_item_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_item_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT chk_stock_package CHECK (
          (package_name IS NULL AND package_size IS NULL)
          OR (package_name IS NOT NULL AND package_size IS NOT NULL AND package_size > 1)
        ),
        CONSTRAINT chk_stock_thresholds CHECK (
          critical_threshold IS NULL OR low_threshold IS NULL OR critical_threshold <= low_threshold
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_dependencies (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        stock_item_id BIGINT UNSIGNED NOT NULL,
        quantity_required INT UNSIGNED NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_stock_dependency (organization_id, branch_id, menu_item_id, stock_item_id),
        INDEX idx_stock_dependency_menu (organization_id, branch_id, menu_item_id),
        INDEX idx_stock_dependency_stock (organization_id, branch_id, stock_item_id),
        CONSTRAINT fk_stock_dep_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_dep_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_dep_menu FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_dep_item FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_dep_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT chk_stock_dep_quantity CHECK (quantity_required > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_movements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        stock_item_id BIGINT UNSIGNED NOT NULL,
        movement_type ENUM('STOCK_IN','SALE','CANCELLATION_RETURN','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT') NOT NULL,
        quantity_delta BIGINT NOT NULL,
        before_quantity BIGINT UNSIGNED NOT NULL,
        after_quantity BIGINT UNSIGNED NOT NULL,
        package_count INT UNSIGNED NULL,
        loose_count INT UNSIGNED NULL,
        reason VARCHAR(500) NULL,
        order_id BIGINT UNSIGNED NULL,
        order_item_id BIGINT UNSIGNED NULL,
        reference_type VARCHAR(60) NULL,
        reference_id BIGINT UNSIGNED NULL,
        reverses_movement_id BIGINT UNSIGNED NULL,
        performed_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_stock_movement_item (organization_id, branch_id, stock_item_id, created_at),
        INDEX idx_stock_movement_order (organization_id, branch_id, order_id, created_at),
        CONSTRAINT fk_stock_move_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_move_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_move_item FOREIGN KEY (stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_move_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_stock_move_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
        CONSTRAINT fk_stock_move_reverse FOREIGN KEY (reverses_movement_id) REFERENCES stock_movements(id) ON DELETE SET NULL,
        CONSTRAINT fk_stock_move_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        source_branch_id BIGINT UNSIGNED NOT NULL,
        destination_branch_id BIGINT UNSIGNED NOT NULL,
        source_stock_item_id BIGINT UNSIGNED NOT NULL,
        destination_stock_item_id BIGINT UNSIGNED NOT NULL,
        quantity BIGINT UNSIGNED NOT NULL,
        note VARCHAR(500) NULL,
        performed_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_stock_transfer_org (organization_id, created_at),
        CONSTRAINT fk_stock_transfer_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_stock_transfer_source_branch FOREIGN KEY (source_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_transfer_destination_branch FOREIGN KEY (destination_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_transfer_source_item FOREIGN KEY (source_stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_transfer_destination_item FOREIGN KEY (destination_stock_item_id) REFERENCES stock_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_stock_transfer_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT chk_stock_transfer_quantity CHECK (quantity > 0),
        CONSTRAINT chk_stock_transfer_branch CHECK (source_branch_id <> destination_branch_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const permissions = [
      ['inventory:view','inventory','View simple stock inventory'],
      ['inventory:items:manage','inventory','Manage stock items and menu stock dependencies'],
      ['inventory:adjust','inventory','Receive and adjust stock quantities'],
      ['inventory:history:view','inventory','View stock movement history'],
      ['inventory:transfer','inventory','Transfer stock between branches'],
    ];
    for (const permission of permissions) {
      await connection.query(
        `INSERT INTO permissions(code,module,description) VALUES(?,?,?)
         ON DUPLICATE KEY UPDATE description=VALUES(description)`,
        permission,
      );
    }

    const [roles]=await connection.query<RowDataPacket[]>(
      `SELECT id,name FROM roles WHERE organization_id IS NULL AND name='FB_MANAGER'`,
    );
    if(roles.length){
      const [perms]=await connection.query<RowDataPacket[]>(
        `SELECT id FROM permissions WHERE code IN ('inventory:view','inventory:items:manage','inventory:adjust','inventory:history:view','inventory:transfer')`,
      );
      for(const permission of perms){
        await connection.query(`INSERT IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)`,[roles[0].id,permission.id]);
      }
    }
  },
  async down(connection: PoolConnection) {
    await connection.query('DROP TABLE IF EXISTS stock_transfers');
    await connection.query('DROP TABLE IF EXISTS stock_movements');
    await connection.query('DROP TABLE IF EXISTS stock_dependencies');
    await connection.query('DROP TABLE IF EXISTS stock_items');
    await connection.query(`
      DELETE rp FROM role_permissions rp
      JOIN permissions p ON p.id=rp.permission_id
      WHERE p.code IN ('inventory:view','inventory:items:manage','inventory:adjust','inventory:history:view','inventory:transfer')
    `);
    await connection.query(`
      DELETE FROM permissions
      WHERE code IN ('inventory:view','inventory:items:manage','inventory:adjust','inventory:history:view','inventory:transfer')
    `);
  },
};
