import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration052MenuComboComponents: MigrationDefinition = {
  name: '052_menu_combo_components',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS menu_combo_components (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        combo_menu_item_id BIGINT UNSIGNED NOT NULL,
        component_menu_item_id BIGINT UNSIGNED NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        display_order INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_combo_component (combo_menu_item_id, component_menu_item_id),
        INDEX idx_combo_components_org_combo (organization_id, combo_menu_item_id),
        INDEX idx_combo_components_component (component_menu_item_id),
        CONSTRAINT fk_combo_components_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_combo_components_combo FOREIGN KEY (combo_menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        CONSTRAINT fk_combo_components_component FOREIGN KEY (component_menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Nepal VAT is a fixed 13% in the active RMS tax model.
    // Normalize historical branch configuration while preserving registration state.
    await connection.query(`
      UPDATE branch_tax_configs
         SET vat_rate = CASE WHEN is_vat_registered = TRUE THEN 0.13 ELSE 0 END,
             updated_at = NOW()
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS menu_combo_components');
  },
};
