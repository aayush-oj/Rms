import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function addIndex(connection: PoolConnection, table: string, name: string, columns: string): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?', [table, name]
  );
  if (!rows.length) await connection.query(`CREATE INDEX ${name} ON ${table} (${columns})`);
}

export const migration016ShiftBusinessDay: MigrationDefinition = {
  name: '016_shift_business_day',
  up: async (connection: PoolConnection): Promise<void> => {
    const [branchTimezone] = await connection.query<any[]>(`SHOW COLUMNS FROM branches LIKE 'timezone'`);
    if (branchTimezone.length === 0) {
      await connection.query(`ALTER TABLE branches ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kathmandu' AFTER bill_prefix`);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS business_days (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        business_date DATE NOT NULL,
        status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        opened_by BIGINT UNSIGNED NOT NULL,
        closed_at DATETIME NULL,
        closed_by BIGINT UNSIGNED NULL,
        notes VARCHAR(500) NULL,
        open_branch_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'OPEN' THEN branch_id ELSE NULL END) STORED,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_business_day_branch_date (organization_id, branch_id, business_date),
        UNIQUE KEY uk_business_day_one_open (organization_id, open_branch_id),
        INDEX idx_business_days_branch_status (organization_id, branch_id, status),
        CONSTRAINT fk_business_days_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_business_days_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_business_days_opened_by FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_business_days_closed_by FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS registers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_register_org_branch_code (organization_id, branch_id, code),
        UNIQUE KEY uk_register_org_branch_name (organization_id, branch_id, name),
        INDEX idx_registers_branch (organization_id, branch_id, is_active),
        CONSTRAINT fk_registers_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_registers_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        business_day_id BIGINT UNSIGNED NOT NULL,
        register_id BIGINT UNSIGNED NOT NULL,
        cashier_id BIGINT UNSIGNED NOT NULL,
        opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME NULL,
        status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
        opening_cash DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        expected_cash DECIMAL(12,4) NULL,
        counted_cash DECIMAL(12,4) NULL,
        variance DECIMAL(12,4) NULL,
        variance_status ENUM('MATCHED','OVER','SHORT') NULL,
        notes VARCHAR(500) NULL,
        open_register_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'OPEN' THEN register_id ELSE NULL END) STORED,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_shift_one_open_register (organization_id, open_register_id),
        INDEX idx_shifts_business_day (organization_id, branch_id, business_day_id, status),
        INDEX idx_shifts_cashier (organization_id, branch_id, cashier_id, status),
        INDEX idx_shifts_register (organization_id, branch_id, register_id, status),
        CONSTRAINT fk_shifts_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_shifts_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shifts_business_day FOREIGN KEY (business_day_id) REFERENCES business_days(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shifts_register FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shifts_cashier FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        business_day_id BIGINT UNSIGNED NOT NULL,
        shift_id BIGINT UNSIGNED NOT NULL,
        register_id BIGINT UNSIGNED NOT NULL,
        movement_type ENUM('CASH_IN','CASH_OUT','CASH_DROP') NOT NULL,
        amount DECIMAL(12,4) NOT NULL,
        reason VARCHAR(255) NOT NULL,
        notes VARCHAR(500) NULL,
        performed_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cash_movements_shift (organization_id, branch_id, shift_id, created_at),
        INDEX idx_cash_movements_business_day (organization_id, branch_id, business_day_id, created_at),
        CONSTRAINT fk_cash_movements_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_cash_movements_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cash_movements_day FOREIGN KEY (business_day_id) REFERENCES business_days(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cash_movements_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cash_movements_register FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cash_movements_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const addColumn = async (table: string, column: string, ddl: string) => {
      const [rows] = await connection.query<any[]>(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
      if (rows.length === 0) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };

    await addColumn('orders', 'business_day_id', 'business_day_id BIGINT UNSIGNED NULL AFTER branch_id');
    await addColumn('orders', 'shift_id', 'shift_id BIGINT UNSIGNED NULL AFTER business_day_id');
    await addColumn('orders', 'register_id', 'register_id BIGINT UNSIGNED NULL AFTER shift_id');
    await addIndex(connection, 'orders', 'idx_orders_business_day', 'organization_id, branch_id, business_day_id');
    await addIndex(connection, 'orders', 'idx_orders_shift', 'organization_id, branch_id, shift_id');
    const [orderDayFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='fk_orders_business_day'`);
    if (!orderDayFk.length) await connection.query(`ALTER TABLE orders ADD CONSTRAINT fk_orders_business_day FOREIGN KEY (business_day_id) REFERENCES business_days(id) ON DELETE SET NULL`);
    const [orderShiftFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='fk_orders_shift'`);
    if (!orderShiftFk.length) await connection.query(`ALTER TABLE orders ADD CONSTRAINT fk_orders_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL`);
    const [orderRegisterFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='fk_orders_register'`);
    if (!orderRegisterFk.length) await connection.query(`ALTER TABLE orders ADD CONSTRAINT fk_orders_register FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE SET NULL`);

    await addColumn('bills', 'business_day_id', 'business_day_id BIGINT UNSIGNED NULL AFTER branch_id');
    await addColumn('bills', 'shift_id', 'shift_id BIGINT UNSIGNED NULL AFTER business_day_id');
    await addColumn('bills', 'register_id', 'register_id BIGINT UNSIGNED NULL AFTER shift_id');
    await addIndex(connection, 'bills', 'idx_bills_business_day_id', 'organization_id, branch_id, business_day_id');
    await addIndex(connection, 'bills', 'idx_bills_shift', 'organization_id, branch_id, shift_id');
    const [billDayFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='bills' AND CONSTRAINT_NAME='fk_bills_business_day'`);
    if (!billDayFk.length) await connection.query(`ALTER TABLE bills ADD CONSTRAINT fk_bills_business_day FOREIGN KEY (business_day_id) REFERENCES business_days(id) ON DELETE SET NULL`);
    const [billShiftFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='bills' AND CONSTRAINT_NAME='fk_bills_shift'`);
    if (!billShiftFk.length) await connection.query(`ALTER TABLE bills ADD CONSTRAINT fk_bills_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL`);
    const [billRegisterFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='bills' AND CONSTRAINT_NAME='fk_bills_register'`);
    if (!billRegisterFk.length) await connection.query(`ALTER TABLE bills ADD CONSTRAINT fk_bills_register FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE SET NULL`);

    await addColumn('payments', 'business_day_id', 'business_day_id BIGINT UNSIGNED NULL AFTER branch_id');
    await addColumn('payments', 'shift_id', 'shift_id BIGINT UNSIGNED NULL AFTER business_day_id');
    await addColumn('payments', 'register_id', 'register_id BIGINT UNSIGNED NULL AFTER shift_id');
    await addIndex(connection, 'payments', 'idx_payments_business_day_id', 'organization_id, branch_id, business_day_id');
    await addIndex(connection, 'payments', 'idx_payments_shift', 'organization_id, branch_id, shift_id');
    const [paymentDayFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='payments' AND CONSTRAINT_NAME='fk_payments_business_day'`);
    if (!paymentDayFk.length) await connection.query(`ALTER TABLE payments ADD CONSTRAINT fk_payments_business_day FOREIGN KEY (business_day_id) REFERENCES business_days(id) ON DELETE SET NULL`);
    const [paymentShiftFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='payments' AND CONSTRAINT_NAME='fk_payments_shift'`);
    if (!paymentShiftFk.length) await connection.query(`ALTER TABLE payments ADD CONSTRAINT fk_payments_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL`);
    const [paymentRegisterFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='payments' AND CONSTRAINT_NAME='fk_payments_register'`);
    if (!paymentRegisterFk.length) await connection.query(`ALTER TABLE payments ADD CONSTRAINT fk_payments_register FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE SET NULL`);
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`ALTER TABLE payments DROP FOREIGN KEY IF EXISTS fk_payments_register, DROP FOREIGN KEY IF EXISTS fk_payments_shift, DROP FOREIGN KEY IF EXISTS fk_payments_business_day`);
    await connection.query(`ALTER TABLE bills DROP FOREIGN KEY IF EXISTS fk_bills_register, DROP FOREIGN KEY IF EXISTS fk_bills_shift, DROP FOREIGN KEY IF EXISTS fk_bills_business_day`);
    await connection.query(`ALTER TABLE orders DROP FOREIGN KEY IF EXISTS fk_orders_register, DROP FOREIGN KEY IF EXISTS fk_orders_shift, DROP FOREIGN KEY IF EXISTS fk_orders_business_day`);
    await connection.query('DROP TABLE IF EXISTS cash_movements');
    await connection.query('DROP TABLE IF EXISTS shifts');
    await connection.query('DROP TABLE IF EXISTS registers');
    await connection.query('DROP TABLE IF EXISTS business_days');
  },
};
