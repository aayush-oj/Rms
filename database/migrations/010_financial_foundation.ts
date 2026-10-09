import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration010FinancialFoundation: MigrationDefinition = {
  name: '010_financial_foundation',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS bills (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        bill_number VARCHAR(80) NOT NULL,
        business_date DATE NOT NULL,
        status ENUM('DRAFT','FINALIZED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        currency VARCHAR(10) NOT NULL DEFAULT 'NPR',
        subtotal DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        discount_total DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        taxable_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        tax_total DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        vat_registered_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
        tax_registration_number_snapshot VARCHAR(50) NULL,
        vat_rate_snapshot DECIMAL(7,6) NOT NULL DEFAULT 0.000000,
        rounding_method_snapshot ENUM('HALF_EVEN','HALF_UP','ROUND_DOWN','ROUND_UP') NOT NULL DEFAULT 'HALF_EVEN',
        rounding_delta DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        grand_total DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        amount_paid DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        balance_due DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        finalized_at DATETIME NULL,
        finalized_by BIGINT UNSIGNED NULL,
        cancelled_at DATETIME NULL,
        cancelled_by BIGINT UNSIGNED NULL,
        cancellation_reason VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_bill_order (organization_id, branch_id, order_id),
        UNIQUE KEY uk_bill_number (organization_id, branch_id, bill_number),
        INDEX idx_bills_branch_status (organization_id, branch_id, status),
        INDEX idx_bills_business_date (organization_id, branch_id, business_date),
        CONSTRAINT fk_bills_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_bills_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_bills_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
        CONSTRAINT fk_bills_finalized_by FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_bills_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bill_lines (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        bill_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_item_id BIGINT UNSIGNED NULL,
        menu_item_id BIGINT UNSIGNED NULL,
        item_name_snapshot VARCHAR(150) NOT NULL,
        quantity DECIMAL(12,4) NOT NULL,
        unit_price DECIMAL(12,4) NOT NULL,
        line_subtotal DECIMAL(12,4) NOT NULL,
        discount_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        taxable_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        tax_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        line_total DECIMAL(12,4) NOT NULL,
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_bill_lines_bill (bill_id),
        CONSTRAINT fk_bill_lines_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
        CONSTRAINT fk_bill_lines_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_bill_lines_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_bill_lines_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
        CONSTRAINT fk_bill_lines_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        bill_id BIGINT UNSIGNED NOT NULL,
        payment_method_id BIGINT UNSIGNED NOT NULL,
        amount DECIMAL(12,4) NOT NULL,
        tender_amount DECIMAL(12,4) NULL,
        change_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        business_date DATE NOT NULL,
        status ENUM('CAPTURED','REVERSED') NOT NULL DEFAULT 'CAPTURED',
        external_reference VARCHAR(150) NULL,
        notes VARCHAR(500) NULL,
        idempotency_key VARCHAR(120) NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        reversed_payment_id BIGINT UNSIGNED NULL,
        reversed_at DATETIME NULL,
        reversed_by BIGINT UNSIGNED NULL,
        reversal_reason VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_payment_idempotency (organization_id, branch_id, idempotency_key),
        INDEX idx_payments_bill (organization_id, branch_id, bill_id),
        INDEX idx_payments_business_date (organization_id, branch_id, business_date),
        CONSTRAINT fk_captured_payments_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_captured_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_payments_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
        CONSTRAINT fk_payments_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE RESTRICT,
        CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_payments_reversed_payment FOREIGN KEY (reversed_payment_id) REFERENCES payments(id) ON DELETE SET NULL,
        CONSTRAINT fk_payments_reversed_by FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS payments');
    await connection.query('DROP TABLE IF EXISTS bill_lines');
    await connection.query('DROP TABLE IF EXISTS bills');
  },
};
