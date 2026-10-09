import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

export const migration060OrganizationActivationRequests: MigrationDefinition = {
  name: '060_organization_activation_requests',

  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS organization_activation_requests (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        requested_by_user_id BIGINT UNSIGNED NOT NULL,
        requester_name_snapshot VARCHAR(100) NOT NULL,
        requester_email_snapshot VARCHAR(150) NULL,
        requester_phone_snapshot VARCHAR(50) NULL,
        note VARCHAR(1000) NULL,
        status ENUM('OPEN', 'APPROVED', 'REJECTED', 'CANCELLED')
          NOT NULL DEFAULT 'OPEN',
        reviewed_by_platform_admin_id BIGINT UNSIGNED NULL,
        review_note VARCHAR(1000) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        open_organization_id BIGINT UNSIGNED
          GENERATED ALWAYS AS (
            CASE
              WHEN status = 'OPEN' THEN organization_id
              ELSE NULL
            END
          ) STORED,

        UNIQUE KEY uq_activation_request_one_open_org (open_organization_id),
        INDEX idx_activation_request_status_created (status, created_at),
        INDEX idx_activation_request_org_created (organization_id, created_at),
        INDEX idx_activation_request_requester (requested_by_user_id),
        INDEX idx_activation_request_reviewer (reviewed_by_platform_admin_id),

        CONSTRAINT fk_activation_request_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE RESTRICT,
        CONSTRAINT fk_activation_request_requester
          FOREIGN KEY (requested_by_user_id)
          REFERENCES users(id)
          ON DELETE RESTRICT,
        CONSTRAINT fk_activation_request_reviewer
          FOREIGN KEY (reviewed_by_platform_admin_id)
          REFERENCES platform_admins(id)
          ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query(
      'DROP TABLE IF EXISTS organization_activation_requests',
    );
  },
};
