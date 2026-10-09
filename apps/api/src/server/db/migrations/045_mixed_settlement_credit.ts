import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

async function hasColumn(connection: PoolConnection, table: string, column: string): Promise<boolean> {
  const [rows] = await connection.query<any[]>(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

export const migration045MixedSettlementCredit: MigrationDefinition = {
  name: '045_mixed_settlement_credit',
  up: async (connection: PoolConnection): Promise<void> => {
    if (!(await hasColumn(connection, 'orders', 'settlement_status'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN settlement_status VARCHAR(30) NOT NULL DEFAULT 'OPEN' AFTER payment_status`);
      await connection.query(`UPDATE orders SET settlement_status = CASE WHEN payment_status = 'PAID' THEN 'SETTLED' ELSE 'OPEN' END`);
    }
    if (!(await hasColumn(connection, 'orders', 'billing_discount_type'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN billing_discount_type VARCHAR(20) NOT NULL DEFAULT 'NONE' AFTER manual_discount`);
    }
    if (!(await hasColumn(connection, 'orders', 'billing_discount_value'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN billing_discount_value DECIMAL(12,4) NOT NULL DEFAULT 0.0000 AFTER billing_discount_type`);
    }
    if (!(await hasColumn(connection, 'orders', 'billing_discount_reason'))) {
      await connection.query(`ALTER TABLE orders ADD COLUMN billing_discount_reason VARCHAR(255) NULL AFTER billing_discount_value`);
    }

    if (!(await hasColumn(connection, 'bills', 'credit_total'))) {
      await connection.query(`ALTER TABLE bills ADD COLUMN credit_total DECIMAL(12,4) NOT NULL DEFAULT 0.0000 AFTER amount_paid`);
    }
    if (!(await hasColumn(connection, 'bills', 'discount_type'))) {
      await connection.query(`ALTER TABLE bills ADD COLUMN discount_type VARCHAR(20) NOT NULL DEFAULT 'NONE' AFTER discount_total`);
    }
    if (!(await hasColumn(connection, 'bills', 'discount_value'))) {
      await connection.query(`ALTER TABLE bills ADD COLUMN discount_value DECIMAL(12,4) NOT NULL DEFAULT 0.0000 AFTER discount_type`);
    }
    if (!(await hasColumn(connection, 'bills', 'discount_reason'))) {
      await connection.query(`ALTER TABLE bills ADD COLUMN discount_reason VARCHAR(255) NULL AFTER discount_value`);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_receivables (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        customer_id BIGINT UNSIGNED NOT NULL,
        bill_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        original_amount DECIMAL(12,4) NOT NULL,
        outstanding_amount DECIMAL(12,4) NOT NULL,
        due_date DATE NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
        notes VARCHAR(500) NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        settled_at DATETIME NULL,
        UNIQUE KEY uk_customer_receivable_bill (organization_id, branch_id, bill_id),
        INDEX idx_customer_receivable_customer (organization_id, customer_id, status),
        INDEX idx_customer_receivable_branch (organization_id, branch_id, status),
        CONSTRAINT fk_cr_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_cr_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_cr_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cr_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cr_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
        CONSTRAINT fk_cr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_credit_payments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        receivable_id BIGINT UNSIGNED NOT NULL,
        payment_method_id BIGINT UNSIGNED NOT NULL,
        amount DECIMAL(12,4) NOT NULL,
        tender_amount DECIMAL(12,4) NULL,
        change_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        external_reference VARCHAR(255) NULL,
        notes VARCHAR(500) NULL,
        business_date DATE NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        idempotency_key VARCHAR(120) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_credit_payment_idempotency (organization_id, branch_id, idempotency_key),
        INDEX idx_credit_payment_receivable (organization_id, receivable_id, created_at),
        CONSTRAINT fk_ccp_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_ccp_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_ccp_receivable FOREIGN KEY (receivable_id) REFERENCES customer_receivables(id) ON DELETE RESTRICT,
        CONSTRAINT fk_ccp_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE RESTRICT,
        CONSTRAINT fk_ccp_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS bill_settlement_attempts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        bill_id BIGINT UNSIGNED NOT NULL,
        idempotency_key VARCHAR(120) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_bill_settlement_attempt (organization_id, branch_id, idempotency_key),
        INDEX idx_bill_settlement_bill (organization_id, branch_id, bill_id),
        CONSTRAINT fk_bsa_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_bsa_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_bsa_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
        CONSTRAINT fk_bsa_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(
      `INSERT INTO permissions (code, module, description) VALUES ('pos:discounts:apply', 'pos', 'Apply manual discounts before bill settlement')
       ON DUPLICATE KEY UPDATE description = VALUES(description)`
    );
    const [permissionRows] = await connection.query<any[]>(`SELECT id FROM permissions WHERE code = 'pos:discounts:apply' LIMIT 1`);
    if (permissionRows.length) {
      const [roleRows] = await connection.query<any[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name IN ('FB_MANAGER','CASHIER')`);
      for (const role of roleRows) await connection.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [role.id, permissionRows[0].id]);
    }
  },
  down: async (connection: PoolConnection): Promise<void> => {
    const [permissionRows] = await connection.query<any[]>(`SELECT id FROM permissions WHERE code = 'pos:discounts:apply' LIMIT 1`);
    if (permissionRows.length) {
      await connection.query('DELETE FROM role_permissions WHERE permission_id = ?', [permissionRows[0].id]);
      await connection.query('DELETE FROM user_permissions WHERE permission_id = ?', [permissionRows[0].id]);
      await connection.query('DELETE FROM permissions WHERE id = ?', [permissionRows[0].id]);
    }
    await connection.query('DROP TABLE IF EXISTS bill_settlement_attempts');
    await connection.query('DROP TABLE IF EXISTS customer_credit_payments');
    await connection.query('DROP TABLE IF EXISTS customer_receivables');
    if (await hasColumn(connection, 'bills', 'discount_reason')) await connection.query('ALTER TABLE bills DROP COLUMN discount_reason');
    if (await hasColumn(connection, 'bills', 'discount_value')) await connection.query('ALTER TABLE bills DROP COLUMN discount_value');
    if (await hasColumn(connection, 'bills', 'discount_type')) await connection.query('ALTER TABLE bills DROP COLUMN discount_type');
    if (await hasColumn(connection, 'bills', 'credit_total')) await connection.query('ALTER TABLE bills DROP COLUMN credit_total');
    if (await hasColumn(connection, 'orders', 'billing_discount_reason')) await connection.query('ALTER TABLE orders DROP COLUMN billing_discount_reason');
    if (await hasColumn(connection, 'orders', 'billing_discount_value')) await connection.query('ALTER TABLE orders DROP COLUMN billing_discount_value');
    if (await hasColumn(connection, 'orders', 'billing_discount_type')) await connection.query('ALTER TABLE orders DROP COLUMN billing_discount_type');
    if (await hasColumn(connection, 'orders', 'settlement_status')) await connection.query('ALTER TABLE orders DROP COLUMN settlement_status');
  },
};
