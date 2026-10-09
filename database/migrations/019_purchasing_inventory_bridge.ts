import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration019PurchasingInventoryBridge: MigrationDefinition = {
  name: '019_purchasing_inventory_bridge',
  up: async (c: PoolConnection) => {
    await c.query(`ALTER TABLE inventory_movements MODIFY movement_type ENUM('OPENING','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT','COUNT_CORRECTION','PURCHASE_RECEIPT') NOT NULL`);
    await c.query(`CREATE TABLE IF NOT EXISTS purchase_order_sequences (organization_id BIGINT UNSIGNED NOT NULL, branch_id BIGINT UNSIGNED NOT NULL, next_number BIGINT UNSIGNED NOT NULL DEFAULT 1, PRIMARY KEY(organization_id,branch_id), CONSTRAINT fk_po_seq_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE, CONSTRAINT fk_po_seq_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  },
  down: async (c: PoolConnection) => { await c.query('DROP TABLE IF EXISTS purchase_order_sequences'); await c.query(`ALTER TABLE inventory_movements MODIFY movement_type ENUM('OPENING','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_IN','TRANSFER_OUT','COUNT_CORRECTION') NOT NULL`); }
};
