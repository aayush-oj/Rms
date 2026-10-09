import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration051OrderRounds: MigrationDefinition = {
  name: '051_order_rounds',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_rounds (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        round_number INT UNSIGNED NOT NULL,
        round_type ENUM('INITIAL','ADDITION') NOT NULL,
        status ENUM('ACTIVE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
        prior_order_status VARCHAR(20) NULL,
        prior_ready_at DATETIME NULL,
        prior_served_at DATETIME NULL,
        prior_served_by BIGINT UNSIGNED NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        cancelled_at DATETIME NULL,
        cancelled_by BIGINT UNSIGNED NULL,
        cancellation_reason VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_order_round_number (order_id, round_number),
        INDEX idx_order_round_scope (organization_id, branch_id, order_id, status),
        CONSTRAINT fk_order_round_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_round_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_order_round_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_round_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_order_round_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_order_round_prior_served_by FOREIGN KEY (prior_served_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    if (!(await columnExists(connection, 'order_items', 'order_round_id'))) {
      await connection.query(`ALTER TABLE order_items ADD COLUMN order_round_id BIGINT UNSIGNED NULL AFTER order_id`);
      await connection.query(`CREATE INDEX idx_order_items_round ON order_items(order_round_id)`);
    }
    if (!(await columnExists(connection, 'kitchen_tickets', 'order_round_id'))) {
      await connection.query(`ALTER TABLE kitchen_tickets ADD COLUMN order_round_id BIGINT UNSIGNED NULL AFTER order_id`);
      await connection.query(`CREATE INDEX idx_kitchen_tickets_round ON kitchen_tickets(order_round_id)`);
    }

    await connection.query(`
      INSERT INTO order_rounds
        (organization_id, branch_id, order_id, round_number, round_type, status,
         prior_order_status, prior_ready_at, prior_served_at, prior_served_by,
         created_by, cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at)
      SELECT o.organization_id, o.branch_id, o.id, 1, 'INITIAL',
             CASE WHEN o.order_status = 'CANCELLED' THEN 'CANCELLED' ELSE 'ACTIVE' END,
             NULL, NULL, NULL, NULL,
             o.created_by, o.cancelled_at, o.cancelled_by, o.cancellation_reason,
             o.created_at, o.updated_at
        FROM orders o
        LEFT JOIN order_rounds r ON r.order_id = o.id AND r.round_number = 1
       WHERE r.id IS NULL
    `);

    await connection.query(`
      UPDATE order_items oi
      JOIN order_rounds r ON r.order_id = oi.order_id AND r.round_number = 1
         SET oi.order_round_id = r.id
       WHERE oi.order_round_id IS NULL
    `);
    await connection.query(`
      UPDATE kitchen_tickets kt
      JOIN order_rounds r ON r.order_id = kt.order_id AND r.round_number = 1
         SET kt.order_round_id = r.id
       WHERE kt.order_round_id IS NULL
    `);

    await connection.query(`ALTER TABLE order_items MODIFY COLUMN order_round_id BIGINT UNSIGNED NOT NULL`);
    await connection.query(`ALTER TABLE kitchen_tickets MODIFY COLUMN order_round_id BIGINT UNSIGNED NOT NULL`);

    try {
      await connection.query(`
        ALTER TABLE order_items
        ADD CONSTRAINT fk_order_items_round FOREIGN KEY (order_round_id) REFERENCES order_rounds(id) ON DELETE RESTRICT
      `);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }
    try {
      await connection.query(`
        ALTER TABLE kitchen_tickets
        ADD CONSTRAINT fk_kitchen_tickets_round FOREIGN KEY (order_round_id) REFERENCES order_rounds(id) ON DELETE RESTRICT
      `);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    try { await connection.query(`ALTER TABLE kitchen_tickets DROP FOREIGN KEY fk_kitchen_tickets_round`); } catch {}
    try { await connection.query(`ALTER TABLE order_items DROP FOREIGN KEY fk_order_items_round`); } catch {}
    if (await columnExists(connection, 'kitchen_tickets', 'order_round_id')) {
      await connection.query(`ALTER TABLE kitchen_tickets DROP COLUMN order_round_id`);
    }
    if (await columnExists(connection, 'order_items', 'order_round_id')) {
      await connection.query(`ALTER TABLE order_items DROP COLUMN order_round_id`);
    }
    await connection.query('DROP TABLE IF EXISTS order_rounds');
  },
};
