import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration021ExpenseManagement: MigrationDefinition = {
  name: '021_expense_management',
  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(255) NULL,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_expense_category_org_name (organization_id, name),
        INDEX idx_expense_category_org_active (organization_id, is_active, display_order),
        CONSTRAINT fk_expense_category_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_expense_category_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        business_day_id BIGINT UNSIGNED NOT NULL,
        shift_id BIGINT UNSIGNED NULL,
        register_id BIGINT UNSIGNED NULL,
        expense_category_id BIGINT UNSIGNED NOT NULL,
        department_id BIGINT UNSIGNED NULL,
        payment_method_id BIGINT UNSIGNED NOT NULL,
        cash_movement_id BIGINT UNSIGNED NULL,
        reversal_cash_movement_id BIGINT UNSIGNED NULL,
        amount DECIMAL(14,4) NOT NULL,
        reference VARCHAR(150) NULL,
        description VARCHAR(255) NOT NULL,
        notes TEXT NULL,
        expense_date DATE NOT NULL,
        status ENUM('DRAFT','POSTED','VOIDED') NOT NULL DEFAULT 'DRAFT',
        request_key VARCHAR(100) NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        posted_by BIGINT UNSIGNED NULL,
        posted_at DATETIME NULL,
        voided_by BIGINT UNSIGNED NULL,
        voided_at DATETIME NULL,
        void_reason VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_expense_org_request_key (organization_id, request_key),
        UNIQUE KEY uk_expense_cash_movement (cash_movement_id),
        UNIQUE KEY uk_expense_reversal_cash_movement (reversal_cash_movement_id),
        INDEX idx_expense_org_branch_date (organization_id, branch_id, expense_date),
        INDEX idx_expense_business_day (organization_id, branch_id, business_day_id, status),
        INDEX idx_expense_shift (organization_id, branch_id, shift_id),
        INDEX idx_expense_category (organization_id, expense_category_id, status),
        INDEX idx_expense_department (organization_id, department_id),
        INDEX idx_expense_payment_method (organization_id, payment_method_id),
        INDEX idx_expense_status (organization_id, branch_id, status),
        CONSTRAINT fk_expense_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_expense_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_business_day FOREIGN KEY (business_day_id) REFERENCES business_days(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_shift FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_register FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_category FOREIGN KEY (expense_category_id) REFERENCES expense_categories(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        CONSTRAINT fk_expense_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_cash_movement FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_reversal_cash_movement FOREIGN KEY (reversal_cash_movement_id) REFERENCES cash_movements(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_posted_by FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_expense_voided_by FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT chk_expense_amount_positive CHECK (amount > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const permissions = [
      ['expenses:view', 'finance', 'View branch expense records and summaries'],
      ['expenses:create', 'finance', 'Create operational expense drafts'],
      ['expenses:update', 'finance', 'Edit expense drafts'],
      ['expenses:post', 'finance', 'Post expenses and create required cash movements'],
      ['expenses:void', 'finance', 'Void posted expenses with compensating cash movements where required'],
      ['expenses:category:manage', 'finance', 'Manage expense categories'],
    ];
    for (const [code, module, description] of permissions) {
      await connection.query(
        `INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE module = VALUES(module), description = VALUES(description)`,
        [code, module, description]
      );
    }

    const [manager] = await connection.query<any[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name = 'FB_MANAGER' LIMIT 1`);
    const [cashier] = await connection.query<any[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name = 'CASHIER' LIMIT 1`);
    if (manager.length) {
      for (const [code] of permissions) {
        const [perm] = await connection.query<any[]>(`SELECT id FROM permissions WHERE code = ? LIMIT 1`, [code]);
        if (perm.length) await connection.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [manager[0].id, perm[0].id]);
      }
    }
    if (cashier.length) {
      for (const code of ['expenses:view','expenses:create','expenses:post']) {
        const [perm] = await connection.query<any[]>(`SELECT id FROM permissions WHERE code = ? LIMIT 1`, [code]);
        if (perm.length) await connection.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [cashier[0].id, perm[0].id]);
      }
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS expenses');
    await connection.query('DROP TABLE IF EXISTS expense_categories');
  },
};
