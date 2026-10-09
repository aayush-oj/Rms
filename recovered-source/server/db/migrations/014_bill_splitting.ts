import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function constraintExists(connection: PoolConnection, table: string, constraint: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    [table, constraint]
  );
  return Number(rows[0]?.count || 0) > 0;
}

async function indexExists(connection: PoolConnection, table: string, indexName: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration014BillSplitting: MigrationDefinition = {
  name: '014_bill_splitting',
  up: async (connection: PoolConnection): Promise<void> => {
    const orderItemSnapshots: Array<[string, string]> = [];
    for (const [column, definition] of orderItemSnapshots) {
      if (!(await columnExists(connection, 'order_items', column))) {
        await connection.query(`ALTER TABLE order_items ADD COLUMN ${column} ${definition}`);
      }
    }

    if (await indexExists(connection, 'bills', 'uk_bill_order')) {
      if (!(await indexExists(connection, 'bills', 'idx_bill_order'))) {
        await connection.query('CREATE INDEX idx_bill_order ON bills (organization_id, branch_id, order_id)');
      }
      await connection.query('ALTER TABLE bills DROP INDEX uk_bill_order');
    }

    const billColumns: Array<[string, string]> = [
      ['split_batch_id', 'BIGINT UNSIGNED NULL'],
      ['split_sequence', 'INT UNSIGNED NULL'],
      ['split_mode', "ENUM('ITEM','EVEN') NULL"],
      ['split_total_count', 'INT UNSIGNED NULL'],
    ];
    for (const [column, definition] of billColumns) {
      if (!(await columnExists(connection, 'bills', column))) {
        await connection.query(`ALTER TABLE bills ADD COLUMN ${column} ${definition}`);
      }
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bill_split_batches (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        split_mode ENUM('ITEM','EVEN') NOT NULL,
        status ENUM('ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
        source_currency VARCHAR(10) NOT NULL DEFAULT 'NPR',
        source_subtotal DECIMAL(12,4) NOT NULL,
        source_discount DECIMAL(12,4) NOT NULL,
        source_taxable_amount DECIMAL(12,4) NOT NULL,
        source_tax DECIMAL(12,4) NOT NULL,
        source_rounding_delta DECIMAL(12,4) NOT NULL,
        source_grand_total DECIMAL(12,4) NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_bill_split_batch_order (organization_id, branch_id, order_id),
        INDEX idx_bill_split_batch_org_branch (organization_id, branch_id, status),
        CONSTRAINT fk_bill_split_batch_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_bill_split_batch_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_bill_split_batch_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
        CONSTRAINT fk_bill_split_batch_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    if (!(await constraintExists(connection, 'bills', 'fk_bills_split_batch'))) {
      await connection.query(`
        ALTER TABLE bills
        ADD CONSTRAINT fk_bills_split_batch FOREIGN KEY (split_batch_id) REFERENCES bill_split_batches(id) ON DELETE RESTRICT
      `);
    }
    if (!(await indexExists(connection, 'bills', 'idx_bills_split_batch'))) {
      await connection.query(`CREATE INDEX idx_bills_split_batch ON bills (organization_id, branch_id, split_batch_id, split_sequence)`);
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('ALTER TABLE bills DROP FOREIGN KEY fk_bills_split_batch').catch(() => undefined);
    await connection.query('ALTER TABLE bills DROP INDEX idx_bills_split_batch').catch(() => undefined);
    await connection.query('ALTER TABLE bills DROP COLUMN split_total_count').catch(() => undefined);
    await connection.query('ALTER TABLE bills DROP COLUMN split_mode').catch(() => undefined);
    await connection.query('ALTER TABLE bills DROP COLUMN split_sequence').catch(() => undefined);
    await connection.query('ALTER TABLE bills DROP COLUMN split_batch_id').catch(() => undefined);
    await connection.query('DROP TABLE IF EXISTS bill_split_batches');
    await connection.query('ALTER TABLE bills ADD UNIQUE KEY uk_bill_order (organization_id, branch_id, order_id)').catch(() => undefined);
  },
};
