import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function columnExists(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration037PartialServiceItems: MigrationDefinition = {
  name: '037_partial_service_items',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      ALTER TABLE kitchen_ticket_items
      MODIFY COLUMN item_status ENUM('PENDING','PREPARING','READY','SERVED','CANCELLED') NOT NULL DEFAULT 'PENDING'
    `);

    if (!(await columnExists(connection, 'kitchen_ticket_items', 'served_at'))) {
      await connection.query(`ALTER TABLE kitchen_ticket_items ADD COLUMN served_at DATETIME NULL AFTER item_status`);
    }
    if (!(await columnExists(connection, 'kitchen_ticket_items', 'served_by'))) {
      await connection.query(`ALTER TABLE kitchen_ticket_items ADD COLUMN served_by BIGINT UNSIGNED NULL AFTER served_at`);
    }

    try {
      await connection.query(`
        ALTER TABLE kitchen_ticket_items
        ADD CONSTRAINT fk_kti_served_by FOREIGN KEY (served_by) REFERENCES users(id) ON DELETE SET NULL
      `);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }

    try {
      await connection.query(`CREATE INDEX idx_kti_service_ready ON kitchen_ticket_items (item_status, kitchen_ticket_id)`);
    } catch (error: any) {
      if (!/duplicate|already exists/i.test(String(error?.message || ''))) throw error;
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    try { await connection.query(`DROP INDEX idx_kti_service_ready ON kitchen_ticket_items`); } catch {}
    try { await connection.query(`ALTER TABLE kitchen_ticket_items DROP FOREIGN KEY fk_kti_served_by`); } catch {}

    // SERVED did not exist before this migration. Normalize it to READY before
    // shrinking the enum so rollback is deterministic under strict SQL modes.
    await connection.query(`UPDATE kitchen_ticket_items SET item_status = 'READY' WHERE item_status = 'SERVED'`);

    if (await columnExists(connection, 'kitchen_ticket_items', 'served_by')) {
      await connection.query(`ALTER TABLE kitchen_ticket_items DROP COLUMN served_by`);
    }
    if (await columnExists(connection, 'kitchen_ticket_items', 'served_at')) {
      await connection.query(`ALTER TABLE kitchen_ticket_items DROP COLUMN served_at`);
    }
    await connection.query(`
      ALTER TABLE kitchen_ticket_items
      MODIFY COLUMN item_status ENUM('PENDING','PREPARING','READY','CANCELLED') NOT NULL DEFAULT 'PENDING'
    `);
  },
};
