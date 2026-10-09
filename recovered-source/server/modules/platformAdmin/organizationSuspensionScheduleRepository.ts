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
  evaluateOrganizationEntitlement,
} from '../organizationAccess/service';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from '../organizationAccess/types';
import {
  PlatformAuditRepository,
  platformAuditRepository,
} from './platformAuditRepository';

export interface PlatformSuspensionScheduleMutationInput {
  organizationId: number;
  expectedVersion: number;
  scheduledSuspensionAt?: Date;
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
    accessEndsAt: entitlement.accessEndsAt,
    graceEndsAt: entitlement.graceEndsAt,
    scheduledSuspensionAt: entitlement.scheduledSuspensionAt,
    scheduledSuspensionReason: entitlement.scheduledSuspensionReason,
    scheduledSuspensionCustomerMessage:
      entitlement.scheduledSuspensionCustomerMessage,
    version: entitlement.version,
  };
}

function allowedState(status: OrganizationAccessStatus): boolean {
  return status === 'ACTIVE' || status === 'GRACE_PERIOD';
}

function sameInstant(current: string, requested: Date): boolean {
  return Math.floor(new Date(current).getTime() / 1000)
    === Math.floor(requested.getTime() / 1000);
}

export class PlatformOrganizationSuspensionScheduleRepository {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly auditRepository: PlatformAuditRepository =
      platformAuditRepository,
  ) {}

  private async loadForUpdate(
    connection: PoolConnection,
    organizationId: number,
  ): Promise<OrganizationEntitlement> {
    const [organizationRows] = await connection.execute<RowDataPacket[]>(
      'SELECT id FROM organizations WHERE id = ? LIMIT 1',
      [organizationId],
    );

    if (!organizationRows.length) {
      throw new NotFoundError(
        'Platform organization not found',
        'PLATFORM_ORGANIZATION_NOT_FOUND',
      );
    }

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
       FOR UPDATE`,
      [organizationId],
    );

    if (!rows.length) {
      throw new NotFoundError(
        'Organization entitlement not found',
        'ORGANIZATION_ENTITLEMENT_NOT_FOUND',
      );
    }

    return mapEntitlement(rows[0]);
  }

  private assertVersion(
    current: OrganizationEntitlement,
    expectedVersion: number,
  ): void {
    if (current.version === expectedVersion) return;

    throw new ConflictError(
      'Organization entitlement changed before the suspension schedule action could be applied',
      'ENTITLEMENT_VERSION_CONFLICT',
      {
        expectedVersion,
        currentVersion: current.version,
        currentStatus: current.accessStatus,
      },
    );
  }

  private assertAllowedState(current: OrganizationEntitlement): void {
    if (allowedState(current.accessStatus)) return;

    throw new ConflictError(
      'Suspension scheduling is only available for ACTIVE or GRACE_PERIOD organizations',
      'PLATFORM_SUSPENSION_SCHEDULE_NOT_ALLOWED',
      {
        currentStatus: current.accessStatus,
      },
    );
  }

  private async reload(
    connection: PoolConnection,
    organizationId: number,
  ): Promise<OrganizationEntitlement> {
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
      [organizationId],
    );

    if (!rows.length) {
      throw new Error(
        'Organization suspension schedule changed but entitlement could not be reloaded',
      );
    }

    return mapEntitlement(rows[0]);
  }

  public async scheduleAtomically(
    input: PlatformSuspensionScheduleMutationInput & {
      scheduledSuspensionAt: Date;
    },
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const current = await this.loadForUpdate(connection, input.organizationId);
      this.assertVersion(current, input.expectedVersion);
      this.assertAllowedState(current);

      if (current.scheduledSuspensionAt != null) {
        throw new ConflictError(
          'A suspension is already scheduled; use Reschedule instead',
          'PLATFORM_SUSPENSION_ALREADY_SCHEDULED',
          {
            scheduledSuspensionAt: current.scheduledSuspensionAt,
          },
        );
      }

      const effective = evaluateOrganizationEntitlement(
        current,
        input.organizationId,
      );

      if (!effective.canOperate) {
        throw new ConflictError(
          'A new suspension schedule requires currently operational organization access',
          'PLATFORM_SUSPENSION_SCHEDULE_REQUIRES_OPERATIONAL_ACCESS',
          {
            accessMode: effective.accessMode,
            blockingReason: effective.blockingReason,
          },
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_entitlements
            SET scheduled_suspension_at = ?,
                scheduled_suspension_reason = ?,
                scheduled_suspension_customer_message = ?,
                version = version + 1,
                updated_at = NOW()
          WHERE organization_id = ?
            AND version = ?
            AND access_status IN ('ACTIVE', 'GRACE_PERIOD')`,
        [
          input.scheduledSuspensionAt,
          input.reason,
          input.customerMessage,
          input.organizationId,
          input.expectedVersion,
        ],
      );

      if (result.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before the suspension could be scheduled',
          'ENTITLEMENT_VERSION_CONFLICT',
        );
      }

      const updated = await this.reload(connection, input.organizationId);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action: 'ORGANIZATION_SUSPENSION_SCHEDULED',
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        reason: input.reason,
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

  public async rescheduleAtomically(
    input: PlatformSuspensionScheduleMutationInput & {
      scheduledSuspensionAt: Date;
    },
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const current = await this.loadForUpdate(connection, input.organizationId);
      this.assertVersion(current, input.expectedVersion);
      this.assertAllowedState(current);

      if (current.scheduledSuspensionAt == null) {
        throw new ConflictError(
          'No suspension is currently scheduled',
          'PLATFORM_SUSPENSION_NOT_SCHEDULED',
        );
      }

      if (sameInstant(
        current.scheduledSuspensionAt,
        input.scheduledSuspensionAt,
      )) {
        throw new ConflictError(
          'The requested suspension schedule is unchanged',
          'PLATFORM_SUSPENSION_SCHEDULE_UNCHANGED',
          {
            scheduledSuspensionAt: current.scheduledSuspensionAt,
          },
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_entitlements
            SET scheduled_suspension_at = ?,
                scheduled_suspension_reason = ?,
                scheduled_suspension_customer_message = ?,
                version = version + 1,
                updated_at = NOW()
          WHERE organization_id = ?
            AND version = ?
            AND access_status IN ('ACTIVE', 'GRACE_PERIOD')`,
        [
          input.scheduledSuspensionAt,
          input.reason,
          input.customerMessage,
          input.organizationId,
          input.expectedVersion,
        ],
      );

      if (result.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before the suspension could be rescheduled',
          'ENTITLEMENT_VERSION_CONFLICT',
        );
      }

      const updated = await this.reload(connection, input.organizationId);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action: 'ORGANIZATION_SUSPENSION_RESCHEDULED',
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: auditSnapshot(current),
        after: auditSnapshot(updated),
        reason: input.reason,
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

  public async cancelAtomically(
    input: PlatformSuspensionScheduleMutationInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const current = await this.loadForUpdate(connection, input.organizationId);
      this.assertVersion(current, input.expectedVersion);
      this.assertAllowedState(current);

      if (current.scheduledSuspensionAt == null) {
        throw new ConflictError(
          'No suspension is currently scheduled',
          'PLATFORM_SUSPENSION_NOT_SCHEDULED',
        );
      }

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_entitlements
            SET scheduled_suspension_at = NULL,
                scheduled_suspension_reason = NULL,
                scheduled_suspension_customer_message = NULL,
                version = version + 1,
                updated_at = NOW()
          WHERE organization_id = ?
            AND version = ?
            AND access_status IN ('ACTIVE', 'GRACE_PERIOD')`,
        [
          input.organizationId,
          input.expectedVersion,
        ],
      );

      if (result.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before the suspension schedule could be cancelled',
          'ENTITLEMENT_VERSION_CONFLICT',
        );
      }

      const updated = await this.reload(connection, input.organizationId);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action: 'ORGANIZATION_SUSPENSION_SCHEDULE_CANCELLED',
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: auditSnapshot(current),
        after: {
          ...auditSnapshot(updated),
          cancellationCustomerMessage: input.customerMessage,
        },
        reason: input.reason,
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

export const platformOrganizationSuspensionScheduleRepository =
  new PlatformOrganizationSuspensionScheduleRepository();
