import { MigrationDefinition } from './types';

export const migration027ActivityAuditLog: MigrationDefinition = {
  name: '027_activity_audit_log',
  async up(connection) {
    await connection.query(`CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id BIGINT UNSIGNED NOT NULL,
      branch_id BIGINT UNSIGNED NULL,
      actor_user_id BIGINT UNSIGNED NOT NULL,
      actor_name VARCHAR(150) NOT NULL,
      actor_role VARCHAR(80) NOT NULL,
      method VARCHAR(10) NOT NULL,
      action VARCHAR(80) NOT NULL,
      path VARCHAR(255) NOT NULL,
      entity_type VARCHAR(100) NULL,
      entity_id VARCHAR(100) NULL,
      changes_json JSON NULL,
      status_code INT NOT NULL,
      success BOOLEAN NOT NULL,
      ip_address VARCHAR(64) NULL,
      request_id VARCHAR(100) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_activity_org_created (organization_id, created_at),
      INDEX idx_activity_branch_created (branch_id, created_at),
      INDEX idx_activity_actor_created (actor_user_id, created_at),
      INDEX idx_activity_entity (entity_type, entity_id),
      CONSTRAINT fk_activity_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  },
  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS activity_logs');
  },
};
