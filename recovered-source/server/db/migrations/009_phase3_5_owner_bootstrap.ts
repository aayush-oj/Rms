import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration009OwnerBootstrap: MigrationDefinition = {
  name: '009_phase3_5_owner_bootstrap',
  up: async (connection: PoolConnection): Promise<void> => {
    // Add must_change_pin column to users table
    // Check if column already exists to make migration idempotent
    const [columns] = await connection.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_pin'`
    );
    if (columns[0].cnt === 0) {
      await connection.query(
        `ALTER TABLE users ADD COLUMN must_change_pin BOOLEAN NOT NULL DEFAULT FALSE`
      );
    }
  },

  down: async (connection: PoolConnection): Promise<void> => {
    const [columns] = await connection.query<any[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'must_change_pin'`
    );
    if (columns[0].cnt > 0) {
      await connection.query(`ALTER TABLE users DROP COLUMN must_change_pin`);
    }
  },
};
