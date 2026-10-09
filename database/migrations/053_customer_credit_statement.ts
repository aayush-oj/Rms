import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function hasColumn(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

export const migration053CustomerCreditStatement: MigrationDefinition = {
  name: '053_customer_credit_statement',
  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await hasColumn(connection, 'customers', 'credit_limit'))) {
      await connection.query(
        `ALTER TABLE customers ADD COLUMN credit_limit DECIMAL(12,4) NOT NULL DEFAULT 0.0000 AFTER notes`
      );
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    if (await hasColumn(connection, 'customers', 'credit_limit')) {
      await connection.query('ALTER TABLE customers DROP COLUMN credit_limit');
    }
  },
};
