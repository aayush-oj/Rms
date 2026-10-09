import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration015ManagementFoundation: MigrationDefinition = {
  name: '015_management_foundation',
  up: async (connection: PoolConnection): Promise<void> => {
    // Departments are organization master data with optional branch scope.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NULL,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) NULL,
        description VARCHAR(255) NULL,
        display_order INT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_dept_org_branch_name (organization_id, branch_id, name),
        UNIQUE KEY uk_dept_org_branch_code (organization_id, branch_id, code),
        INDEX idx_dept_org_branch (organization_id, branch_id),
        CONSTRAINT fk_dept_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_dept_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Add menu operational metadata without creating a second menu-item model.
    const [menuItemPrep] = await connection.query<any[]>(`SHOW COLUMNS FROM menu_items LIKE 'prep_time_minutes'`);
    if (menuItemPrep.length === 0) {
      await connection.query(`ALTER TABLE menu_items ADD COLUMN prep_time_minutes INT UNSIGNED NULL AFTER is_combo`);
    }
    const [menuItemDept] = await connection.query<any[]>(`SHOW COLUMNS FROM menu_items LIKE 'department_id'`);
    if (menuItemDept.length === 0) {
      await connection.query(`ALTER TABLE menu_items ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER default_prep_station_id`);
    }
    const [menuDeptIndex] = await connection.query<any[]>(`SHOW INDEX FROM menu_items WHERE Key_name = 'idx_menu_items_department'`);
    if (menuDeptIndex.length === 0) {
      await connection.query(`ALTER TABLE menu_items ADD INDEX idx_menu_items_department (organization_id, department_id)`);
    }
    const [menuDeptFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND CONSTRAINT_NAME = 'fk_menu_items_department'`);
    if (menuDeptFk.length === 0) {
      await connection.query(`ALTER TABLE menu_items ADD CONSTRAINT fk_menu_items_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL`);
    }

    // Default waiter assignment belongs to the table, not to active orders.
    const [tableWaiter] = await connection.query<any[]>(`SHOW COLUMNS FROM dining_tables LIKE 'assigned_waiter_id'`);
    if (tableWaiter.length === 0) {
      await connection.query(`ALTER TABLE dining_tables ADD COLUMN assigned_waiter_id BIGINT UNSIGNED NULL AFTER section_id`);
    }
    const [tableNotes] = await connection.query<any[]>(`SHOW COLUMNS FROM dining_tables LIKE 'notes'`);
    if (tableNotes.length === 0) {
      await connection.query(`ALTER TABLE dining_tables ADD COLUMN notes VARCHAR(255) NULL AFTER assigned_waiter_id`);
    }
    const [tableWaiterIndex] = await connection.query<any[]>(`SHOW INDEX FROM dining_tables WHERE Key_name = 'idx_tables_assigned_waiter'`);
    if (tableWaiterIndex.length === 0) {
      await connection.query(`ALTER TABLE dining_tables ADD INDEX idx_tables_assigned_waiter (organization_id, branch_id, assigned_waiter_id)`);
    }
    const [tableWaiterFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dining_tables' AND CONSTRAINT_NAME = 'fk_tables_assigned_waiter'`);
    if (tableWaiterFk.length === 0) {
      await connection.query(`ALTER TABLE dining_tables ADD CONSTRAINT fk_tables_assigned_waiter FOREIGN KEY (assigned_waiter_id) REFERENCES users(id) ON DELETE SET NULL`);
    }

    // Room/table access scope. Branch access remains the broadest scope.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_section_access (
        user_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        section_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, section_id),
        INDEX idx_usa_org_branch (organization_id, branch_id, user_id),
        CONSTRAINT fk_usa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_usa_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_usa_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_usa_section FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_table_access (
        user_id BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        branch_id BIGINT UNSIGNED NOT NULL,
        dining_table_id BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, dining_table_id),
        INDEX idx_uta_org_branch (organization_id, branch_id, user_id),
        CONSTRAINT fk_uta_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_uta_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_uta_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        CONSTRAINT fk_uta_table FOREIGN KEY (dining_table_id) REFERENCES dining_tables(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Customer master and lightweight membership model.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NULL,
        email VARCHAR(150) NULL,
        notes TEXT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_customer_org_phone (organization_id, phone),
        INDEX idx_customer_org_name (organization_id, name),
        INDEX idx_customer_org_email (organization_id, email),
        CONSTRAINT fk_customer_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS memberships (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        customer_id BIGINT UNSIGNED NOT NULL,
        membership_number VARCHAR(50) NOT NULL,
        tier VARCHAR(50) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        benefit_discount_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0000,
        benefits JSON NULL,
        status ENUM('ACTIVE', 'INACTIVE', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_membership_org_number (organization_id, membership_number),
        INDEX idx_membership_org_customer (organization_id, customer_id),
        INDEX idx_membership_status (organization_id, status),
        CONSTRAINT fk_membership_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_membership_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS membership_usages (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        membership_id BIGINT UNSIGNED NOT NULL,
        customer_id BIGINT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NULL,
        benefit_type VARCHAR(50) NOT NULL,
        benefit_amount DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
        notes VARCHAR(255) NULL,
        used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by BIGINT UNSIGNED NOT NULL,
        INDEX idx_membership_usage (organization_id, membership_id, used_at),
        INDEX idx_membership_usage_order (organization_id, order_id),
        CONSTRAINT fk_mu_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_mu_membership FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE CASCADE,
        CONSTRAINT fk_mu_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        CONSTRAINT fk_mu_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_mu_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Customer dimension on the authoritative order record. Optional and non-breaking.
    const [customerCol] = await connection.query<any[]>(`SHOW COLUMNS FROM orders LIKE 'customer_id'`);
    if (customerCol.length === 0) {
      await connection.query(`ALTER TABLE orders ADD COLUMN customer_id BIGINT UNSIGNED NULL AFTER dining_table_id`);
    }
    const [customerIdx] = await connection.query<any[]>(`SHOW INDEX FROM orders WHERE Key_name = 'idx_orders_customer'`);
    if (customerIdx.length === 0) {
      await connection.query(`ALTER TABLE orders ADD INDEX idx_orders_customer (organization_id, branch_id, customer_id)`);
    }
    const [customerFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_customer'`);
    if (customerFk.length === 0) {
      await connection.query(`ALTER TABLE orders ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`);
    }

    // Seed the permissions this sprint adds to the existing permission table.
    const permissions = [
      ['admin:customers:manage', 'admin', 'Manage customer profiles and membership records'],
      ['admin:departments:manage', 'admin', 'Manage operational departments and menu department assignments'],
      ['admin:access:manage', 'admin', 'Manage staff branch, room, and table access assignments'],
    ];
    for (const [code, module, description] of permissions) {
      await connection.query(
        `INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        [code, module, description]
      );
    }

    // Give FB_MANAGER the new management foundation permissions; OWNER already has admin:all.
    const [manager] = await connection.query<any[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name = 'FB_MANAGER' LIMIT 1`);
    if (manager.length) {
      for (const [code] of permissions) {
        const [perm] = await connection.query<any[]>(`SELECT id FROM permissions WHERE code = ?`, [code]);
        if (perm.length) {
          await connection.query(`INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, [manager[0].id, perm[0].id]);
        }
      }
    }
  },

  down: async (connection: PoolConnection): Promise<void> => {
    // Remove only sprint-owned columns/constraints before dropping sprint-owned tables.
    const [customerFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_orders_customer'`);
    if (customerFk.length) await connection.query(`ALTER TABLE orders DROP FOREIGN KEY fk_orders_customer`);
    const [customerIdx] = await connection.query<any[]>(`SHOW INDEX FROM orders WHERE Key_name = 'idx_orders_customer'`);
    if (customerIdx.length) await connection.query(`ALTER TABLE orders DROP INDEX idx_orders_customer`);
    const [customerCol] = await connection.query<any[]>(`SHOW COLUMNS FROM orders LIKE 'customer_id'`);
    if (customerCol.length) await connection.query(`ALTER TABLE orders DROP COLUMN customer_id`);

    const [tableWaiterFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dining_tables' AND CONSTRAINT_NAME = 'fk_tables_assigned_waiter'`);
    if (tableWaiterFk.length) await connection.query(`ALTER TABLE dining_tables DROP FOREIGN KEY fk_tables_assigned_waiter`);
    const [tableWaiterIdx] = await connection.query<any[]>(`SHOW INDEX FROM dining_tables WHERE Key_name = 'idx_tables_assigned_waiter'`);
    if (tableWaiterIdx.length) await connection.query(`ALTER TABLE dining_tables DROP INDEX idx_tables_assigned_waiter`);
    const [tableNotes] = await connection.query<any[]>(`SHOW COLUMNS FROM dining_tables LIKE 'notes'`);
    if (tableNotes.length) await connection.query(`ALTER TABLE dining_tables DROP COLUMN notes`);
    const [tableWaiter] = await connection.query<any[]>(`SHOW COLUMNS FROM dining_tables LIKE 'assigned_waiter_id'`);
    if (tableWaiter.length) await connection.query(`ALTER TABLE dining_tables DROP COLUMN assigned_waiter_id`);

    const [menuDeptFk] = await connection.query<any[]>(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menu_items' AND CONSTRAINT_NAME = 'fk_menu_items_department'`);
    if (menuDeptFk.length) await connection.query(`ALTER TABLE menu_items DROP FOREIGN KEY fk_menu_items_department`);
    const [menuDeptIndex] = await connection.query<any[]>(`SHOW INDEX FROM menu_items WHERE Key_name = 'idx_menu_items_department'`);
    if (menuDeptIndex.length) await connection.query(`ALTER TABLE menu_items DROP INDEX idx_menu_items_department`);
    const [menuDept] = await connection.query<any[]>(`SHOW COLUMNS FROM menu_items LIKE 'department_id'`);
    if (menuDept.length) await connection.query(`ALTER TABLE menu_items DROP COLUMN department_id`);
    const [menuPrep] = await connection.query<any[]>(`SHOW COLUMNS FROM menu_items LIKE 'prep_time_minutes'`);
    if (menuPrep.length) await connection.query(`ALTER TABLE menu_items DROP COLUMN prep_time_minutes`);

    await connection.query('DROP TABLE IF EXISTS membership_usages');
    await connection.query('DROP TABLE IF EXISTS memberships');
    await connection.query('DROP TABLE IF EXISTS customers');
    await connection.query('DROP TABLE IF EXISTS user_table_access');
    await connection.query('DROP TABLE IF EXISTS user_section_access');
    await connection.query('DROP TABLE IF EXISTS departments');
  },
};
