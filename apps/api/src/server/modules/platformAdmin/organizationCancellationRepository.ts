import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import {
  ConflictError,
  NotFoundError,
} from '../../shared/errors';
import {
  buildOrganizationTransitionState,
} from '../organizationAccess/transitionService';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from '../organizationAccess/types';
import {
  PlatformAuditRepository,
  platformAuditRepository,
} from './platformAuditRepository';

export interface CancelOrganizationAtomicInput {
  organizationId: number;
  expectedVersion: number;
  confirmationText: string;
  reason: string;
  customerMessage: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

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
    internalReason:
      row.internal_reason == null ? null : String(row.internal_reason),
    customerMessage:
      row.customer_message == null ? null : String(row.customer_message),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function auditSnapshot(entitlement: OrganizationEntitlement) {
  return {
    accessStatus: entitlement.accessStatus,
    trialStartedAt: entitlement.trialStartedAt,
    trialEndsAt: entitlement.trialEndsAt,
    activatedAt: entitlement.activatedAt,
    accessEndsAt: entitlement.accessEndsAt,
    graceEndsAt: entitlement.graceEndsAt,
    scheduledSuspensionAt: entitlement.scheduledSuspensionAt,
    scheduledSuspensionReason: entitlement.scheduledSuspensionReason,
    scheduledSuspensionCustomerMessage:
      entitlement.scheduledSuspensionCustomerMessage,
    suspendedAt: entitlement.suspendedAt,
    cancelledAt: entitlement.cancelledAt,
    internalReason: entitlement.internalReason,
    customerMessage: entitlement.customerMessage,
    version: entitlement.version,
  };
}

export class PlatformOrganizationCancellationRepository {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly auditRepository: PlatformAuditRepository =
      platformAuditRepository,
  ) {}

  private async loadLocked(
    connection: PoolConnection,
    organizationId: number,
  ): Promise<{
    handle: string;
    entitlement: OrganizationEntitlement;
  }> {
    const [organizationRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, handle
         FROM organizations
        WHERE id = ?
        FOR UPDATE`,
      [organizationId],
    );

    if (!organizationRows.length) {
      throw new NotFoundError(
        'Platform organization not found',
        'PLATFORM_ORGANIZATION_NOT_FOUND',
      );
    }

    const [entitlementRows] = await connection.execute<RowDataPacket[]>(
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
       FOR UPDATE`,
      [organizationId],
    );

    if (!entitlementRows.length) {
      throw new NotFoundError(
        'Organization entitlement not found',
        'ORGANIZATION_ENTITLEMENT_NOT_FOUND',
      );
    }

    return {
      handle: String(organizationRows[0].handle),
      entitlement: mapEntitlement(entitlementRows[0]),
    };
  }

  private assertVersion(
    current: OrganizationEntitlement,
    expectedVersion: number,
  ): void {
    if (current.version === expectedVersion) return;

    throw new ConflictError(
      'Organization entitlement changed before cancellation could be applied',
      'ENTITLEMENT_VERSION_CONFLICT',
      {
        expectedVersion,
        currentVersion: current.version,
        currentStatus: current.accessStatus,
      },
    );
  }

  private assertConfirmation(
    storedHandle: string,
    confirmationText: string,
  ): void {
    const expected = `CANCEL ${storedHandle}`;
    if (confirmationText.trim() === expected) return;

    throw new ConflictError(
      'Organization cancellation confirmation does not match',
      'PLATFORM_CANCELLATION_CONFIRMATION_MISMATCH',
      { expectedConfirmation: expected },
    );
  }

  public async cancelAtomically(
    input: CancelOrganizationAtomicInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const locked = await this.loadLocked(connection, input.organizationId);
      const current = locked.entitlement;

      this.assertVersion(current, input.expectedVersion);
      this.assertConfirmation(locked.handle, input.confirmationText);

      if (current.accessStatus === 'CANCELLED') {
        throw new ConflictError(
          'Organization is already cancelled',
          'PLATFORM_ORGANIZATION_ALREADY_CANCELLED',
          { currentStatus: current.accessStatus },
        );
      }

      const prepared = buildOrganizationTransitionState(current, {
        organizationId: input.organizationId,
        toStatus: 'CANCELLED',
        expectedVersion: input.expectedVersion,
        source: 'PLATFORM_ADMIN',
        platformAdminId: input.platformAdminId,
        reason: input.reason,
        customerMessage: input.customerMessage,
      });

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
            AND version = ?
            AND access_status = ?`,
        [
          prepared.next.accessStatus,
          prepared.next.trialStartedAt,
          prepared.next.trialEndsAt,
          prepared.next.activatedAt,
          prepared.next.accessEndsAt,
          prepared.next.graceEndsAt,
          prepared.next.scheduledSuspensionAt,
          prepared.next.scheduledSuspensionReason,
          prepared.next.scheduledSuspensionCustomerMessage,
          prepared.next.suspendedAt,
          prepared.next.cancelledAt,
          prepared.next.internalReason,
          prepared.next.customerMessage,
          current.organizationId,
          current.version,
          current.accessStatus,
        ],
      );

      if (updateResult.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before cancellation could be applied',
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
         VALUES (?, ?, 'CANCELLED', ?, ?, ?, ?, 'PLATFORM_ADMIN')`,
        [
          current.organizationId,
          current.accessStatus,
          prepared.effectiveAt,
          prepared.reason,
          prepared.customerMessage,
          prepared.platformAdminId,
        ],
      );

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
        [current.organizationId],
      );

      if (!rows.length) {
        throw new Error(
          'Organization cancellation changed entitlement but it could not be reloaded',
        );
      }

      const updated = mapEntitlement(rows[0]);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action: 'ORGANIZATION_CANCELLED',
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: {
          ...auditSnapshot(current),
          confirmedOrganizationHandle: locked.handle,
          priorConfiguredStatus: current.accessStatus,
        },
        after: {
          ...auditSnapshot(updated),
          confirmedOrganizationHandle: locked.handle,
          priorConfiguredStatus: current.accessStatus,
        },
        reason: prepared.reason,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId: input.requestId,
      });

      await connection.commit();
      return updated;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const platformOrganizationCancellationRepository =
  new PlatformOrganizationCancellationRepository();
