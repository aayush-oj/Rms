import type { PoolConnection } from 'mysql2/promise';
import type { MigrationDefinition } from './types';

const INITIAL_BACKFILL_REASON = 'Initial entitlement backfill from organizations.status';

export const migration055OrganizationEntitlementFoundation: MigrationDefinition = {
  name: '055_organization_entitlement_foundation',

  up: async (connection: PoolConnection): Promise<void> => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS organization_entitlements (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        access_status ENUM(
          'PENDING',
          'TRIAL',
          'ACTIVE',
          'GRACE_PERIOD',
          'SUSPENDED',
          'SECURITY_SUSPENDED',
          'CANCELLED'
        ) NOT NULL,
        trial_started_at DATETIME NULL,
        trial_ends_at DATETIME NULL,
        activated_at DATETIME NULL,
        access_ends_at DATETIME NULL,
        grace_ends_at DATETIME NULL,
        scheduled_suspension_at DATETIME NULL,
        suspended_at DATETIME NULL,
        cancelled_at DATETIME NULL,
        internal_reason TEXT NULL,
        customer_message TEXT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_organization_entitlement_org (organization_id),
        INDEX idx_organization_entitlement_status (access_status),
        INDEX idx_organization_entitlement_scheduled_suspension (scheduled_suspension_at),
        INDEX idx_organization_entitlement_access_end (access_ends_at),
        CONSTRAINT fk_organization_entitlement_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS organization_status_history (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        organization_id BIGINT UNSIGNED NOT NULL,
        from_status ENUM(
          'PENDING',
          'TRIAL',
          'ACTIVE',
          'GRACE_PERIOD',
          'SUSPENDED',
          'SECURITY_SUSPENDED',
          'CANCELLED'
        ) NULL,
        to_status ENUM(
          'PENDING',
          'TRIAL',
          'ACTIVE',
          'GRACE_PERIOD',
          'SUSPENDED',
          'SECURITY_SUSPENDED',
          'CANCELLED'
        ) NOT NULL,
        effective_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reason VARCHAR(500) NULL,
        customer_message TEXT NULL,
        platform_admin_id BIGINT UNSIGNED NULL,
        source ENUM(
          'REGISTRATION',
          'PLATFORM_ADMIN',
          'SCHEDULED_JOB',
          'ACTIVATION_REQUEST',
          'SYSTEM'
        ) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_organization_status_history_org (organization_id, effective_at),
        INDEX idx_organization_status_history_status (to_status),
        INDEX idx_organization_status_history_admin (platform_admin_id),
        CONSTRAINT fk_organization_status_history_org
          FOREIGN KEY (organization_id)
          REFERENCES organizations(id)
          ON DELETE RESTRICT,
        CONSTRAINT fk_organization_status_history_admin
          FOREIGN KEY (platform_admin_id)
          REFERENCES platform_admins(id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Import only the legacy state we actually know. Historical activation,
    // suspension, trial and expiry timestamps were not recorded reliably, so
    // those fields intentionally remain NULL rather than being fabricated.
    await connection.query(`
      INSERT INTO organization_entitlements (
        organization_id,
        access_status,
        version
      )
      SELECT
        o.id,
        CASE o.status
          WHEN 'SUSPENDED' THEN 'SUSPENDED'
          WHEN 'PENDING' THEN 'PENDING'
          ELSE 'ACTIVE'
        END,
        1
      FROM organizations o
      LEFT JOIN organization_entitlements e
        ON e.organization_id = o.id
      WHERE e.id IS NULL;
    `);

    // Record the point where the legacy organization status was adopted by the
    // new lifecycle model. effective_at is the migration/import time, not a
    // claim about when the restaurant originally entered that legacy state.
    await connection.execute(
      `INSERT INTO organization_status_history (
         organization_id,
         from_status,
         to_status,
         effective_at,
         reason,
         customer_message,
         platform_admin_id,
         source
       )
       SELECT
         o.id,
         NULL,
         e.access_status,
         NOW(),
         ?,
         NULL,
         NULL,
         'SYSTEM'
       FROM organizations o
       INNER JOIN organization_entitlements e
         ON e.organization_id = o.id
       WHERE NOT EXISTS (
         SELECT 1
         FROM organization_status_history h
         WHERE h.organization_id = o.id
           AND h.source = 'SYSTEM'
           AND h.reason = ?
       )`,
      [INITIAL_BACKFILL_REASON, INITIAL_BACKFILL_REASON]
    );
  },

  down: async (connection: PoolConnection): Promise<void> => {
    await connection.query('DROP TABLE IF EXISTS organization_status_history');
    await connection.query('DROP TABLE IF EXISTS organization_entitlements');
  },
};
