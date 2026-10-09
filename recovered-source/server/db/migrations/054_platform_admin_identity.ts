import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration054PlatformAdminIdentity: MigrationDefinition = {
  name: '054_platform_admin_identity',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS platform_admins (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(254) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_login_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_platform_admin_email (email),
        INDEX idx_platform_admin_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS platform_admin_sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token_id VARCHAR(100) NOT NULL,
        platform_admin_id BIGINT UNSIGNED NOT NULL,
        is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME NULL,
        UNIQUE KEY uk_platform_admin_session_token (token_id),
        INDEX idx_platform_admin_sessions_admin (platform_admin_id),
        INDEX idx_platform_admin_sessions_expiry (expires_at),
        CONSTRAINT fk_platform_admin_sessions_admin
          FOREIGN KEY (platform_admin_id)
          REFERENCES platform_admins(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS platform_admin_sessions');
    await connection.query('DROP TABLE IF EXISTS platform_admins');
  },
};
