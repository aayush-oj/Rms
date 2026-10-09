import { PoolConnection } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration018Purchasing: MigrationDefinition = {
  name: '018_purchasing',
  up: async (c: PoolConnection) => {
    await c.query(`CREATE TABLE IF NOT EXISTS suppliers (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL,
      code VARCHAR(50) NOT NULL, name VARCHAR(180) NOT NULL, legal_name VARCHAR(180) NULL,
      contact_person VARCHAR(120) NULL, phone VARCHAR(50) NULL, email VARCHAR(180) NULL, address VARCHAR(500) NULL,
      tax_identifier VARCHAR(100) NULL, payment_terms VARCHAR(120) NULL, notes VARCHAR(1000) NULL,
      status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_supplier_org_code (organization_id, code), INDEX idx_supplier_org_status (organization_id,status),
      CONSTRAINT fk_supplier_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS supplier_contacts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, supplier_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(120) NOT NULL, role VARCHAR(100) NULL, phone VARCHAR(50) NULL, email VARCHAR(180) NULL, notes VARCHAR(500) NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_supplier_contact_email (supplier_id,email), INDEX idx_supplier_contacts (organization_id,supplier_id),
      CONSTRAINT fk_supplier_contact_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_contact_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS supplier_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, branch_id BIGINT UNSIGNED NOT NULL, supplier_id BIGINT UNSIGNED NOT NULL,
      inventory_item_id BIGINT UNSIGNED NOT NULL, supplier_item_code VARCHAR(100) NULL, purchase_unit_id BIGINT UNSIGNED NOT NULL,
      conversion_to_inventory_unit DECIMAL(18,6) NOT NULL DEFAULT 1, unit_price DECIMAL(18,4) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'NPR', minimum_order_quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
      lead_time_days INT UNSIGNED NOT NULL DEFAULT 0, is_preferred BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from DATE NULL, effective_to DATE NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_supplier_item (organization_id,branch_id,supplier_id,inventory_item_id), INDEX idx_supplier_items_org (organization_id,branch_id,supplier_id,is_active),
      CONSTRAINT fk_supplier_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_item_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_supplier_item_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      CONSTRAINT fk_supplier_item_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
      CONSTRAINT fk_supplier_item_unit FOREIGN KEY (purchase_unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
      CONSTRAINT chk_supplier_conversion_positive CHECK (conversion_to_inventory_unit > 0),
      CONSTRAINT chk_supplier_price_nonnegative CHECK (unit_price >= 0),
      CONSTRAINT chk_supplier_moq_nonnegative CHECK (minimum_order_quantity >= 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS supplier_item_price_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, supplier_item_id BIGINT UNSIGNED NOT NULL,
      unit_price DECIMAL(18,4) NOT NULL, currency VARCHAR(10) NOT NULL, effective_from DATE NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_supplier_price_history (organization_id,supplier_item_id,effective_from),
      CONSTRAINT fk_supplier_price_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_supplier_price_supplier_item FOREIGN KEY (supplier_item_id) REFERENCES supplier_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS purchase_orders (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, branch_id BIGINT UNSIGNED NOT NULL,
      supplier_id BIGINT UNSIGNED NOT NULL, po_number VARCHAR(80) NOT NULL,
      status ENUM('DRAFT','PENDING_APPROVAL','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
      order_date DATE NOT NULL, expected_delivery_date DATE NULL, currency VARCHAR(10) NOT NULL DEFAULT 'NPR',
      subtotal DECIMAL(18,2) NOT NULL DEFAULT 0, discount DECIMAL(18,2) NOT NULL DEFAULT 0, tax DECIMAL(18,2) NOT NULL DEFAULT 0,
      grand_total DECIMAL(18,2) NOT NULL DEFAULT 0, notes VARCHAR(1000) NULL, created_by BIGINT UNSIGNED NOT NULL,
      approved_by BIGINT UNSIGNED NULL, approved_at DATETIME NULL, cancelled_by BIGINT UNSIGNED NULL, cancelled_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_po_org_number (organization_id,po_number), INDEX idx_po_branch_status_date (organization_id,branch_id,status,order_date), INDEX idx_po_supplier (organization_id,supplier_id,order_date),
      CONSTRAINT fk_po_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_po_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS purchase_order_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, branch_id BIGINT UNSIGNED NOT NULL,
      purchase_order_id BIGINT UNSIGNED NOT NULL, inventory_item_id BIGINT UNSIGNED NOT NULL, description_snapshot VARCHAR(180) NOT NULL,
      purchase_unit_id BIGINT UNSIGNED NOT NULL, inventory_unit_id BIGINT UNSIGNED NOT NULL, conversion_factor DECIMAL(18,6) NOT NULL,
      ordered_quantity DECIMAL(18,4) NOT NULL, received_quantity DECIMAL(18,4) NOT NULL DEFAULT 0, accepted_quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
      rejected_quantity DECIMAL(18,4) NOT NULL DEFAULT 0, unit_price DECIMAL(18,4) NOT NULL, discount DECIMAL(18,2) NOT NULL DEFAULT 0,
      tax DECIMAL(18,2) NOT NULL DEFAULT 0, line_total DECIMAL(18,2) NOT NULL, notes VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_po_items_order (purchase_order_id), INDEX idx_po_items_inventory (organization_id,branch_id,inventory_item_id),
      CONSTRAINT fk_po_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_po_item_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_item_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_item_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_item_purchase_unit FOREIGN KEY (purchase_unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_item_inventory_unit FOREIGN KEY (inventory_unit_id) REFERENCES units_of_measure(id) ON DELETE RESTRICT,
      CONSTRAINT chk_po_item_qty CHECK (ordered_quantity > 0 AND received_quantity >= 0 AND accepted_quantity >= 0 AND rejected_quantity >= 0),
      CONSTRAINT chk_po_item_conversion CHECK (conversion_factor > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS purchase_receipts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, branch_id BIGINT UNSIGNED NOT NULL,
      purchase_order_id BIGINT UNSIGNED NOT NULL, supplier_id BIGINT UNSIGNED NOT NULL, status ENUM('COMPLETED') NOT NULL DEFAULT 'COMPLETED',
      received_by BIGINT UNSIGNED NOT NULL, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, idempotency_key VARCHAR(100) NOT NULL, notes VARCHAR(1000) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_receipt_idempotency (organization_id,branch_id,idempotency_key),
      INDEX idx_receipts_po (organization_id,branch_id,purchase_order_id,received_at),
      CONSTRAINT fk_receipt_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_receipt_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_receipt_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE RESTRICT,
      CONSTRAINT fk_receipt_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      CONSTRAINT fk_receipt_user FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await c.query(`CREATE TABLE IF NOT EXISTS purchase_receipt_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, organization_id BIGINT UNSIGNED NOT NULL, branch_id BIGINT UNSIGNED NOT NULL,
      receipt_id BIGINT UNSIGNED NOT NULL, purchase_order_item_id BIGINT UNSIGNED NOT NULL, ordered_quantity DECIMAL(18,4) NOT NULL,
      received_quantity DECIMAL(18,4) NOT NULL, accepted_quantity DECIMAL(18,4) NOT NULL, rejected_quantity DECIMAL(18,4) NOT NULL,
      inventory_quantity DECIMAL(18,4) NOT NULL, unit_price DECIMAL(18,4) NOT NULL, notes VARCHAR(500) NULL,
      UNIQUE KEY uk_receipt_item (receipt_id,purchase_order_item_id), INDEX idx_receipt_items_po_item (organization_id,branch_id,purchase_order_item_id),
      CONSTRAINT fk_receipt_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_receipt_item_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_receipt_item_receipt FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
      CONSTRAINT fk_receipt_item_po_item FOREIGN KEY (purchase_order_item_id) REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
      CONSTRAINT chk_receipt_item_quantities CHECK (received_quantity >= accepted_quantity AND received_quantity >= rejected_quantity AND accepted_quantity >= 0 AND rejected_quantity >= 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const permissions = [
      ['suppliers:view','purchasing','View suppliers'],['suppliers:create','purchasing','Create suppliers'],['suppliers:update','purchasing','Update suppliers'],
      ['purchasing:view','purchasing','View purchase orders and receiving'],['purchasing:create','purchasing','Create purchase orders'],['purchasing:update','purchasing','Update draft purchase orders'],
      ['purchasing:submit','purchasing','Submit purchase orders for approval'],['purchasing:approve','purchasing','Approve purchase orders'],['purchasing:order','purchasing','Mark approved purchase orders as ordered'],['purchasing:cancel','purchasing','Cancel purchase orders'],['purchasing:receive','purchasing','Receive purchase orders'],['purchasing:history:view','purchasing','View purchasing history']
    ];
    for (const p of permissions) await c.query(`INSERT INTO permissions (code,module,description) VALUES (?,?,?) ON DUPLICATE KEY UPDATE description=VALUES(description)`,p);
    const [manager] = await c.query<any[]>(`SELECT id FROM roles WHERE organization_id IS NULL AND name='FB_MANAGER' LIMIT 1`);
    if (manager.length) for (const [code] of permissions) { const [pr]=await c.query<any[]>(`SELECT id FROM permissions WHERE code=? LIMIT 1`,[code]); if(pr.length) await c.query(`INSERT IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)`,[manager[0].id,pr[0].id]); }
  },
  down: async (c: PoolConnection) => {
    await c.query('DROP TABLE IF EXISTS purchase_receipt_items'); await c.query('DROP TABLE IF EXISTS purchase_receipts'); await c.query('DROP TABLE IF EXISTS purchase_order_items'); await c.query('DROP TABLE IF EXISTS purchase_orders'); await c.query('DROP TABLE IF EXISTS supplier_item_price_history'); await c.query('DROP TABLE IF EXISTS supplier_items'); await c.query('DROP TABLE IF EXISTS supplier_contacts'); await c.query('DROP TABLE IF EXISTS suppliers');
  }
};
