import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration034DineInAppendIdempotency: MigrationDefinition = {
  name: '034_dine_in_append_idempotency',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_amendment_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        operation_type ENUM('APPEND_ITEMS') NOT NULL,
        idempotency_key VARCHAR(120) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_order_amendment_idempotency (organization_id, branch_id, idempotency_key),
        INDEX idx_order_amendment_order (organization_id, branch_id, order_id, created_at),
        CONSTRAINT fk_order_amendment_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_amendment_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_order_amendment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_amendment_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS order_amendment_requests');
  },
};
