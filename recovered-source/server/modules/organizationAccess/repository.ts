import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { createPendingRegistrationEntitlementInTransaction } from './registrationEntitlement';
import type {
  AtomicOrganizationTransition,
  OrganizationAccessStatus,
  OrganizationEntitlement,
  OrganizationStatusHistoryEntry,
} from './types';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toNullableIso(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function mapEntitlement(row: RowDataPacket): OrganizationEntitlement {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    accessStatus: String(row.access_status) as OrganizationAccessStatus,
    trialStartedAt: toNullableIso(row.trial_started_at),
    trialEndsAt: toNullableIso(row.trial_ends_at),
    activatedAt: toNullableIso(row.activated_at),
    accessEndsAt: toNullableIso(row.access_ends_at),
    graceEndsAt: toNullableIso(row.grace_ends_at),
    scheduledSuspensionAt: toNullableIso(row.scheduled_suspension_at),
    scheduledSuspensionReason:
      row.scheduled_suspension_reason == null
        ? null
        : String(row.scheduled_suspension_reason),
    scheduledSuspensionCustomerMessage:
      row.scheduled_suspension_customer_message == null
        ? null
        : String(row.scheduled_suspension_customer_message),
    suspendedAt: toNullableIso(row.suspended_at),
    cancelledAt: toNullableIso(row.cancelled_at),
    internalReason: row.internal_reason == null ? null : String(row.internal_reason),
    customerMessage: row.customer_message == null ? null : String(row.customer_message),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapHistory(row: RowDataPacket): OrganizationStatusHistoryEntry {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    fromStatus: row.from_status == null
      ? null
      : String(row.from_status) as OrganizationAccessStatus,
    toStatus: String(row.to_status) as OrganizationAccessStatus,
    effectiveAt: toIso(row.effective_at),
    reason: row.reason == null ? null : String(row.reason),
    customerMessage: row.customer_message == null ? null : String(row.customer_message),
    platformAdminId: row.platform_admin_id == null ? null : Number(row.platform_admin_id),
    source: String(row.source) as OrganizationStatusHistoryEntry['source'],
    createdAt: toIso(row.created_at),
  };
}

type SqlExecutor = Pool | PoolConnection;

export class OrganizationEntitlementRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  private async findWithExecutor(
    executor: SqlExecutor,
    organizationId: number,
  ): Promise<OrganizationEntitlement | null> {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT
         id,
         organization_id,
         access_status,
         trial_started_at,
         trial_ends_at,
         activated_at,
         access_ends_at,
         grace_ends_at,
         scheduled_suspension_at,
         scheduled_suspension_reason,
         scheduled_suspension_customer_message,
         suspended_at,
         cancelled_at,
         internal_reason,
         customer_message,
         version,
         created_at,
         updated_at
       FROM organization_entitlements
       WHERE organization_id = ?
       LIMIT 1`,
      [organizationId],
    );

    return rows.length ? mapEntitlement(rows[0]) : null;
  }

  public async findByOrganizationId(
    organizationId: number,
  ): Promise<OrganizationEntitlement | null> {
    return this.findWithExecutor(this.pool, organizationId);
  }

  public async listHistory(
    organizationId: number,
  ): Promise<OrganizationStatusHistoryEntry[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
         id,
         organization_id,
         from_status,
         to_status,
         effective_at,
         reason,
         customer_message,
         platform_admin_id,
         source,
         created_at
       FROM organization_status_history
       WHERE organization_id = ?
       ORDER BY effective_at ASC, id ASC`,
      [organizationId],
    );

    return rows.map(mapHistory);
  }

  /**
   * Ensures the first-release registration entitlement exists.
   *
   * This method intentionally creates only PENDING. Lifecycle transitions to
   * TRIAL/ACTIVE/etc. belong to the later transition service, not registration.
   *
   * Locking the organization row serializes concurrent ensure calls so exactly
   * one entitlement and one registration-history row are created.
   */
  public async transitionAtomically(
    transition: AtomicOrganizationTransition,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT
           id,
           organization_id,
           access_status,
           trial_started_at,
           trial_ends_at,
           activated_at,
           access_ends_at,
           grace_ends_at,
           scheduled_suspension_at,
           suspended_at,
           cancelled_at,
           internal_reason,
           customer_message,
           version,
           created_at,
           updated_at
         FROM organization_entitlements
         WHERE organization_id = ?
         FOR UPDATE`,
        [transition.organizationId],
      );

      if (!rows.length) {
        throw new NotFoundError(
          'Organization entitlement not found',
          'ORGANIZATION_ENTITLEMENT_NOT_FOUND',
        );
      }

      const current = mapEntitlement(rows[0]);

      if (
        current.version !== transition.expectedVersion
        || current.accessStatus !== transition.expectedFromStatus
      ) {
        throw new ConflictError(
          'Organization entitlement changed before this lifecycle action could be applied',
          'ENTITLEMENT_VERSION_CONFLICT',
          {
            expectedVersion: transition.expectedVersion,
            currentVersion: current.version,
            expectedStatus: transition.expectedFromStatus,
            currentStatus: current.accessStatus,
          },
        );
      }

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_entitlements
            SET access_status = ?,
                trial_started_at = ?,
                trial_ends_at = ?,
                activated_at = ?,
                access_ends_at = ?,
                grace_ends_at = ?,
                scheduled_suspension_at = ?,
                scheduled_suspension_reason = ?,
                scheduled_suspension_customer_message = ?,
                suspended_at = ?,
                cancelled_at = ?,
                internal_reason = ?,
                customer_message = ?,
                version = version + 1,
                updated_at = NOW()
          WHERE organization_id = ?
            AND version = ?`,
        [
          transition.next.accessStatus,
          transition.next.trialStartedAt,
          transition.next.trialEndsAt,
          transition.next.activatedAt,
          transition.next.accessEndsAt,
          transition.next.graceEndsAt,
          transition.next.scheduledSuspensionAt,
          transition.next.scheduledSuspensionReason,
          transition.next.scheduledSuspensionCustomerMessage,
          transition.next.suspendedAt,
          transition.next.cancelledAt,
          transition.next.internalReason,
          transition.next.customerMessage,
          transition.organizationId,
          transition.expectedVersion,
        ],
      );

      if (updateResult.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before this lifecycle action could be applied',
          'ENTITLEMENT_VERSION_CONFLICT',
        );
      }

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transition.organizationId,
          transition.expectedFromStatus,
          transition.toStatus,
          transition.effectiveAt,
          transition.reason,
          transition.customerMessage,
          transition.platformAdminId,
          transition.source,
        ],
      );

      const updated = await this.findWithExecutor(
        connection,
        transition.organizationId,
      );
      if (!updated) {
        throw new Error(
          'Organization entitlement transitioned but could not be reloaded',
        );
      }

      await connection.commit();
      return updated;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  public async ensureRegistrationEntitlement(
    organizationId: number,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [organizationRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM organizations WHERE id = ? FOR UPDATE',
        [organizationId],
      );
      if (!organizationRows.length) {
        throw new NotFoundError(
          'Organization not found',
          'ORGANIZATION_NOT_FOUND',
        );
      }

      const existing = await this.findWithExecutor(connection, organizationId);
      if (existing) {
        await connection.commit();
        return existing;
      }

      await createPendingRegistrationEntitlementInTransaction(
        connection,
        organizationId,
      );

      const created = await this.findWithExecutor(connection, organizationId);
      if (!created) {
        throw new Error('Organization entitlement was created but could not be reloaded');
      }

      await connection.commit();
      return created;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const organizationEntitlementRepository =
  new OrganizationEntitlementRepository();
