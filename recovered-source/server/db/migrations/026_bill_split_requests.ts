import { MigrationDefinition } from './types';

export const migration026BillSplitRequests: MigrationDefinition = {
  name: '026_bill_split_requests',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS bill_split_requests (
      organization_id BIGINT UNSIGNED NOT NULL,
      branch_id BIGINT UNSIGNED NOT NULL,
      idempotency_key VARCHAR(120) NOT NULL,
      request_hash CHAR(64) NOT NULL,
      order_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (organization_id, branch_id, idempotency_key),
      CONSTRAINT fk_split_request_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  },
  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS bill_split_requests');
  },
};
