import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration013TableOrderOperations: MigrationDefinition = {
  name: '013_table_order_operations',
  up: async (connection: PoolConnection): Promise<void> => {
    // MERGED is terminal and preserves the absorbed order's historical identity.
    await connection.query(`
      ALTER TABLE orders
      MODIFY COLUMN order_status ENUM('PLACED','PREPARING','READY','SERVED','COMPLETED','CANCELLED','MERGED') NOT NULL DEFAULT 'PLACED'
    `);

    const additions = [
      ['merged_into_order_id', 'BIGINT UNSIGNED NULL'],
      ['merged_at', 'DATETIME NULL'],
      ['merged_by', 'BIGINT UNSIGNED NULL'],
    ] as const;

    for (const [column, definition] of additions) {
      if (!(await columnExists(connection, 'orders', column))) {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`);
      }
    }

    await connection.query(`
      ALTER TABLE orders
      ADD CONSTRAINT fk_orders_merged_into
        FOREIGN KEY (merged_into_order_id) REFERENCES orders(id) ON DELETE RESTRICT
    `).catch((error: any) => {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    });

    await connection.query(`
      ALTER TABLE orders
      ADD CONSTRAINT fk_orders_merged_by
        FOREIGN KEY (merged_by) REFERENCES users(id) ON DELETE SET NULL
    `).catch((error: any) => {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    });

    await connection.query(`
      CREATE INDEX idx_orders_merged_into
      ON orders (organization_id, branch_id, merged_into_order_id)
    `).catch((error: any) => {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    });

    if (!(await columnExists(connection, 'order_items', 'origin_order_id'))) {
      await connection.query(`ALTER TABLE order_items ADD COLUMN origin_order_id BIGINT UNSIGNED NULL`);
    }

    await connection.query(`
      ALTER TABLE order_items
      ADD CONSTRAINT fk_order_items_origin_order
        FOREIGN KEY (origin_order_id) REFERENCES orders(id) ON DELETE RESTRICT
    `).catch((error: any) => {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    });

    await connection.query(`
      CREATE INDEX idx_order_items_origin_order
      ON order_items (origin_order_id)
    `).catch((error: any) => {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    });

    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_operation_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        operation_type ENUM('TRANSFER','SWAP','MERGE') NOT NULL,
        order_id BIGINT UNSIGNED NULL,
        related_order_id BIGINT UNSIGNED NULL,
        source_table_id BIGINT UNSIGNED NULL,
        destination_table_id BIGINT UNSIGNED NULL,
        performed_by BIGINT UNSIGNED NOT NULL,
        metadata_json JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_order_operation_org_branch_created (organization_id, branch_id, created_at),
        INDEX idx_order_operation_order (organization_id, branch_id, order_id),
        INDEX idx_order_operation_related_order (organization_id, branch_id, related_order_id),
        CONSTRAINT fk_order_operation_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_operation_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_order_operation_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_order_operation_related_order FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_order_operation_source_table FOREIGN KEY (source_table_id) REFERENCES dining_tables(id) ON DELETE SET NULL,
        CONSTRAINT fk_order_operation_destination_table FOREIGN KEY (destination_table_id) REFERENCES dining_tables(id) ON DELETE SET NULL,
        CONSTRAINT fk_order_operation_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS order_operation_events');
    await connection.query('ALTER TABLE order_items DROP FOREIGN KEY fk_order_items_origin_order').catch(() => undefined);
    await connection.query('ALTER TABLE order_items DROP INDEX idx_order_items_origin_order').catch(() => undefined);
    await connection.query('ALTER TABLE order_items DROP COLUMN origin_order_id').catch(() => undefined);
    await connection.query('ALTER TABLE orders DROP FOREIGN KEY fk_orders_merged_by').catch(() => undefined);
    await connection.query('ALTER TABLE orders DROP FOREIGN KEY fk_orders_merged_into').catch(() => undefined);
    await connection.query('ALTER TABLE orders DROP INDEX idx_orders_merged_into').catch(() => undefined);
    await connection.query('ALTER TABLE orders DROP COLUMN merged_by').catch(() => undefined);
    await connection.query('ALTER TABLE orders DROP COLUMN merged_at').catch(() => undefined);
    await connection.query('ALTER TABLE orders DROP COLUMN merged_into_order_id').catch(() => undefined);
    await connection.query(`
      ALTER TABLE orders
      MODIFY COLUMN order_status ENUM('PLACED','PREPARING','READY','SERVED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PLACED'
    `);
  },
};
