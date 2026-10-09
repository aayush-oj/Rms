import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration023AlertsOperationalNotifications: MigrationDefinition = {
  name:'023_alerts_operational_notifications',
  up:async(c:PoolConnection)=>{
    const [prepSnapshotColumn]=await c.query<RowDataPacket[]>(`SHOW COLUMNS FROM kitchen_ticket_items LIKE 'prep_time_minutes_snapshot'`);
    if(!prepSnapshotColumn.length){
      await c.query(`ALTER TABLE kitchen_ticket_items ADD COLUMN prep_time_minutes_snapshot INT UNSIGNED NULL AFTER prep_station_name`);
      // Historical KOTs predate this snapshot. Backfill from migration-time menu configuration only;
      // all new KOTs snapshot the configured preparation time at creation.
      await c.query(`UPDATE kitchen_ticket_items kti JOIN menu_items mi ON mi.id=kti.menu_item_id SET kti.prep_time_minutes_snapshot=mi.prep_time_minutes WHERE kti.prep_time_minutes_snapshot IS NULL`);
    }
    await c.query(`CREATE TABLE IF NOT EXISTS alerts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      organization_id BIGINT UNSIGNED NOT NULL,
      branch_id BIGINT UNSIGNED NOT NULL,
      dedup_key VARCHAR(191) NOT NULL,
      type VARCHAR(80) NOT NULL,
      category ENUM('KITCHEN','SERVICE','TABLE','PAYMENT','SHIFT','BUSINESS_DAY','INVENTORY','PURCHASING','EXPENSE','SECURITY','SYSTEM') NOT NULL,
      severity ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'WARNING',
      title VARCHAR(180) NOT NULL,
      message VARCHAR(700) NOT NULL,
      entity_type VARCHAR(80) NULL,
      entity_id VARCHAR(80) NULL,
      status ENUM('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
      audience_type ENUM('USER','ROLE','BRANCH','TABLE_ASSIGNMENT','PERMISSION_GROUP') NOT NULL,
      audience_reference VARCHAR(191) NULL,
      metadata_json JSON NULL,
      acknowledged_at DATETIME NULL,
      acknowledged_by BIGINT UNSIGNED NULL,
      resolved_at DATETIME NULL,
      resolved_by BIGINT UNSIGNED NULL,
      dismissed_at DATETIME NULL,
      dismissed_by BIGINT UNSIGNED NULL,
      condition_cleared_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      active_dedup_key VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN status IN ('OPEN','ACKNOWLEDGED') THEN dedup_key ELSE NULL END) STORED,
      UNIQUE KEY uk_alert_active_condition (organization_id,branch_id,active_dedup_key),
      INDEX idx_alert_scope_status (organization_id,branch_id,status,created_at),
      INDEX idx_alert_severity (organization_id,branch_id,severity,status,created_at),
      INDEX idx_alert_type_entity (organization_id,branch_id,type,entity_type,entity_id,status),
      INDEX idx_alert_audience (organization_id,branch_id,audience_type,audience_reference,status),
      CONSTRAINT fk_alert_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_alert_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
      CONSTRAINT fk_alert_ack_by FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_alert_resolved_by FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_alert_dismissed_by FOREIGN KEY (dismissed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await c.query(`CREATE TABLE IF NOT EXISTS alert_auth_failure_windows (
      organization_id BIGINT UNSIGNED NOT NULL,
      branch_id BIGINT UNSIGNED NOT NULL,
      account_user_id BIGINT UNSIGNED NOT NULL,
      failure_type VARCHAR(40) NOT NULL,
      window_started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      failure_count INT UNSIGNED NOT NULL DEFAULT 0,
      last_failed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(organization_id,branch_id,account_user_id,failure_type),
      INDEX idx_alert_auth_failure_time (organization_id,branch_id,last_failed_at),
      CONSTRAINT fk_alert_auth_failure_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_alert_auth_failure_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      CONSTRAINT fk_alert_auth_failure_user FOREIGN KEY (account_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await c.query(`CREATE TABLE IF NOT EXISTS alert_settings (
      organization_id BIGINT UNSIGNED NOT NULL,
      branch_id BIGINT UNSIGNED NOT NULL,
      kot_delay_minutes INT UNSIGNED NOT NULL DEFAULT 20,
      ready_not_served_minutes INT UNSIGNED NOT NULL DEFAULT 8,
      long_table_minutes INT UNSIGNED NOT NULL DEFAULT 180,
      unpaid_table_minutes INT UNSIGNED NOT NULL DEFAULT 240,
      shift_open_minutes INT UNSIGNED NOT NULL DEFAULT 720,
      cash_variance_warning DECIMAL(12,2) NOT NULL DEFAULT 500.00,
      cash_variance_critical DECIMAL(12,2) NOT NULL DEFAULT 2000.00,
      low_stock_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      po_overdue_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(organization_id,branch_id),
      CONSTRAINT fk_alert_settings_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      CONSTRAINT fk_alert_settings_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
      CONSTRAINT chk_alert_cash_thresholds CHECK (cash_variance_critical >= cash_variance_warning)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const permissions=[
      ['alerts.view','alerts','View operational alerts'],['alerts.acknowledge','alerts','Acknowledge operational alerts'],
      ['alerts.resolve','alerts','Resolve operational alerts'],['alerts.dismiss','alerts','Dismiss operational alerts'],
      ['alerts.settings.manage','alerts','Manage branch alert thresholds'],['alerts.security.view','alerts','View security alerts']
    ];
    for(const p of permissions) await c.query(`INSERT INTO permissions(code,module,description) VALUES(?,?,?) ON DUPLICATE KEY UPDATE description=VALUES(description)`,p);
    const [roles]=await c.query<RowDataPacket[]>(`SELECT id,name FROM roles WHERE organization_id IS NULL AND name IN ('FB_MANAGER','CASHIER','WAITER','CHEF')`);
    const [perms]=await c.query<RowDataPacket[]>(`SELECT id,code FROM permissions WHERE code LIKE 'alerts.%'`);
    const roleIds=new Map(roles.map(r=>[String(r.name),Number(r.id)])); const permIds=new Map(perms.map(r=>[String(r.code),Number(r.id)]));
    const grants:Record<string,string[]>={FB_MANAGER:['alerts.view','alerts.acknowledge','alerts.resolve','alerts.dismiss','alerts.settings.manage','alerts.security.view'],CASHIER:['alerts.view','alerts.acknowledge'],WAITER:['alerts.view','alerts.acknowledge'],CHEF:['alerts.view','alerts.acknowledge']};
    for(const [role,codes] of Object.entries(grants)) for(const code of codes){const rid=roleIds.get(role),pid=permIds.get(code);if(rid&&pid)await c.query(`INSERT IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)`,[rid,pid]);}
  },
  down:async(c:PoolConnection)=>{await c.query(`DROP TABLE IF EXISTS alert_auth_failure_windows`);await c.query(`DROP TABLE IF EXISTS alert_settings`);await c.query(`DROP TABLE IF EXISTS alerts`);await c.query(`DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.code LIKE 'alerts.%'`);await c.query(`DELETE FROM permissions WHERE code LIKE 'alerts.%'`);const [prepSnapshotColumn]=await c.query<RowDataPacket[]>(`SHOW COLUMNS FROM kitchen_ticket_items LIKE 'prep_time_minutes_snapshot'`);if(prepSnapshotColumn.length)await c.query(`ALTER TABLE kitchen_ticket_items DROP COLUMN prep_time_minutes_snapshot`);}
};
