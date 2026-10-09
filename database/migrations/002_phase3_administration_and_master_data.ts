import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration002Phase3AdministrationAndMasterData: MigrationDefinition = {
  name: '002_phase3_administration_and_master_data',
  up: async (connection: PoolConnection): Promise<void> => {
    // 1. Floors / Floor Plans
    await connection.query(`
      CREATE TABLE IF NOT EXISTS floors (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_floor_name (organization_id, branch_id, name),
        INDEX idx_floors_branch (organization_id, branch_id),
        CONSTRAINT fk_floors_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_floors_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Sections / Dining Areas
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        floor_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_floor_section_name (organization_id, branch_id, floor_id, name),
        INDEX idx_sections_floor (organization_id, branch_id, floor_id),
        CONSTRAINT fk_sections_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_sections_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_sections_floor FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Dining Tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS dining_tables (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        floor_id BIGINT UNSIGNED NOT NULL,
        section_id BIGINT UNSIGNED NOT NULL,
        table_number VARCHAR(50) NOT NULL,
        capacity INT NOT NULL DEFAULT 2,
        status ENUM('available', 'occupied', 'reserved', 'cleaning', 'disabled') NOT NULL DEFAULT 'available',
        pos_x INT NOT NULL DEFAULT 0,
        pos_y INT NOT NULL DEFAULT 0,
        width INT NOT NULL DEFAULT 100,
        height INT NOT NULL DEFAULT 100,
        shape ENUM('square', 'rectangle', 'round') NOT NULL DEFAULT 'square',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_table_number (organization_id, branch_id, table_number),
        INDEX idx_tables_section (organization_id, branch_id, section_id),
        INDEX idx_tables_status (organization_id, branch_id, status),
        CONSTRAINT fk_tables_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_tables_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_tables_floor FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE,
        CONSTRAINT fk_tables_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Hardware Printers
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hardware_printers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        port INT NOT NULL DEFAULT 9100,
        paper_width ENUM('58mm', '80mm') NOT NULL DEFAULT '80mm',
        device_type VARCHAR(50) NOT NULL DEFAULT 'ESC_POS',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_printer_name (organization_id, branch_id, name),
        INDEX idx_printers_branch (organization_id, branch_id),
        CONSTRAINT fk_printers_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_printers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Preparation Stations (Kitchen / Bar / Counter routing)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS preparation_stations (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        type ENUM('kitchen', 'bar', 'counter', 'expediter') NOT NULL DEFAULT 'kitchen',
        primary_printer_id BIGINT UNSIGNED NULL,
        backup_printer_id BIGINT UNSIGNED NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_station_name (organization_id, branch_id, name),
        INDEX idx_stations_branch (organization_id, branch_id),
        CONSTRAINT fk_stations_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_stations_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_stations_prim_printer FOREIGN KEY (primary_printer_id) REFERENCES hardware_printers(id) ON DELETE SET NULL,
        CONSTRAINT fk_stations_back_printer FOREIGN KEY (backup_printer_id) REFERENCES hardware_printers(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Authoritative branch VAT profile.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS branch_tax_configs (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        is_vat_registered BOOLEAN NOT NULL DEFAULT FALSE,
        tax_registration_number VARCHAR(50) NULL,
        vat_rate DECIMAL(7, 6) NOT NULL DEFAULT 0.000000,
        default_price_entry_mode ENUM('VAT_INCLUDED', 'VAT_EXCLUDED') NOT NULL DEFAULT 'VAT_INCLUDED',
        rounding_method ENUM('HALF_EVEN', 'HALF_UP', 'ROUND_DOWN', 'ROUND_UP') NOT NULL DEFAULT 'HALF_EVEN',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_tax_config (organization_id, branch_id),
        INDEX idx_branch_tax_config (organization_id, branch_id),
        CONSTRAINT fk_btax_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_btax_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Payment Methods (Organization Master with Optional Branch Scope)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS payment_methods (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NULL COMMENT 'NULL indicates org-wide availability',
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) NOT NULL,
        type ENUM('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'QR_CODE', 'MOBILE_WALLET', 'BANK_TRANSFER', 'HOUSE_CREDIT', 'OTHER') NOT NULL DEFAULT 'CASH',
        requires_reference BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        display_order INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_payments_org (organization_id),
        INDEX idx_payments_org_branch (organization_id, branch_id),
        CONSTRAINT fk_payments_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_payments_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Units of Measure (Platform Defaults & Org Customs)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS units_of_measure (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NULL COMMENT 'NULL indicates global platform standard',
        name VARCHAR(50) NOT NULL,
        symbol VARCHAR(20) NOT NULL,
        dimension ENUM('MASS', 'VOLUME', 'COUNT', 'LENGTH', 'TIME') NOT NULL,
        base_unit_symbol VARCHAR(20) NOT NULL,
        conversion_factor DECIMAL(12, 6) NOT NULL DEFAULT 1.000000,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_units_org (organization_id),
        CONSTRAINT fk_units_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. Operational Settings (Store Hours, Features, Receipt Customization)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS operational_settings (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NULL COMMENT 'NULL indicates org-level default',
        opening_time VARCHAR(10) NOT NULL DEFAULT '08:00',
        closing_time VARCHAR(10) NOT NULL DEFAULT '23:00',
        operating_days JSON NULL,
        dine_in_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        takeaway_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        receipt_header TEXT NULL,
        receipt_footer TEXT NULL,
        currency_symbol VARCHAR(10) NOT NULL DEFAULT 'रू',
        auto_print_kot BOOLEAN NOT NULL DEFAULT TRUE,
        auto_print_bill BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_org_branch_operational_settings (organization_id, branch_id),
        INDEX idx_operational_settings_org (organization_id, branch_id),
        CONSTRAINT fk_opsettings_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_opsettings_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS operational_settings;');
    await connection.query('DROP TABLE IF EXISTS units_of_measure;');
    await connection.query('DROP TABLE IF EXISTS payment_methods;');
    await connection.query('DROP TABLE IF EXISTS branch_tax_configs;');
    await connection.query('DROP TABLE IF EXISTS preparation_stations;');
    await connection.query('DROP TABLE IF EXISTS hardware_printers;');
    await connection.query('DROP TABLE IF EXISTS dining_tables;');
    await connection.query('DROP TABLE IF EXISTS sections;');
    await connection.query('DROP TABLE IF EXISTS floors;');
  },
};
