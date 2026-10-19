import type { MigrationDefinition } from './types';

export const migration070PrintJobRetryFailover: MigrationDefinition = {
  name: "070_print_job_retry_failover",
  up: async (connection) => {
    await connection.query(`
      ALTER TABLE print_jobs
        ADD COLUMN delivery_printer_id BIGINT UNSIGNED NULL AFTER printer_id,
        ADD COLUMN next_attempt_at DATETIME NULL AFTER max_attempts,
        ADD COLUMN failover_from_printer_id BIGINT UNSIGNED NULL AFTER next_attempt_at,
        ADD COLUMN failed_over_at DATETIME NULL AFTER failover_from_printer_id;
    `);
    await connection.query(`
      UPDATE print_jobs
         SET delivery_printer_id = printer_id
       WHERE delivery_printer_id IS NULL;
    `);
    await connection.query(`
      ALTER TABLE print_jobs
        ADD INDEX idx_print_jobs_retry (
          organization_id,
          branch_id,
          status,
          next_attempt_at,
          id
        ),
        ADD CONSTRAINT fk_print_jobs_delivery_printer
          FOREIGN KEY (delivery_printer_id)
          REFERENCES hardware_printers(id)
          ON DELETE SET NULL,
        ADD CONSTRAINT fk_print_jobs_failover_from_printer
          FOREIGN KEY (failover_from_printer_id)
          REFERENCES hardware_printers(id)
          ON DELETE SET NULL;
    `);
  },
  down: async (connection) => {
    await connection.query(`
      ALTER TABLE print_jobs
        DROP FOREIGN KEY fk_print_jobs_failover_from_printer,
        DROP FOREIGN KEY fk_print_jobs_delivery_printer,
        DROP INDEX idx_print_jobs_retry,
        DROP COLUMN failed_over_at,
        DROP COLUMN failover_from_printer_id,
        DROP COLUMN next_attempt_at,
        DROP COLUMN delivery_printer_id;
    `);
  }
};
