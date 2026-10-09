import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration006OrderDomain: MigrationDefinition = {
  name: '006_order_domain',
  up: async (connection: PoolConnection): Promise<void> => {
    // 1. Order number counters — concurrency-safe per-branch daily sequence
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_number_counters (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        counter_date DATE NOT NULL,
        next_seq INT UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_date (organization_id, branch_id, counter_date),
        CONSTRAINT fk_counter_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_counter_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // 2. Orders — the authoritative operational record
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_number VARCHAR(50) NOT NULL,
        order_type ENUM('DINE_IN', 'TAKEAWAY') NOT NULL DEFAULT 'DINE_IN',
        dining_table_id BIGINT UNSIGNED NULL,
        waiter_id BIGINT UNSIGNED NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        subtotal DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        discount DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        tax DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        taxable_amount DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        vat_registered_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
        tax_registration_number_snapshot VARCHAR(50) NULL,
        vat_rate_snapshot DECIMAL(7, 6) NOT NULL DEFAULT 0.000000,
        rounding_method_snapshot ENUM('HALF_EVEN', 'HALF_UP', 'ROUND_DOWN', 'ROUND_UP') NOT NULL DEFAULT 'HALF_EVEN',
        grand_total DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        order_status ENUM('PLACED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLACED',
        payment_status ENUM('UNPAID', 'PARTIALLY_PAID', 'PAID') NOT NULL DEFAULT 'UNPAID',
        cancelled_at DATETIME NULL,
        cancelled_by BIGINT UNSIGNED NULL,
        cancellation_reason VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_order_number (organization_id, branch_id, order_number),
        INDEX idx_orders_branch_status (branch_id, order_status),
        INDEX idx_orders_table (dining_table_id),
        INDEX idx_orders_created (organization_id, branch_id, created_at),
        CONSTRAINT fk_orders_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_orders_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_orders_table FOREIGN KEY (dining_table_id) REFERENCES dining_tables(id) ON DELETE SET NULL,
        CONSTRAINT fk_orders_waiter FOREIGN KEY (waiter_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_orders_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_orders_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    // 3. Order items — historical snapshots with prices
    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        order_id BIGINT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        item_name_snapshot VARCHAR(150) NOT NULL,
        unit_price DECIMAL(12, 4) NOT NULL COMMENT 'Customer-facing VAT-inclusive unit price',
        entered_unit_price_snapshot DECIMAL(12, 4) NOT NULL,
        price_entry_mode_snapshot ENUM('VAT_INCLUDED', 'VAT_EXCLUDED') NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        line_subtotal DECIMAL(12, 4) NOT NULL,
        discount_amount_snapshot DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        taxable_amount DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        tax_rate_snapshot DECIMAL(7, 6) NOT NULL DEFAULT 0.000000,
        tax_amount DECIMAL(12, 4) NOT NULL DEFAULT 0.0000,
        line_total DECIMAL(12, 4) NOT NULL COMMENT 'Customer amount after allocated discount, before order rounding',
        notes VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_order_items_order (order_id),
        CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_oi_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS order_items');
    await connection.query('DROP TABLE IF EXISTS orders');
    await connection.query('DROP TABLE IF EXISTS order_number_counters');
  },
};
