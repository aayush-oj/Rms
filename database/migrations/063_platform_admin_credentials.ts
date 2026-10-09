import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

export const migration063PlatformAdminCredentials: MigrationDefinition = {
  name: '063_platform_admin_credentials',

  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      ALTER TABLE platform_admins
        ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE AFTER password_hash;
    `);

    await connection.query(`
      CREATE TABLE platform_admin_password_reset_otps (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        platform_admin_id BIGINT UNSIGNED NOT NULL,
        email VARCHAR(254) NOT NULL,
        otp_hash CHAR(64) NOT NULL,
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_platform_admin_reset_admin (platform_admin_id, created_at),
        INDEX idx_platform_admin_reset_email (email, created_at),
        INDEX idx_platform_admin_reset_expiry (expires_at),
        CONSTRAINT fk_platform_admin_reset_admin
          FOREIGN KEY (platform_admin_id)
          REFERENCES platform_admins(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS platform_admin_password_reset_otps');
    await connection.query(
      'ALTER TABLE platform_admins DROP COLUMN must_change_password',
    );
  },
};
