import { RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration028AccountRecoveryAndPhone: MigrationDefinition = {
  name: '028_account_recovery_and_phone',
  async up(connection) {
    const [phoneColumns] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'`
    );
    if (!phoneColumns.length) {
      await connection.query(`ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER email`);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS password_reset_otps (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL,
        email VARCHAR(150) NOT NULL,
        otp_hash CHAR(64) NOT NULL,
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_reset_user (user_id, created_at),
        INDEX idx_password_reset_email (email, created_at),
        INDEX idx_password_reset_expiry (expires_at),
        CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_password_reset_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },
  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS password_reset_otps');
    const [phoneColumns] = await connection.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'`
    );
    if (phoneColumns.length) await connection.query('ALTER TABLE users DROP COLUMN phone');
  },
};
