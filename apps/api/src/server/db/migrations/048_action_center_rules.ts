import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

export const migration048ActionCenterRules: MigrationDefinition = {
  name: '048_action_center_rules',
  async up(connection: PoolConnection) {
    // Alerts are condition driven. Historical acknowledgements return to OPEN;
    // historical dismissals become resolved history. Operators can no longer
    // manually hide unresolved work.
    await connection.query(`
      UPDATE alerts
      SET status = 'OPEN', acknowledged_at = NULL, acknowledged_by = NULL
      WHERE status = 'ACKNOWLEDGED'
    `);
    await connection.query(`
      UPDATE alerts
      SET status = 'RESOLVED',
          resolved_at = COALESCE(resolved_at, dismissed_at, updated_at),
          condition_cleared_at = COALESCE(condition_cleared_at, dismissed_at, updated_at),
          dismissed_at = NULL,
          dismissed_by = NULL
      WHERE status = 'DISMISSED'
    `);

    // Legacy alerts that have no authoritative "work completed" condition in
    // the current product are kept as history instead of becoming impossible
    // to clear after manual resolution is removed. Reports/audit logs continue
    // to retain the underlying payment, variance, purchasing, security and
    // system events.
    await connection.query(`
      UPDATE alerts
      SET status = 'RESOLVED',
          resolved_at = COALESCE(resolved_at, updated_at, NOW()),
          condition_cleared_at = COALESCE(condition_cleared_at, updated_at, NOW()),
          updated_at = NOW()
      WHERE status = 'OPEN'
        AND type IN (
          'PAYMENT_REVERSAL','CASH_VARIANCE',
          'PO_AWAITING_APPROVAL','PO_OVERDUE','PO_PARTIAL_RECEIPT',
          'SECURITY_AUTH_FAILURE','SYSTEM_FAILURE'
        )
    `);

    // No timing rule is enabled until a manager explicitly configures it.
    await connection.query(`
      ALTER TABLE alert_settings
        MODIFY kot_delay_minutes INT UNSIGNED NULL DEFAULT NULL,
        MODIFY ready_not_served_minutes INT UNSIGNED NULL DEFAULT NULL,
        MODIFY long_table_minutes INT UNSIGNED NULL DEFAULT NULL,
        MODIFY unpaid_table_minutes INT UNSIGNED NULL DEFAULT NULL,
        MODIFY shift_open_minutes INT UNSIGNED NULL DEFAULT NULL
    `);
    await connection.query(`
      UPDATE alert_settings
      SET kot_delay_minutes = NULL,
          ready_not_served_minutes = NULL,
          long_table_minutes = NULL,
          unpaid_table_minutes = NULL,
          shift_open_minutes = NULL
    `);

    // These actions no longer exist in the product. Resolution comes only from
    // the authoritative business condition becoming false.
    await connection.query(`
      DELETE rp FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.code IN ('alerts.acknowledge','alerts.resolve','alerts.dismiss')
    `);
    await connection.query(`
      DELETE FROM permissions
      WHERE code IN ('alerts.acknowledge','alerts.resolve','alerts.dismiss')
    `);
  },
  async down(connection: PoolConnection) {
    // A rollback restores the legacy defaults for rows that are intentionally
    // NULL in the condition-driven model before making the columns NOT NULL.
    await connection.query(`
      UPDATE alert_settings
      SET kot_delay_minutes = COALESCE(kot_delay_minutes, 20),
          ready_not_served_minutes = COALESCE(ready_not_served_minutes, 8),
          long_table_minutes = COALESCE(long_table_minutes, 180),
          unpaid_table_minutes = COALESCE(unpaid_table_minutes, 240),
          shift_open_minutes = COALESCE(shift_open_minutes, 720)
    `);
    await connection.query(`
      ALTER TABLE alert_settings
        MODIFY kot_delay_minutes INT UNSIGNED NOT NULL DEFAULT 20,
        MODIFY ready_not_served_minutes INT UNSIGNED NOT NULL DEFAULT 8,
        MODIFY long_table_minutes INT UNSIGNED NOT NULL DEFAULT 180,
        MODIFY unpaid_table_minutes INT UNSIGNED NOT NULL DEFAULT 240,
        MODIFY shift_open_minutes INT UNSIGNED NOT NULL DEFAULT 720
    `);
    const permissions = [
      ['alerts.acknowledge', 'alerts', 'Acknowledge operational alerts'],
      ['alerts.resolve', 'alerts', 'Resolve operational alerts'],
      ['alerts.dismiss', 'alerts', 'Dismiss operational alerts'],
    ];
    for (const permission of permissions) {
      await connection.query(
        `INSERT INTO permissions(code,module,description) VALUES(?,?,?)
         ON DUPLICATE KEY UPDATE description=VALUES(description)`,
        permission,
      );
    }

    // Restore the role grants created by migration 023 so rolling back this
    // migration returns the legacy alert workflow to its original shape.
    const [roles]=await connection.query<RowDataPacket[]>(
      `SELECT id,name FROM roles WHERE organization_id IS NULL AND name IN ('FB_MANAGER','CASHIER','WAITER','CHEF')`,
    );
    const [perms]=await connection.query<RowDataPacket[]>(
      `SELECT id,code FROM permissions WHERE code IN ('alerts.acknowledge','alerts.resolve','alerts.dismiss')`,
    );
    const roleIds=new Map(roles.map((row)=>[String(row.name),Number(row.id)]));
    const permissionIds=new Map(perms.map((row)=>[String(row.code),Number(row.id)]));
    const grants:Record<string,string[]>={
      FB_MANAGER:['alerts.acknowledge','alerts.resolve','alerts.dismiss'],
      CASHIER:['alerts.acknowledge'],
      WAITER:['alerts.acknowledge'],
      CHEF:['alerts.acknowledge'],
    };
    for(const [role,codes] of Object.entries(grants)){
      const roleId=roleIds.get(role);
      if(!roleId) continue;
      for(const code of codes){
        const permissionId=permissionIds.get(code);
        if(permissionId) await connection.query(`INSERT IGNORE INTO role_permissions(role_id,permission_id) VALUES(?,?)`,[roleId,permissionId]);
      }
    }
  },
};
