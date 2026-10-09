import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

export const migration059LifecycleAutomationAttention: MigrationDefinition = {
  name: '059_lifecycle_automation_attention',

  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS lifecycle_automation_attention (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        automation_kind VARCHAR(50) NOT NULL,
        first_failed_at DATETIME NOT NULL,
        last_failed_at DATETIME NOT NULL,
        failure_count INT UNSIGNED NOT NULL DEFAULT 1,
        last_due_at DATETIME NOT NULL,
        last_entitlement_version INT UNSIGNED NOT NULL,
        last_error_code VARCHAR(100) NOT NULL,
        last_error_summary VARCHAR(500) NOT NULL,
        resolved_at DATETIME NULL,
        resolution_reason VARCHAR(100) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uq_lifecycle_automation_attention_org_kind (
          organization_id,
          automation_kind
        ),
        INDEX idx_lifecycle_automation_attention_active (
          resolved_at,
          last_failed_at
        ),
        INDEX idx_lifecycle_automation_attention_org (
          organization_id,
          resolved_at
        ),

        CONSTRAINT fk_lifecycle_automation_attention_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query(
      'DROP TABLE IF EXISTS lifecycle_automation_attention',
    );
  },
};
