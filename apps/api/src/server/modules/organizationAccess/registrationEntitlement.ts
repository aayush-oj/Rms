import type { PoolConnection } from 'mysql2/promise';

export const REGISTRATION_REASON =
  'Organization registered; awaiting platform activation';

export const REGISTRATION_CUSTOMER_MESSAGE =
  'Registration received. Your MIH DineOS workspace is awaiting activation.';

/**
 * Creates the initial PENDING organization entitlement and append-only
 * REGISTRATION history inside a transaction owned by the caller.
 *
 * This helper deliberately does not begin, commit, or roll back. Registration
 * can therefore create organization identity + entitlement + history as one
 * atomic unit without nesting another database transaction.
 *
 * Callers must guarantee that:
 * - the organization row already exists in the same transaction or is committed;
 * - no current entitlement exists for the organization.
 */
export async function createPendingRegistrationEntitlementInTransaction(
  connection: PoolConnection,
  organizationId: number,
): Promise<void> {
  await connection.execute(
    `INSERT INTO organization_entitlements (
       organization_id,
       access_status,
       internal_reason,
       customer_message,
       version
     )
     VALUES (?, 'PENDING', ?, ?, 1)`,
    [
      organizationId,
      REGISTRATION_REASON,
      REGISTRATION_CUSTOMER_MESSAGE,
    ],
  );

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
     VALUES (?, NULL, 'PENDING', NOW(), ?, ?, NULL, 'REGISTRATION')`,
    [
      organizationId,
      REGISTRATION_REASON,
      REGISTRATION_CUSTOMER_MESSAGE,
    ],
  );
}
