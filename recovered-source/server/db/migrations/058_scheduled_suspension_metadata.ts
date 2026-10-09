import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

export const migration058ScheduledSuspensionMetadata: MigrationDefinition = {
  name: '058_scheduled_suspension_metadata',

  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      ALTER TABLE organization_entitlements
        ADD COLUMN scheduled_suspension_reason VARCHAR(500) NULL
          AFTER scheduled_suspension_at,
        ADD COLUMN scheduled_suspension_customer_message TEXT NULL
          AFTER scheduled_suspension_reason;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      ALTER TABLE organization_entitlements
        DROP COLUMN scheduled_suspension_customer_message,
        DROP COLUMN scheduled_suspension_reason;
    `);
  },
};
