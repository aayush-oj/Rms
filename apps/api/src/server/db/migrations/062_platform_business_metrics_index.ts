import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

const INDEX_NAME = 'idx_bills_platform_business_metrics';

async function indexExists(
  connection: PoolConnection,
  name: string,
): Promise<boolean> {
  const [rows] = await connection.query<any[]>(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'bills'
        AND INDEX_NAME = ?
      LIMIT 1`,
    [name],
  );

  return rows.length > 0;
}

export const migration062PlatformBusinessMetricsIndex: MigrationDefinition = {
  name: '062_platform_business_metrics_index',

  up: async (connection: PoolConnection): Promise<void> => {
    if (await indexExists(connection, INDEX_NAME)) return;

    await connection.query(
      `ALTER TABLE bills
         ADD INDEX ${INDEX_NAME} (
           organization_id,
           status,
           business_date
         )`,
    );
  },

  down: async (connection: PoolConnection): Promise<void> => {
    if (!(await indexExists(connection, INDEX_NAME))) return;

    await connection.query(
      `ALTER TABLE bills
         DROP INDEX ${INDEX_NAME}`,
    );
  },
};
