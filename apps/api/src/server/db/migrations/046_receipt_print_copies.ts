import { MigrationDefinition } from './types';

export const migration046ReceiptPrintCopies: MigrationDefinition = {
  name: '046_receipt_print_copies',
  async up(connection) {
    await connection.query(`
      ALTER TABLE operational_settings
        ADD COLUMN receipt_print_copies TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER receipt_paper_size;
    `);
  },
  async down(connection) {
    await connection.query(`
      ALTER TABLE operational_settings
        DROP COLUMN receipt_print_copies;
    `);
  },
};
