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
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from '../organizationAccess/types';
import {
  PlatformAuditRepository,
  platformAuditRepository,
} from './platformAuditRepository';

export interface PlatformAccessExpiryAdjustmentInput {
  organizationId: number;
  expectedVersion: number;
  accessEndsAt: Date | null;
  reason: string;
  customerMessage: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface PlatformGraceExtensionInput {
  organizationId: number;
  expectedVersion: number;
  graceEndsAt: Date;
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
  return value == null ? null : toIso(value);
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
    internalReason: entitlement.internalReason,
    customerMessage: entitlement.customerMessage,
    version: entitlement.version,
  };
}

function sameNullableInstant(
  current: string | null,
  requested: Date | null,
): boolean {
  if (current == null || requested == null) {
    return current == null && requested == null;
  }

  return Math.floor(new Date(current).getTime() / 1000)
    === Math.floor(requested.getTime() / 1000);
}

export class PlatformOrganizationEntitlementAdjustmentRepository {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly auditRepository: PlatformAuditRepository =
      platformAuditRepository,
  ) {}

  private async loadEntitlementForUpdate(
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

  public async changeActiveAccessExpiryAtomically(
    input: PlatformAccessExpiryAdjustmentInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const current = await this.loadEntitlementForUpdate(
        connection,
        input.organizationId,
      );

      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          'Organization entitlement changed before this access-expiry adjustment could be applied',
          'ENTITLEMENT_VERSION_CONFLICT',
          {
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
            currentStatus: current.accessStatus,
          },
        );
      }

      if (current.accessStatus !== 'ACTIVE') {
        throw new ConflictError(
          'Access expiry can only be changed while the organization is ACTIVE',
          'PLATFORM_ACCESS_EXPIRY_NOT_ALLOWED',
          {
            currentStatus: current.accessStatus,
          },
        );
      }

      if (sameNullableInstant(current.accessEndsAt, input.accessEndsAt)) {
        throw new ConflictError(
          'The requested access expiry is unchanged',
          'PLATFORM_ACCESS_EXPIRY_UNCHANGED',
          {
            accessEndsAt: current.accessEndsAt,
          },
        );
      }

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_entitlements
            SET access_ends_at = ?,
                internal_reason = ?,
                customer_message = ?,
                version = version + 1,
                updated_at = NOW()
          WHERE organization_id = ?
            AND version = ?
            AND access_status = 'ACTIVE'`,
        [
          input.accessEndsAt,
          input.reason,
          input.customerMessage,
          input.organizationId,
          input.expectedVersion,
        ],
      );

      if (updateResult.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before this access-expiry adjustment could be applied',
          'ENTITLEMENT_VERSION_CONFLICT',
        );
      }

      const [updatedRows] = await connection.execute<RowDataPacket[]>(
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
         LIMIT 1`,
        [input.organizationId],
      );

      if (!updatedRows.length) {
        throw new Error(
          'Organization entitlement was adjusted but could not be reloaded',
        );
      }

      const updated = mapEntitlement(updatedRows[0]);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action:
          input.accessEndsAt == null
            ? 'ORGANIZATION_ACCESS_EXPIRY_REMOVED'
            : 'ORGANIZATION_ACCESS_EXPIRY_SET',
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
  public async extendGraceAtomically(
    input: PlatformGraceExtensionInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const current = await this.loadEntitlementForUpdate(
        connection,
        input.organizationId,
      );

      if (current.version !== input.expectedVersion) {
        throw new ConflictError(
          'Organization entitlement changed before this grace extension could be applied',
          'ENTITLEMENT_VERSION_CONFLICT',
          {
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
            currentStatus: current.accessStatus,
          },
        );
      }

      if (current.accessStatus !== 'GRACE_PERIOD') {
        throw new ConflictError(
          'Grace can only be extended while the organization is in GRACE_PERIOD',
          'PLATFORM_EXTEND_GRACE_NOT_ALLOWED',
          {
            currentStatus: current.accessStatus,
          },
        );
      }

      if (current.graceEndsAt != null) {
        const currentMs = Math.floor(
          new Date(current.graceEndsAt).getTime() / 1000,
        );
        const requestedMs = Math.floor(input.graceEndsAt.getTime() / 1000);

        if (requestedMs === currentMs) {
          throw new ConflictError(
            'The requested grace end is unchanged',
            'PLATFORM_GRACE_END_UNCHANGED',
            {
              graceEndsAt: current.graceEndsAt,
            },
          );
        }

        if (requestedMs < currentMs) {
          throw new ConflictError(
            'The requested grace end must extend the current grace period',
            'PLATFORM_GRACE_EXTENSION_MUST_EXTEND',
            {
              currentGraceEndsAt: current.graceEndsAt,
              requestedGraceEndsAt: input.graceEndsAt.toISOString(),
            },
          );
        }
      }

      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_entitlements
            SET grace_ends_at = ?,
                internal_reason = ?,
                customer_message = ?,
                version = version + 1,
                updated_at = NOW()
          WHERE organization_id = ?
            AND version = ?
            AND access_status = 'GRACE_PERIOD'`,
        [
          input.graceEndsAt,
          input.reason,
          input.customerMessage,
          input.organizationId,
          input.expectedVersion,
        ],
      );

      if (updateResult.affectedRows !== 1) {
        throw new ConflictError(
          'Organization entitlement changed before this grace extension could be applied',
          'ENTITLEMENT_VERSION_CONFLICT',
        );
      }

      const [updatedRows] = await connection.execute<RowDataPacket[]>(
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
         LIMIT 1`,
        [input.organizationId],
      );

      if (!updatedRows.length) {
        throw new Error(
          'Organization entitlement grace was extended but could not be reloaded',
        );
      }

      const updated = mapEntitlement(updatedRows[0]);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: input.organizationId,
        action:
          current.graceEndsAt == null
            ? 'ORGANIZATION_GRACE_END_SET'
            : 'ORGANIZATION_GRACE_EXTENDED',
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

}

export const platformOrganizationEntitlementAdjustmentRepository =
  new PlatformOrganizationEntitlementAdjustmentRepository();
