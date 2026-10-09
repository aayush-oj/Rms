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

export type PlatformSecurityRestoreTarget = 'ACTIVE' | 'SUSPENDED';

interface SecurityActionBaseInput {
  organizationId: number;
  expectedVersion: number;
  confirmationHandle: string;
  reason: string;
  customerMessage: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface SecuritySuspendAtomicInput
  extends SecurityActionBaseInput {}

export interface ClearSecuritySuspensionAtomicInput
  extends SecurityActionBaseInput {
  restoreTo: PlatformSecurityRestoreTarget;
  accessEndsAt?: Date | null;
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

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase();
}

function auditSnapshot(entitlement: OrganizationEntitlement) {
  return {
    accessStatus: entitlement.accessStatus,
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

export class PlatformOrganizationSecuritySuspensionRepository {
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

  private assertConfirmationHandle(
    storedHandle: string,
    confirmationHandle: string,
  ): void {
    if (normalizeHandle(storedHandle) === normalizeHandle(confirmationHandle)) {
      return;
    }

    throw new ConflictError(
      'Organization confirmation handle does not match',
      'PLATFORM_SECURITY_CONFIRMATION_MISMATCH',
      {
        expectedHandle: storedHandle,
      },
    );
  }

  private assertVersion(
    current: OrganizationEntitlement,
    expectedVersion: number,
  ): void {
    if (current.version === expectedVersion) return;

    throw new ConflictError(
      'Organization entitlement changed before this security action could be applied',
      'ENTITLEMENT_VERSION_CONFLICT',
      {
        expectedVersion,
        currentVersion: current.version,
        currentStatus: current.accessStatus,
      },
    );
  }

  private async currentSecurityOrigin(
    connection: PoolConnection,
    organizationId: number,
  ): Promise<OrganizationAccessStatus> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT from_status, to_status
         FROM organization_status_history
        WHERE organization_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [organizationId],
    );

    if (
      !rows.length
      || String(rows[0].to_status) !== 'SECURITY_SUSPENDED'
      || rows[0].from_status == null
    ) {
      throw new ConflictError(
        'Current security-suspension origin could not be established',
        'PLATFORM_SECURITY_SUSPENSION_ORIGIN_UNAVAILABLE',
      );
    }

    const origin = String(rows[0].from_status) as OrganizationAccessStatus;

    if (!['ACTIVE', 'GRACE_PERIOD', 'SUSPENDED'].includes(origin)) {
      throw new ConflictError(
        'Current security-suspension origin is outside the supported clearance contract',
        'PLATFORM_SECURITY_SUSPENSION_ORIGIN_UNAVAILABLE',
        { origin },
      );
    }

    return origin;
  }

  private async writeTransition(
    connection: PoolConnection,
    current: OrganizationEntitlement,
    next: ReturnType<typeof buildOrganizationTransitionState>,
  ): Promise<OrganizationEntitlement> {
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
        next.next.accessStatus,
        next.next.trialStartedAt,
        next.next.trialEndsAt,
        next.next.activatedAt,
        next.next.accessEndsAt,
        next.next.graceEndsAt,
        next.next.scheduledSuspensionAt,
        next.next.scheduledSuspensionReason,
        next.next.scheduledSuspensionCustomerMessage,
        next.next.suspendedAt,
        next.next.cancelledAt,
        next.next.internalReason,
        next.next.customerMessage,
        current.organizationId,
        current.version,
        current.accessStatus,
      ],
    );

    if (updateResult.affectedRows !== 1) {
      throw new ConflictError(
        'Organization entitlement changed before this security action could be applied',
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
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PLATFORM_ADMIN')`,
      [
        current.organizationId,
        current.accessStatus,
        next.next.accessStatus,
        next.effectiveAt,
        next.reason,
        next.customerMessage,
        next.platformAdminId,
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
        'Organization security transition committed locally but entitlement could not be reloaded',
      );
    }

    return mapEntitlement(rows[0]);
  }

