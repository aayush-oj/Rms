import type { MigrationDefinition } from './types';

export const migration065PrinterDomainModel: MigrationDefinition = {
  name: "065_printer_domain_model",
  up: async (connection) => {
    await connection.query(`
      ALTER TABLE hardware_printers
        ADD COLUMN printer_type ENUM('KOT', 'RECEIPT', 'INVOICE', 'LABEL') NOT NULL DEFAULT 'KOT' AFTER name,
        ADD COLUMN interface_type ENUM('NETWORK') NOT NULL DEFAULT 'NETWORK' AFTER printer_type,
        ADD COLUMN protocol ENUM('RAW_TCP') NOT NULL DEFAULT 'RAW_TCP' AFTER interface_type,
        ADD COLUMN is_default_kot BOOLEAN NOT NULL DEFAULT FALSE AFTER device_type,
        ADD COLUMN is_default_receipt BOOLEAN NOT NULL DEFAULT FALSE AFTER is_default_kot,
        ADD COLUMN connectivity_status ENUM('UNKNOWN', 'ONLINE', 'OFFLINE', 'UNREACHABLE') NOT NULL DEFAULT 'UNKNOWN' AFTER is_active,
        ADD COLUMN last_seen_at DATETIME NULL AFTER connectivity_status,
        ADD COLUMN last_successful_print_at DATETIME NULL AFTER last_seen_at,
        ADD COLUMN last_error_at DATETIME NULL AFTER last_successful_print_at,
        ADD COLUMN last_error VARCHAR(500) NULL AFTER last_error_at;
    `);
  },
  down: async (connection) => {
    await connection.query(`
      ALTER TABLE hardware_printers
        DROP COLUMN last_error,
        DROP COLUMN last_error_at,
        DROP COLUMN last_successful_print_at,
        DROP COLUMN last_seen_at,
        DROP COLUMN connectivity_status,
        DROP COLUMN is_default_receipt,
        DROP COLUMN is_default_kot,
        DROP COLUMN protocol,
        DROP COLUMN interface_type,
        DROP COLUMN printer_type;
    `);
  }
};
