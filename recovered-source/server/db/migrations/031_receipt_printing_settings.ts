import { MigrationDefinition } from './types';

export const migration031ReceiptPrintingSettings: MigrationDefinition = {
  name: '031_receipt_printing_settings',
  async up(connection) {
    await connection.query(`
      ALTER TABLE operational_settings
        ADD COLUMN receipt_title VARCHAR(80) NOT NULL DEFAULT 'RECEIPT' AFTER receipt_footer,
        ADD COLUMN receipt_paper_size ENUM('AUTO','58MM','80MM','A4') NOT NULL DEFAULT '80MM' AFTER receipt_title,
        ADD COLUMN receipt_show_branch BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_paper_size,
        ADD COLUMN receipt_show_address BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_branch,
        ADD COLUMN receipt_show_phone BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_address,
        ADD COLUMN receipt_show_email BOOLEAN NOT NULL DEFAULT FALSE AFTER receipt_show_phone,
        ADD COLUMN receipt_show_tax_id BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_email,
        ADD COLUMN receipt_show_order_number BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_tax_id,
        ADD COLUMN receipt_show_table BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_order_number,
        ADD COLUMN receipt_show_waiter BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_table,
        ADD COLUMN receipt_show_cashier BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_waiter,
        ADD COLUMN receipt_show_payment_summary BOOLEAN NOT NULL DEFAULT TRUE AFTER receipt_show_cashier;
    `);
  },
  async down(connection) {
    await connection.query(`
      ALTER TABLE operational_settings
        DROP COLUMN receipt_show_payment_summary,
        DROP COLUMN receipt_show_cashier,
        DROP COLUMN receipt_show_waiter,
        DROP COLUMN receipt_show_table,
        DROP COLUMN receipt_show_order_number,
        DROP COLUMN receipt_show_tax_id,
        DROP COLUMN receipt_show_email,
        DROP COLUMN receipt_show_phone,
        DROP COLUMN receipt_show_address,
        DROP COLUMN receipt_show_branch,
        DROP COLUMN receipt_paper_size,
        DROP COLUMN receipt_title;
    `);
  },
};
