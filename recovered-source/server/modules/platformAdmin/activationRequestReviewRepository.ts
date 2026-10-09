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
  OrganizationEntitlementTransitionState,
} from '../organizationAccess/types';
import { evaluateOrganizationEntitlement } from '../organizationAccess/service';
import {
  PlatformAuditRepository,
  platformAuditRepository,
} from './platformAuditRepository';

export interface PlatformActivationRequestApprovalAtomicInput {
  requestId: number;
  expectedVersion: number;
  accessEndsAt: Date | null;
  reason: string;
  customerMessage: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestIdHeader?: string | null;
}

export interface PlatformActivationRequestRejectionAtomicInput {
  requestId: number;
  reviewNote: string;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestIdHeader?: string | null;
}

interface LockedRequest {
  id: number;
  organizationId: number;
  status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  note: string | null;
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
    trialStartedAt: entitlement.trialStartedAt,
    trialEndsAt: entitlement.trialEndsAt,
    activatedAt: entitlement.activatedAt,
    accessEndsAt: entitlement.accessEndsAt,
    graceEndsAt: entitlement.graceEndsAt,
    scheduledSuspensionAt: entitlement.scheduledSuspensionAt,
    suspendedAt: entitlement.suspendedAt,
    cancelledAt: entitlement.cancelledAt,
    internalReason: entitlement.internalReason,
    customerMessage: entitlement.customerMessage,
    version: entitlement.version,
  };
}

