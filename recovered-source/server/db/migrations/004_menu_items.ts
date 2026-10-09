import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration004MenuItems: MigrationDefinition = {
  name: '004_menu_items',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        category_id BIGINT UNSIGNED NOT NULL,
        default_prep_station_id BIGINT UNSIGNED NULL,
        name VARCHAR(150) NOT NULL,
        sku VARCHAR(64) NULL,
        description TEXT NULL,
        entered_price DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        price_entry_mode ENUM('VAT_INCLUDED', 'VAT_EXCLUDED') NOT NULL DEFAULT 'VAT_INCLUDED',
        cost_price DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        image_url VARCHAR(255) NULL,
        is_available BOOLEAN NOT NULL DEFAULT TRUE,
        is_combo BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_item_sku (organization_id, sku),
        INDEX idx_items_org (organization_id),
        INDEX idx_items_category (category_id),
        INDEX idx_items_station (default_prep_station_id),
        CONSTRAINT fk_menu_items_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_menu_items_category FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE RESTRICT,
        CONSTRAINT fk_menu_items_station FOREIGN KEY (default_prep_station_id) REFERENCES preparation_stations(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
};
