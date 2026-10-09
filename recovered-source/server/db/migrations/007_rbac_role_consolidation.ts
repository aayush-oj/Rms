import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { MigrationDefinition } from './types';

/**
 * Migration 007: RBAC Role Consolidation
 *
 * Consolidates 7 system roles (OWNER, ADMIN, MANAGER, CASHIER, WAITER, CHEF, BARTENDER)
 * down to 5 authoritative system roles (OWNER, FB_MANAGER, CASHIER, WAITER, CHEF).
 *
 * Adds user_permissions table for per-user permission overrides (GRANTED/DENIED).
 * Adds dashboard:view permission for permission-driven frontend navigation.
 *
 * Safe sequence:
 * 1. Create user_permissions table
 * 2. Ensure all required permissions exist
 * 3. Ensure target roles exist
 * 4. Resolve target role IDs
 * 5. Migrate ADMIN users → FB_MANAGER
 * 6. Migrate MANAGER users → FB_MANAGER
 * 7. Migrate BARTENDER users → WAITER
 * 8. Verify no users still reference deprecated roles
 * 9. Remove deprecated role-permission mappings
 * 10. Remove deprecated roles
 * 11. Rebuild role-permission mappings for 5 system roles
 * 12. Add dashboard:view mappings
 * 13. Verify migration invariants
 */

// Target 5 system roles and their default permissions
const TARGET_ROLES: Record<string, string[]> = {
  OWNER: ['admin:all'],
  FB_MANAGER: [
    'admin:org:manage',
    'admin:branches:manage',
    'admin:users:manage',
    'admin:tables:manage',
    'admin:hardware:manage',
    'admin:taxes:manage',
    'admin:payments:manage',
    'admin:units:manage',
    'admin:settings:manage',
    'admin:menus:manage',
    'admin:system:status',
    'dashboard:view',
    'pos:orders:create',
    'pos:orders:view',
    'pos:orders:void',
    'pos:tables:manage',
    'pos:tables:allocate',
    'pos:billing:settle',
    'pos:discounts:apply',
    'kitchen:tickets:view',
    'kitchen:tickets:update',
    'bar:tickets:view',
    'bar:tickets:update',
    'inventory:view',
    'inventory:manage',
    'reports:view',
  ],
  CASHIER: [
    'dashboard:view',
    'pos:orders:create',
    'pos:orders:view',
    'pos:tables:manage',
    'pos:billing:settle',
    'reports:view',
  ],
  WAITER: [
    'dashboard:view',
    'pos:orders:create',
    'pos:orders:view',
    'pos:tables:manage',
  ],
  CHEF: [
    'dashboard:view',
    'kitchen:tickets:view',
    'kitchen:tickets:update',
    'inventory:view',
  ],
};