export class PlatformActivationRequestReviewRepository {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly auditRepository: PlatformAuditRepository =
      platformAuditRepository,
  ) {}

  private async loadRequestLocked(
    connection: PoolConnection,
    requestId: number,
  ): Promise<LockedRequest> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, organization_id, status, note
         FROM organization_activation_requests
        WHERE id = ?
        FOR UPDATE`,
      [requestId],
    );

    if (!rows.length) {
      throw new NotFoundError(
        'Platform activation request not found',
        'PLATFORM_ACTIVATION_REQUEST_NOT_FOUND',
      );
    }

    return {
      id: Number(rows[0].id),
      organizationId: Number(rows[0].organization_id),
      status: String(rows[0].status) as LockedRequest['status'],
      note: rows[0].note == null ? null : String(rows[0].note),
    };
  }

  private assertOpen(request: LockedRequest): void {
    if (request.status === 'OPEN') return;

    throw new ConflictError(
      'Activation request has already been reviewed',
      'ACTIVATION_REQUEST_ALREADY_REVIEWED',
      {
        requestId: request.id,
        currentStatus: request.status,
      },
    );
  }

  private async loadEntitlementLocked(
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
      'Organization entitlement changed before the activation request could be reviewed',
      'ENTITLEMENT_VERSION_CONFLICT',
      {
        expectedVersion,
        currentVersion: current.version,
        currentStatus: current.accessStatus,
      },
    );
  }

  private assertApprovalAvailable(
    current: OrganizationEntitlement,
  ): void {
    const access = evaluateOrganizationEntitlement(
      current,
      current.organizationId,
    );

    if (
      access.canOperate
      || ![
        'PENDING',
        'TRIAL',
        'ACTIVE',
        'GRACE_PERIOD',
        'SUSPENDED',
      ].includes(current.accessStatus)
    ) {
      throw new ConflictError(
        'Activation request approval is not available from the current organization state',
        'ACTIVATION_REQUEST_APPROVAL_NOT_AVAILABLE',
        {
          currentStatus: current.accessStatus,
          accessMode: access.accessMode,
          blockingReason: access.blockingReason,
        },
      );
    }
  }

  private activeRenewalState(
    current: OrganizationEntitlement,
    input: PlatformActivationRequestApprovalAtomicInput,
    effectiveAt: Date,
  ): OrganizationEntitlementTransitionState {
    return {
      accessStatus: 'ACTIVE',
      trialStartedAt:
        current.trialStartedAt == null
          ? null
          : new Date(current.trialStartedAt),
      trialEndsAt:
        current.trialEndsAt == null
          ? null
          : new Date(current.trialEndsAt),
      activatedAt:
        current.activatedAt == null
          ? effectiveAt
          : new Date(current.activatedAt),
      accessEndsAt: input.accessEndsAt,
      graceEndsAt: null,
      scheduledSuspensionAt: null,
      scheduledSuspensionReason: null,
      scheduledSuspensionCustomerMessage: null,
      suspendedAt: null,
      cancelledAt: null,
      internalReason: input.reason,
      customerMessage: input.customerMessage,
    };
  }

  private async writeEntitlement(
    connection: PoolConnection,
    current: OrganizationEntitlement,
    next: OrganizationEntitlementTransitionState,
  ): Promise<OrganizationEntitlement> {
    const [result] = await connection.execute<ResultSetHeader>(
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
        next.accessStatus,
        next.trialStartedAt,
        next.trialEndsAt,
        next.activatedAt,
        next.accessEndsAt,
        next.graceEndsAt,
        next.scheduledSuspensionAt,
        next.scheduledSuspensionReason,
        next.scheduledSuspensionCustomerMessage,
        next.suspendedAt,
        next.cancelledAt,
        next.internalReason,
        next.customerMessage,
        current.organizationId,
        current.version,
        current.accessStatus,
      ],
    );

    if (result.affectedRows !== 1) {
      throw new ConflictError(
        'Organization entitlement changed before the activation request could be reviewed',
        'ENTITLEMENT_VERSION_CONFLICT',
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
       LIMIT 1`,
      [current.organizationId],
    );

    if (!rows.length) {
      throw new Error(
        'Activation request approval updated entitlement but it could not be reloaded',
      );
    }

    return mapEntitlement(rows[0]);
  }

  public async approveAtomically(
    input: PlatformActivationRequestApprovalAtomicInput,
  ): Promise<OrganizationEntitlement> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const request = await this.loadRequestLocked(
        connection,
        input.requestId,
      );
      this.assertOpen(request);

      const current = await this.loadEntitlementLocked(
        connection,
        request.organizationId,
      );
      this.assertVersion(current, input.expectedVersion);
      this.assertApprovalAvailable(current);

      const effectiveAt = new Date();
      const next =
        current.accessStatus === 'ACTIVE'
          ? this.activeRenewalState(current, input, effectiveAt)
          : buildOrganizationTransitionState(current, {
              organizationId: request.organizationId,
              toStatus: 'ACTIVE',
              expectedVersion: input.expectedVersion,
              source: 'ACTIVATION_REQUEST',
              platformAdminId: input.platformAdminId,
              reason: input.reason,
              customerMessage: input.customerMessage,
              accessEndsAt: input.accessEndsAt,
              effectiveAt,
            }).next;

      const updated = await this.writeEntitlement(
        connection,
        current,
        next,
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
         VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, 'ACTIVATION_REQUEST')`,
        [
          request.organizationId,
          current.accessStatus,
          effectiveAt,
          input.reason,
          input.customerMessage,
          input.platformAdminId,
        ],
      );

      const [requestResult] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_activation_requests
            SET status = 'APPROVED',
                reviewed_by_platform_admin_id = ?,
                review_note = ?,
                reviewed_at = ?,
                updated_at = NOW()
          WHERE id = ?
            AND status = 'OPEN'`,
        [
          input.platformAdminId,
          input.reason,
          effectiveAt,
          request.id,
        ],
      );

      if (requestResult.affectedRows !== 1) {
        throw new ConflictError(
          'Activation request changed before approval could be committed',
          'ACTIVATION_REQUEST_ALREADY_REVIEWED',
        );
      }

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: request.organizationId,
        action:
          input.accessEndsAt == null
            ? 'ACTIVATION_REQUEST_APPROVED'
            : 'ACTIVATION_REQUEST_APPROVED_UNTIL',
        targetType: 'ORGANIZATION_ACTIVATION_REQUEST',
        targetId: String(request.id),
        before: {
          requestStatus: 'OPEN',
          requestNote: request.note,
          entitlement: auditSnapshot(current),
        },
        after: {
          requestStatus: 'APPROVED',
          reviewNote: input.reason,
          entitlement: auditSnapshot(updated),
        },
        reason: input.reason,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId: input.requestIdHeader,
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

  public async rejectAtomically(
    input: PlatformActivationRequestRejectionAtomicInput,
  ): Promise<void> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const request = await this.loadRequestLocked(
        connection,
        input.requestId,
      );
      this.assertOpen(request);

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE organization_activation_requests
            SET status = 'REJECTED',
                reviewed_by_platform_admin_id = ?,
                review_note = ?,
                reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = ?
            AND status = 'OPEN'`,
        [
          input.platformAdminId,
          input.reviewNote,
          request.id,
        ],
      );

      if (result.affectedRows !== 1) {
        throw new ConflictError(
          'Activation request changed before rejection could be committed',
          'ACTIVATION_REQUEST_ALREADY_REVIEWED',
        );
      }

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: input.platformAdminId,
        organizationId: request.organizationId,
        action: 'ACTIVATION_REQUEST_REJECTED',
        targetType: 'ORGANIZATION_ACTIVATION_REQUEST',
        targetId: String(request.id),
        before: {
          requestStatus: 'OPEN',
          requestNote: request.note,
        },
        after: {
          requestStatus: 'REJECTED',
          reviewNote: input.reviewNote,
        },
        reason: input.reviewNote,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId: input.requestIdHeader,
      });

      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const platformActivationRequestReviewRepository =
  new PlatformActivationRequestReviewRepository();
