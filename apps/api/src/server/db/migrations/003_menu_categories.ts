import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration003MenuCategories: MigrationDefinition = {
  name: '003_menu_categories',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_categories (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        parent_id BIGINT UNSIGNED NULL,
        name VARCHAR(100) NOT NULL,
        station_id BIGINT UNSIGNED NULL,
        display_order INT NOT NULL DEFAULT 0,
        image_url VARCHAR(255) NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_category_name (organization_id, name),
        INDEX idx_categories_org (organization_id),
        INDEX idx_categories_parent (parent_id),
        CONSTRAINT fk_categories_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES menu_categories(id) ON DELETE SET NULL,
        CONSTRAINT fk_categories_station FOREIGN KEY (station_id) REFERENCES preparation_stations(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
};
