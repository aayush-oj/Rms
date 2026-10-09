import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

export const migration064PlatformAdminPasswordDefault: MigrationDefinition = {
  name: '064_platform_admin_password_default',

  up: async (connection: PoolConnection): Promise<void> => {
    // Existing Platform Admins already have permanent database credentials.
    // Only the environment bootstrap path explicitly marks a password temporary.
    await connection.query(
      'UPDATE platform_admins SET must_change_password = FALSE',
    );
    await connection.query(`
      ALTER TABLE platform_admins
        MODIFY COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      ALTER TABLE platform_admins
        MODIFY COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  },
};
