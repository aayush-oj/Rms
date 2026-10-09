import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration008Phase3KotOperations: MigrationDefinition = {
  name: '008_phase3_kot_operations',
  up: async (connection: PoolConnection): Promise<void> => {
    // 1. KOT number counters — concurrency-safe per-branch daily sequence
    await connection.query(`
      CREATE TABLE IF NOT EXISTS kot_number_counters (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        counter_date DATE NOT NULL,
        next_seq INT UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_kot_org_branch_date (organization_id, branch_id, counter_date),
        CONSTRAINT fk_kot_counter_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_kot_counter_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // 2. Kitchen tickets — operational KOT record (extends Order Domain)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS kitchen_tickets (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        kot_number VARCHAR(50) NOT NULL,
        ticket_status ENUM('NEW', 'PREPARING', 'READY', 'COMPLETED', 'VOIDED') NOT NULL DEFAULT 'NEW',
        order_type ENUM('DINE_IN', 'TAKEAWAY') NOT NULL,
        table_label VARCHAR(100) NULL,
        waiter_name VARCHAR(150) NULL,
        voided_at DATETIME NULL,
        voided_by BIGINT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_kot_org_branch_number (organization_id, branch_id, kot_number),
        INDEX idx_kot_order (order_id),
        INDEX idx_kot_branch_status (branch_id, ticket_status),
        INDEX idx_kot_created (organization_id, branch_id, created_at),
        CONSTRAINT fk_kot_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_kot_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_kot_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_kot_voided_by FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);

    // 3. Kitchen ticket items — historical snapshots with per-item prep state
    await connection.query(`
      CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        kitchen_ticket_id BIGINT UNSIGNED NOT NULL,
        sequence_number INT UNSIGNED NOT NULL,
        menu_item_id BIGINT UNSIGNED NOT NULL,
        item_name_snapshot VARCHAR(150) NOT NULL,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        notes VARCHAR(255) NULL,
        prep_station_id BIGINT UNSIGNED NULL,
        prep_station_name VARCHAR(100) NULL,
        item_status ENUM('PENDING', 'PREPARING', 'READY', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_kot_item_ticket_seq (kitchen_ticket_id, sequence_number),
        INDEX idx_kot_item_station (prep_station_id),
        INDEX idx_kot_item_status (item_status),
        CONSTRAINT fk_kti_ticket FOREIGN KEY (kitchen_ticket_id) REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
        CONSTRAINT fk_kti_menu_item FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT,
        CONSTRAINT fk_kti_station FOREIGN KEY (prep_station_id) REFERENCES preparation_stations(id) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS kitchen_ticket_items');
    await connection.query('DROP TABLE IF EXISTS kitchen_tickets');
    await connection.query('DROP TABLE IF EXISTS kot_number_counters');
  },
};
