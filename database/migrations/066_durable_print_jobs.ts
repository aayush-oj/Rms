import type { MigrationDefinition } from './types';

export const migration066DurablePrintJobs: MigrationDefinition = {
  name: "066_durable_print_jobs",
  up: async (connection) => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        printer_id BIGINT UNSIGNED NULL,
        station_id BIGINT UNSIGNED NULL,
        job_type ENUM('KOT', 'RECEIPT', 'TEST') NOT NULL,
        business_reference_type VARCHAR(50) NOT NULL,
        business_reference_id VARCHAR(120) NOT NULL,
        payload_json JSON NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        status ENUM(
          'QUEUED',
          'DISPATCHED',
          'PRINTING',
          'PRINTED',
          'FAILED',
          'CANCELLED'
        ) NOT NULL DEFAULT 'QUEUED',
        attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
        max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
        last_error_code VARCHAR(80) NULL,
        last_error_message VARCHAR(500) NULL,
        idempotency_key VARCHAR(160) NOT NULL,
        dispatched_at DATETIME NULL,
        printing_at DATETIME NULL,
        printed_at DATETIME NULL,
        failed_at DATETIME NULL,
        cancelled_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          ON UPDATE CURRENT_TIMESTAMP,

        UNIQUE KEY uq_print_job_idempotency (
          organization_id,
          branch_id,
          idempotency_key
        ),
        INDEX idx_print_jobs_queue (
          organization_id,
          branch_id,
          status,
          created_at,
          id
        ),
        INDEX idx_print_jobs_printer_status (
          organization_id,
          branch_id,
          printer_id,
          status,
          created_at
        ),
        INDEX idx_print_jobs_station (
          organization_id,
          branch_id,
          station_id,
          created_at
        ),
        INDEX idx_print_jobs_business_reference (
          organization_id,
          branch_id,
          business_reference_type,
          business_reference_id
        ),

        CONSTRAINT chk_print_jobs_max_attempts
          CHECK (max_attempts BETWEEN 1 AND 10),
        CONSTRAINT chk_print_jobs_attempt_count
          CHECK (attempt_count <= max_attempts),

        CONSTRAINT fk_print_jobs_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_print_jobs_branch
          FOREIGN KEY (branch_id)
          REFERENCES branches(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_print_jobs_printer
          FOREIGN KEY (printer_id)
          REFERENCES hardware_printers(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_print_jobs_station
          FOREIGN KEY (station_id)
          REFERENCES preparation_stations(id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection) => {
    await connection.query("DROP TABLE IF EXISTS print_jobs");
  }
};