const ALL_PERMISSIONS: { code: string; module: string; description: string }[] = [
  { code: 'admin:all', module: 'admin', description: 'Full administrative access across organization' },
  { code: 'admin:org:manage', module: 'admin', description: 'Manage organization profile, settings, legal details' },
  { code: 'admin:branches:manage', module: 'admin', description: 'Create and configure restaurant branches' },
  { code: 'admin:users:manage', module: 'admin', description: 'Create and manage user accounts and branch assignments' },
  { code: 'admin:roles:manage', module: 'admin', description: 'Manage role assignments and permission policies' },
  { code: 'admin:tables:manage', module: 'admin', description: 'Create and configure floors, sections, and dining tables' },
  { code: 'admin:hardware:manage', module: 'admin', description: 'Configure thermal printers and preparation stations' },
  { code: 'admin:taxes:manage', module: 'admin', description: 'Manage branch VAT registration and pricing configuration' },
  { code: 'admin:payments:manage', module: 'admin', description: 'Configure payment methods, tenders, and QR gateways' },
  { code: 'admin:units:manage', module: 'admin', description: 'Manage units of measure, dimensions, and conversion factors' },
  { code: 'admin:settings:manage', module: 'admin', description: 'Configure organization and branch operational settings' },
  { code: 'admin:menus:manage', module: 'admin', description: 'Manage menu categories, items, modifiers, and catalog configuration' },
  { code: 'admin:system:status', module: 'admin', description: 'View system health, migrations, and internal status' },
  { code: 'dashboard:view', module: 'dashboard', description: 'View dashboard and main navigation' },
  { code: 'pos:orders:create', module: 'pos', description: 'Create and append dining room and takeaway orders' },
  { code: 'pos:orders:view', module: 'pos', description: 'View floor plans and active orders' },
  { code: 'pos:orders:void', module: 'pos', description: 'Void or cancel ordered items or tickets' },
  { code: 'pos:tables:manage', module: 'pos', description: 'Seat, transfer, merge, and clear tables' },
  { code: 'pos:tables:allocate', module: 'pos', description: 'Manage waiter table assignments and allocations' },
  { code: 'pos:billing:settle', module: 'pos', description: 'Settle checks, process cash/QR/card payments' },
  { code: 'pos:discounts:apply', module: 'pos', description: 'Apply promotional or manager discounts to bills' },
  { code: 'kitchen:tickets:view', module: 'kitchen', description: 'View Kitchen Display System (KDS) order tickets' },
  { code: 'kitchen:tickets:update', module: 'kitchen', description: 'Bump ticket status (Queued -> Preparing -> Ready)' },
  { code: 'bar:tickets:view', module: 'bar', description: 'View Bar Display System order tickets' },
  { code: 'bar:tickets:update', module: 'bar', description: 'Bump beverage ticket status' },
  { code: 'inventory:view', module: 'inventory', description: 'Inspect branch ingredient and inventory stock' },
  { code: 'inventory:manage', module: 'inventory', description: 'Record adjustments, waste logs, and stock counts' },
  { code: 'reports:view', module: 'reports', description: 'Access branch and consolidated executive reports' },
];

const DEPRECATED_ROLES = ['ADMIN', 'MANAGER', 'BARTENDER'];

