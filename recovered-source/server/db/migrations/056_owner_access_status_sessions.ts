import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

/**
 * Restricted owner authentication realm for organizations that cannot operate.
 *
 * These sessions are deliberately stored outside the operational `sessions`
 * table so Phase 4B organization-wide STAFF/ACCOUNT revocation cannot destroy
 * the owner's ability to view access status and later request reactivation.
 */
export const migration056OwnerAccessStatusSessions: MigrationDefinition = {
  name: '056_owner_access_status_sessions',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS organization_access_status_sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token_id CHAR(36) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME NULL,
        UNIQUE KEY uk_access_status_token (token_id),
        INDEX idx_access_status_org_active (organization_id, is_revoked, expires_at),
        INDEX idx_access_status_user_active (user_id, is_revoked, expires_at),
        CONSTRAINT fk_access_status_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_access_status_org
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS organization_access_status_sessions');
  },
};
