import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

export const migration057PlatformAuditLogs: MigrationDefinition = {
  name: '057_platform_audit_logs',

  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS platform_audit_logs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        platform_admin_id BIGINT UNSIGNED NULL,
        organization_id BIGINT UNSIGNED NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(100) NOT NULL,
        target_id VARCHAR(100) NULL,
        before_json JSON NULL,
        after_json JSON NULL,
        reason VARCHAR(500) NULL,
        ip_address VARCHAR(64) NULL,
        user_agent VARCHAR(512) NULL,
        request_id VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        INDEX idx_platform_audit_org_created (
          organization_id,
          created_at
        ),
        INDEX idx_platform_audit_admin_created (
          platform_admin_id,
          created_at
        ),
        INDEX idx_platform_audit_action_created (
          action,
          created_at
        ),

        CONSTRAINT fk_platform_audit_admin
          FOREIGN KEY (platform_admin_id)
          REFERENCES platform_admins(id)
          ON DELETE SET NULL,

        CONSTRAINT fk_platform_audit_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS platform_audit_logs');
  },
};