export const migration007RbacRoleConsolidation: MigrationDefinition = {
  name: '007_rbac_role_consolidation',
  up: async (connection: PoolConnection): Promise<void> => {
    // ==========================================
    // STEP 1: Create user_permissions table
    // ==========================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id         BIGINT UNSIGNED NOT NULL,
        permission_id   BIGINT UNSIGNED NOT NULL,
        organization_id BIGINT UNSIGNED NOT NULL,
        effect          ENUM('GRANTED', 'DENIED') NOT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_perm_org (user_id, permission_id, organization_id),
        INDEX idx_up_user (user_id),
        INDEX idx_up_org (organization_id),
        CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_up_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
        CONSTRAINT fk_up_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // ==========================================
    // STEP 2: Ensure all required permissions exist
    // ==========================================
    for (const perm of ALL_PERMISSIONS) {
      await connection.query(
        `INSERT INTO permissions (code, module, description) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE code = code`,
        [perm.code, perm.module, perm.description]
      );
    }

    // ==========================================
    // STEP 3: Ensure target roles exist
    // ==========================================
    for (const roleName of Object.keys(TARGET_ROLES)) {
      await connection.query(
        `INSERT INTO roles (organization_id, name, description, is_system)
         VALUES (NULL, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE name = name`,
        [roleName, `Standard system ${roleName} role`]
      );
    }

    // ==========================================
    // STEP 4: Resolve target role IDs
    // ==========================================
    const [targetRoleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, name FROM roles WHERE organization_id IS NULL
       AND name IN ('OWNER', 'FB_MANAGER', 'CASHIER', 'WAITER', 'CHEF')`
    );
    const targetRoleIds = new Map<string, number>();
    for (const row of targetRoleRows) {
      targetRoleIds.set(row.name as string, Number(row.id));
    }

    const fbManagerId = targetRoleIds.get('FB_MANAGER');
    const waiterId = targetRoleIds.get('WAITER');

    if (!fbManagerId || !waiterId) {
      throw new Error(`Migration 007 failed: Target role IDs not found. FB_MANAGER=${fbManagerId}, WAITER=${waiterId}`);
    }

    // ==========================================
    // STEP 5: Migrate ADMIN users → FB_MANAGER
    // ==========================================
    const [adminRoleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM roles WHERE name = 'ADMIN' AND organization_id IS NULL`
    );
    if (adminRoleRows.length > 0) {
      const adminRoleId = Number(adminRoleRows[0].id);
      await connection.query(
        `UPDATE users SET role_id = ? WHERE role_id = ?`,
        [fbManagerId, adminRoleId]
      );
    }

    // ==========================================
    // STEP 6: Migrate MANAGER users → FB_MANAGER
    // ==========================================
    const [managerRoleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM roles WHERE name = 'MANAGER' AND organization_id IS NULL`
    );
    if (managerRoleRows.length > 0) {
      const managerRoleId = Number(managerRoleRows[0].id);
      await connection.query(
        `UPDATE users SET role_id = ? WHERE role_id = ?`,
        [fbManagerId, managerRoleId]
      );
    }

    // ==========================================
    // STEP 7: Migrate BARTENDER users → WAITER
    // ==========================================
    const [bartenderRoleRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM roles WHERE name = 'BARTENDER' AND organization_id IS NULL`
    );
    if (bartenderRoleRows.length > 0) {
      const bartenderRoleId = Number(bartenderRoleRows[0].id);
      await connection.query(
        `UPDATE users SET role_id = ? WHERE role_id = ?`,
        [waiterId, bartenderRoleId]
      );
    }

    // ==========================================
    // STEP 8: Verify no users still reference deprecated roles
    // ==========================================
    const [orphanUsers] = await connection.execute<RowDataPacket[]>(
      `SELECT u.id, u.name, r.name AS role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name IN ('ADMIN', 'MANAGER', 'BARTENDER') AND r.organization_id IS NULL`
    );
    if (orphanUsers.length > 0) {
      const details = orphanUsers.map((u: RowDataPacket) => `User #${u.id} (${u.name}) has role ${u.role_name}`).join('; ');
      throw new Error(
        `Migration 007 integrity check failed: ${orphanUsers.length} user(s) still reference deprecated roles. ${details}`
      );
    }

    // ==========================================
    // STEP 9: Remove deprecated role-permission mappings
    // ==========================================
    for (const deprecatedRole of DEPRECATED_ROLES) {
      await connection.query(
        `DELETE rp FROM role_permissions rp
         JOIN roles r ON rp.role_id = r.id
         WHERE r.name = ? AND r.organization_id IS NULL`,
        [deprecatedRole]
      );
    }

    // ==========================================
    // STEP 10: Remove deprecated roles
    // ==========================================
    for (const deprecatedRole of DEPRECATED_ROLES) {
      await connection.query(
        `DELETE FROM roles WHERE name = ? AND organization_id IS NULL`,
        [deprecatedRole]
      );
    }

    // ==========================================
    // STEP 11: Rebuild role-permission mappings for 5 system roles
    // ==========================================
    // First, clear all existing system role permissions
    await connection.query(
      `DELETE rp FROM role_permissions rp
       JOIN roles r ON rp.role_id = r.id
       WHERE r.organization_id IS NULL`
    );

    // Resolve all permission IDs
    const [permRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, code FROM permissions`
    );
    const permIdMap = new Map<string, number>();
    for (const row of permRows) {
      permIdMap.set(row.code as string, Number(row.id));
    }

    // Seed role_permissions for each target role
    for (const [roleName, permCodes] of Object.entries(TARGET_ROLES)) {
      const roleId = targetRoleIds.get(roleName);
      if (!roleId) continue;

      for (const permCode of permCodes) {
        const permId = permIdMap.get(permCode);
        if (permId) {
          await connection.query(
            `INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`,
            [roleId, permId]
          );
        }
      }
    }

    // ==========================================
    // STEP 12: Verify dashboard:view is in all non-OWNER role mappings
    // ==========================================
    // (Already handled by Step 11 since TARGET_ROLES includes dashboard:view)

    // ==========================================
    // STEP 13: Verify migration invariants
    // ==========================================

    // Check 1: No users reference deprecated roles
    const [check1] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name IN ('ADMIN', 'MANAGER', 'BARTENDER') AND r.organization_id IS NULL`
    );
    if (Number(check1[0].cnt) > 0) {
      throw new Error(`Migration 007 invariant failed: ${check1[0].cnt} user(s) still reference deprecated roles`);
    }

    // Check 2: All 5 target roles exist
    const [check2] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM roles
       WHERE organization_id IS NULL
       AND name IN ('OWNER', 'FB_MANAGER', 'CASHIER', 'WAITER', 'CHEF')`
    );
    if (Number(check2[0].cnt) !== 5) {
      throw new Error(`Migration 007 invariant failed: Expected 5 target roles, found ${check2[0].cnt}`);
    }

    // Check 3: No deprecated roles remain
    const [check3] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM roles
       WHERE organization_id IS NULL
       AND name IN ('ADMIN', 'MANAGER', 'BARTENDER')`
    );
    if (Number(check3[0].cnt) > 0) {
      throw new Error(`Migration 007 invariant failed: ${check3[0].cnt} deprecated role(s) still exist`);
    }

    // Check 4: Every non-OWNER system role has at least one permission
    const [check4] = await connection.execute<RowDataPacket[]>(
      `SELECT r.name, COUNT(rp.permission_id) AS perm_count
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.organization_id IS NULL AND r.name != 'OWNER'
       GROUP BY r.name
       HAVING perm_count = 0`
    );
    if (check4.length > 0) {
      const roles = check4.map((r: RowDataPacket) => r.name).join(', ');
      throw new Error(`Migration 007 invariant failed: Role(s) [${roles}] have no permissions assigned`);
    }

    // Check 5: OWNER has admin:all
    const [check5] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM role_permissions rp
       JOIN roles r ON rp.role_id = r.id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE r.name = 'OWNER' AND p.code = 'admin:all' AND r.organization_id IS NULL`
    );
    if (Number(check5[0].cnt) !== 1) {
      throw new Error(`Migration 007 invariant failed: OWNER does not have admin:all permission`);
    }

    // Check 6: dashboard:view permission exists and is assigned to FB_MANAGER, CASHIER, WAITER, CHEF
    const [check6] = await connection.execute<RowDataPacket[]>(
      `SELECT r.name FROM role_permissions rp
       JOIN roles r ON rp.role_id = r.id
       JOIN permissions p ON rp.permission_id = p.id
       WHERE p.code = 'dashboard:view' AND r.organization_id IS NULL
       ORDER BY r.name`
    );
    const dashboardRoles = check6.map((r: RowDataPacket) => r.name);
    const expectedDashboardRoles = ['CASHIER', 'CHEF', 'FB_MANAGER', 'WAITER'];
    if (JSON.stringify(dashboardRoles) !== JSON.stringify(expectedDashboardRoles)) {
      throw new Error(
        `Migration 007 invariant failed: dashboard:view assigned to [${dashboardRoles.join(', ')}], expected [${expectedDashboardRoles.join(', ')}]`
      );
    }

    // Check 7: user_permissions table exists
    const [check7] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_name = 'user_permissions' AND table_schema = DATABASE()`
    );
    if (Number(check7[0].cnt) !== 1) {
      throw new Error(`Migration 007 invariant failed: user_permissions table does not exist`);
    }
  },
};
