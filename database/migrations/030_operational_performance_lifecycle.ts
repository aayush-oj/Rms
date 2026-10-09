import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function hasColumn(connection: PoolConnection, table: string, column: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration030OperationalPerformanceLifecycle: MigrationDefinition = {
  name: '030_operational_performance_lifecycle',
  async up(connection) {
    const additions = [
      ['preparing_at', 'DATETIME NULL'],
      ['ready_at', 'DATETIME NULL'],
      ['department_id_snapshot', 'BIGINT UNSIGNED NULL'],
      ['department_name_snapshot', 'VARCHAR(100) NULL'],
    ] as const;
    for (const [column, definition] of additions) {
      if (!(await hasColumn(connection, 'kitchen_ticket_items', column))) {
        await connection.query(`ALTER TABLE kitchen_ticket_items ADD COLUMN ${column} ${definition}`);
      }
    }

    await connection.query('DROP TRIGGER IF EXISTS trg_kti_performance_insert');
    await connection.query(`
      CREATE TRIGGER trg_kti_performance_insert BEFORE INSERT ON kitchen_ticket_items
      FOR EACH ROW
      BEGIN
        DECLARE dep_id BIGINT UNSIGNED DEFAULT NULL;
        DECLARE dep_name VARCHAR(100) DEFAULT NULL;
        SELECT mi.department_id, d.name INTO dep_id, dep_name
        FROM menu_items mi
        LEFT JOIN departments d ON d.id = mi.department_id AND d.organization_id = mi.organization_id
        WHERE mi.id = NEW.menu_item_id
        LIMIT 1;
        SET NEW.department_id_snapshot = dep_id;
        SET NEW.department_name_snapshot = dep_name;
      END
    `);

    await connection.query('DROP TRIGGER IF EXISTS trg_kti_performance_update');
    await connection.query(`
      CREATE TRIGGER trg_kti_performance_update BEFORE UPDATE ON kitchen_ticket_items
      FOR EACH ROW
      BEGIN
        IF OLD.item_status <> 'PREPARING' AND NEW.item_status = 'PREPARING' AND NEW.preparing_at IS NULL THEN
          SET NEW.preparing_at = NOW();
        END IF;
        IF OLD.item_status <> 'READY' AND NEW.item_status = 'READY' AND NEW.ready_at IS NULL THEN
          SET NEW.ready_at = NOW();
        END IF;
      END
    `);

    await connection.query('CREATE INDEX idx_kti_performance_ready ON kitchen_ticket_items (ready_at, department_id_snapshot, menu_item_id)');
  },
  async down(connection) {
    await connection.query('DROP TRIGGER IF EXISTS trg_kti_performance_update');
    await connection.query('DROP TRIGGER IF EXISTS trg_kti_performance_insert');
    try { await connection.query('DROP INDEX idx_kti_performance_ready ON kitchen_ticket_items'); } catch {}
    for (const column of ['department_name_snapshot','department_id_snapshot','ready_at','preparing_at']) {
      if (await hasColumn(connection, 'kitchen_ticket_items', column)) {
        await connection.query(`ALTER TABLE kitchen_ticket_items DROP COLUMN ${column}`);
      }
    }
  },
};