  public async securitySuspendAtomically(
    input: SecuritySuspendAtomicInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const locked = await this.loadLocked(connection, input.organizationId);
      const current = locked.entitlement;

      this.assertVersion(current, input.expectedVersion);
      this.assertConfirmationHandle(
        locked.handle,
        input.confirmationHandle,
      );

      if (!['ACTIVE', 'GRACE_PERIOD', 'SUSPENDED'].includes(current.accessStatus)) {
        throw new ConflictError(
          'Security Suspend is not allowed from the current organization status',
          'PLATFORM_SECURITY_SUSPEND_NOT_ALLOWED',
          {
            currentStatus: current.accessStatus,
            allowedStatuses: ['ACTIVE', 'GRACE_PERIOD', 'SUSPENDED'],
          },
        );
      }

      const prepared = buildOrganizationTransitionState(current, {
        organizationId: input.organizationId,
        toStatus: 'SECURITY_SUSPENDED',
        expectedVersion: input.expectedVersion,
        source: 'PLATFORM_ADMIN',
        platformAdminId: input.platformAdminId,
        reason: input.reason,
        customerMessage: input.customerMessage,
      });

      const updated = await this.writeTransition(
        connection,
        current,
        prepared,
      );

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action: 'ORGANIZATION_SECURITY_SUSPENDED',
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: {
          ...auditSnapshot(current),
          confirmedOrganizationHandle: locked.handle,
        },
        after: {
          ...auditSnapshot(updated),
          confirmedOrganizationHandle: locked.handle,
          securityOrigin: current.accessStatus,
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

  public async clearSecuritySuspensionAtomically(
    input: ClearSecuritySuspensionAtomicInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const locked = await this.loadLocked(connection, input.organizationId);
      const current = locked.entitlement;

      this.assertVersion(current, input.expectedVersion);
      this.assertConfirmationHandle(
        locked.handle,
        input.confirmationHandle,
      );

      if (current.accessStatus !== 'SECURITY_SUSPENDED') {
        throw new ConflictError(
          'Clear Security Suspension is not allowed from the current organization status',
          'PLATFORM_SECURITY_CLEAR_NOT_ALLOWED',
          {
            currentStatus: current.accessStatus,
          },
        );
      }

      const origin = await this.currentSecurityOrigin(
        connection,
        input.organizationId,
      );

      if (origin === 'SUSPENDED' && input.restoreTo === 'ACTIVE') {
        throw new ConflictError(
          'A security hold entered from SUSPENDED must first return to SUSPENDED',
          'PLATFORM_SECURITY_CLEAR_TARGET_NOT_ALLOWED',
          {
            securityOrigin: origin,
            requestedTarget: input.restoreTo,
            allowedTargets: ['SUSPENDED'],
          },
        );
      }

      const prepared = buildOrganizationTransitionState(current, {
        organizationId: input.organizationId,
        toStatus: input.restoreTo,
        expectedVersion: input.expectedVersion,
        source: 'PLATFORM_ADMIN',
        platformAdminId: input.platformAdminId,
        reason: input.reason,
        customerMessage: input.customerMessage,
        accessEndsAt:
          input.restoreTo === 'ACTIVE'
            ? input.accessEndsAt
            : undefined,
      });

      const updated = await this.writeTransition(
        connection,
        current,
        prepared,
      );

      const action =
        input.restoreTo === 'ACTIVE'
          ? 'ORGANIZATION_SECURITY_SUSPENSION_CLEARED_TO_ACTIVE'
          : 'ORGANIZATION_SECURITY_SUSPENSION_CLEARED_TO_SUSPENDED';

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action,
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: {
          ...auditSnapshot(current),
          confirmedOrganizationHandle: locked.handle,
          securityOrigin: origin,
        },
        after: {
          ...auditSnapshot(updated),
          confirmedOrganizationHandle: locked.handle,
          securityOrigin: origin,
          restoreTo: input.restoreTo,
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

export const platformOrganizationSecuritySuspensionRepository =
  new PlatformOrganizationSecuritySuspensionRepository();
