import { MigrationDefinition } from './types';

export const migration041DomainAuditEvents: MigrationDefinition = {
  name: '041_domain_audit_events',
  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS domain_audit_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NULL,
        actor_user_id BIGINT UNSIGNED NOT NULL,
        actor_name VARCHAR(150) NOT NULL,
        actor_role VARCHAR(80) NOT NULL,
        action VARCHAR(80) NOT NULL,
        entity_type VARCHAR(80) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        related_entity_type VARCHAR(80) NULL,
        related_entity_id VARCHAR(100) NULL,
        before_json JSON NULL,
        after_json JSON NULL,
        metadata_json JSON NULL,
        reason VARCHAR(500) NULL,
        request_id VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_domain_audit_org_created (organization_id, created_at),
        INDEX idx_domain_audit_branch_created (branch_id, created_at),
        INDEX idx_domain_audit_actor_created (actor_user_id, created_at),
        INDEX idx_domain_audit_action_created (action, created_at),
        INDEX idx_domain_audit_entity (entity_type, entity_id, created_at),
        CONSTRAINT fk_domain_audit_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },
  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS domain_audit_events');
  },
};
