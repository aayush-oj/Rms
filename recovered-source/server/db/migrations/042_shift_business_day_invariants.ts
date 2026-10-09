import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function triggerExists(connection: PoolConnection, name: string): Promise<boolean> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.triggers
      WHERE trigger_schema = DATABASE()
        AND trigger_name = ?`,
    [name]
  );
  return Number(rows[0]?.count || 0) > 0;
}

export const migration042ShiftBusinessDayInvariants: MigrationDefinition = {
  name: '042_shift_business_day_invariants',
  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await triggerExists(connection, 'trg_shifts_require_open_business_day'))) {
      await connection.query(`
        CREATE TRIGGER trg_shifts_require_open_business_day
        BEFORE INSERT ON shifts
        FOR EACH ROW
        BEGIN
          DECLARE business_day_status VARCHAR(16) DEFAULT NULL;
          DECLARE business_day_org BIGINT UNSIGNED DEFAULT NULL;
          DECLARE business_day_branch BIGINT UNSIGNED DEFAULT NULL;

          SELECT status, organization_id, branch_id
            INTO business_day_status, business_day_org, business_day_branch
            FROM business_days
           WHERE id = NEW.business_day_id
           FOR UPDATE;

          IF business_day_status IS NULL
             OR business_day_status <> 'OPEN'
             OR business_day_org <> NEW.organization_id
             OR business_day_branch <> NEW.branch_id THEN
            SIGNAL SQLSTATE '45000'
              SET MESSAGE_TEXT = 'SHIFT_REQUIRES_OPEN_SCOPED_BUSINESS_DAY';
          END IF;
        END
      `);
    }

    if (!(await triggerExists(connection, 'trg_business_day_close_blocks_open_shifts'))) {
      await connection.query(`
        CREATE TRIGGER trg_business_day_close_blocks_open_shifts
        BEFORE UPDATE ON business_days
        FOR EACH ROW
        BEGIN
          DECLARE open_shift_count INT DEFAULT 0;

          IF OLD.status = 'OPEN' AND NEW.status = 'CLOSED' THEN
            SELECT COUNT(*)
              INTO open_shift_count
              FROM shifts
             WHERE business_day_id = OLD.id
               AND organization_id = OLD.organization_id
               AND branch_id = OLD.branch_id
               AND status = 'OPEN';

            IF open_shift_count > 0 THEN
              SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'OPEN_SHIFTS_BLOCK_BUSINESS_DAY_CLOSE';
            END IF;
          END IF;
        END
      `);
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    if (await triggerExists(connection, 'trg_business_day_close_blocks_open_shifts')) {
      await connection.query('DROP TRIGGER trg_business_day_close_blocks_open_shifts');
    }
    if (await triggerExists(connection, 'trg_shifts_require_open_business_day')) {
      await connection.query('DROP TRIGGER trg_shifts_require_open_business_day');
    }
  },
};
