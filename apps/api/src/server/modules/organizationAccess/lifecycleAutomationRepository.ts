import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import {
  buildOrganizationTransitionState,
} from './transitionService';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from './types';
import {
  PlatformAuditRepository,
  platformAuditRepository,
} from '../platformAdmin/platformAuditRepository';

export type LifecycleAutomationKind =
  | 'SCHEDULED_SUSPENSION'
  | 'GRACE_EXPIRY'
  | 'ACTIVE_EXPIRY'
  | 'TRIAL_EXPIRY';

export interface LifecycleAutomationCandidate {
  entitlementId: number;
  organizationId: number;
  accessStatus: 'TRIAL' | 'ACTIVE' | 'GRACE_PERIOD';
  version: number;
  kind: LifecycleAutomationKind;
  dueAt: string;
}

export type LifecycleAutomationSkipReason =
  | 'STALE_VERSION'
  | 'STATE_CHANGED'
  | 'NO_LONGER_DUE';

export type LifecycleAutomationExecutionResult =
  | {
      outcome: 'EXECUTED';
      kind: LifecycleAutomationKind;
      entitlement: OrganizationEntitlement;
    }
  | {
      outcome: 'SKIPPED';
      kind: LifecycleAutomationKind;
      reason: LifecycleAutomationSkipReason;
    };

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

function timestamp(value: string | null): number | null {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function determineDueKindFromTimers(
  accessStatus: OrganizationAccessStatus,
  scheduledSuspensionAt: string | null,
  graceEndsAtValue: string | null,
  accessEndsAtValue: string | null,
  trialEndsAtValue: string | null,
  now: Date,
): { kind: LifecycleAutomationKind; dueAt: Date } | null {
  const nowMs = now.getTime();
  const scheduledAt = timestamp(scheduledSuspensionAt);

  if (
    (accessStatus === 'ACTIVE' || accessStatus === 'GRACE_PERIOD')
    && scheduledAt != null
    && scheduledAt <= nowMs
  ) {
    return {
      kind: 'SCHEDULED_SUSPENSION',
      dueAt: new Date(scheduledAt),
    };
  }

  const graceEndsAt = timestamp(graceEndsAtValue);

  if (
    accessStatus === 'GRACE_PERIOD'
    && graceEndsAt != null
    && graceEndsAt <= nowMs
  ) {
    return {
      kind: 'GRACE_EXPIRY',
      dueAt: new Date(graceEndsAt),
    };
  }

  if (accessStatus === 'ACTIVE') {
    const accessEndsAt = timestamp(accessEndsAtValue);
    if (accessEndsAt == null || accessEndsAt > nowMs) {
      return null;
    }

    if (graceEndsAt != null && graceEndsAt > accessEndsAt) {
      if (graceEndsAt <= nowMs) {
        return {
          kind: 'GRACE_EXPIRY',
          dueAt: new Date(graceEndsAt),
        };
      }
      return null;
    }

    return {
      kind: 'ACTIVE_EXPIRY',
      dueAt: new Date(accessEndsAt),
    };
  }

  if (accessStatus === 'TRIAL') {
    const trialEndsAt = timestamp(trialEndsAtValue);
    if (trialEndsAt == null || trialEndsAt > nowMs) {
      return null;
    }

    if (graceEndsAt != null && graceEndsAt > trialEndsAt) {
      if (graceEndsAt <= nowMs) {
        return {
          kind: 'GRACE_EXPIRY',
          dueAt: new Date(graceEndsAt),
        };
      }
      return null;
    }

    return {
      kind: 'TRIAL_EXPIRY',
      dueAt: new Date(trialEndsAt),
    };
  }

  return null;
}

function determineDueKind(
  entitlement: OrganizationEntitlement,
  now: Date,
): { kind: LifecycleAutomationKind; dueAt: Date } | null {
  return determineDueKindFromTimers(
    entitlement.accessStatus,
    entitlement.scheduledSuspensionAt,
    entitlement.graceEndsAt,
    entitlement.accessEndsAt,
    entitlement.trialEndsAt,
    now,
  );
}

export class LifecycleAutomationRepository {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly auditRepository: PlatformAuditRepository =
      platformAuditRepository,
  ) {}

  public async listDueCandidates(
    now: Date,
    limit = 50,
  ): Promise<LifecycleAutomationCandidate[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const nowValue = now;

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
         id,
         organization_id,
         access_status,
         version,
         trial_ends_at,
         access_ends_at,
         grace_ends_at,
         scheduled_suspension_at
       FROM organization_entitlements
       WHERE (
           access_status IN ('ACTIVE', 'GRACE_PERIOD')
           AND scheduled_suspension_at IS NOT NULL
           AND scheduled_suspension_at <= ?
         )
         OR (
           access_status = 'GRACE_PERIOD'
           AND grace_ends_at IS NOT NULL
           AND grace_ends_at <= ?
         )
         OR (
           access_status = 'ACTIVE'
           AND access_ends_at IS NOT NULL
           AND access_ends_at <= ?
           AND (
             grace_ends_at IS NULL
             OR grace_ends_at <= access_ends_at
             OR grace_ends_at <= ?
           )
         )
         OR (
           access_status = 'TRIAL'
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at <= ?
           AND (
             grace_ends_at IS NULL
             OR grace_ends_at <= trial_ends_at
             OR grace_ends_at <= ?
           )
         )
       ORDER BY
         CASE
           WHEN access_status IN ('ACTIVE', 'GRACE_PERIOD')
             AND scheduled_suspension_at IS NOT NULL
             AND scheduled_suspension_at <= ?
           THEN scheduled_suspension_at
           WHEN access_status = 'GRACE_PERIOD'
             AND grace_ends_at IS NOT NULL
             AND grace_ends_at <= ?
           THEN grace_ends_at
           WHEN access_status = 'ACTIVE'
             AND access_ends_at IS NOT NULL
             AND access_ends_at <= ?
           THEN CASE
             WHEN grace_ends_at IS NOT NULL
               AND grace_ends_at > access_ends_at
             THEN grace_ends_at
             ELSE access_ends_at
           END
           WHEN access_status = 'TRIAL'
             AND trial_ends_at IS NOT NULL
             AND trial_ends_at <= ?
           THEN CASE
             WHEN grace_ends_at IS NOT NULL
               AND grace_ends_at > trial_ends_at
             THEN grace_ends_at
             ELSE trial_ends_at
           END
         END ASC,
         id ASC
       LIMIT ${safeLimit}`,
      [
        nowValue,
        nowValue,
        nowValue,
        nowValue,
        nowValue,
        nowValue,
        nowValue,
        nowValue,
        nowValue,
        nowValue,
      ],
    );

    return rows.map(row => {
      const accessStatus =
        String(row.access_status) as OrganizationAccessStatus;
      const due = determineDueKindFromTimers(
        accessStatus,
        toNullableIso(row.scheduled_suspension_at),
        toNullableIso(row.grace_ends_at),
        toNullableIso(row.access_ends_at),
        toNullableIso(row.trial_ends_at),
        now,
      );

      if (!due) {
        throw new Error(
          `Lifecycle automation due query returned a non-due entitlement: ${row.organization_id}`,
        );
      }

      return {
        entitlementId: Number(row.id),
        organizationId: Number(row.organization_id),
        accessStatus: accessStatus as 'TRIAL' | 'ACTIVE' | 'GRACE_PERIOD',
        version: Number(row.version),
        kind: due.kind,
        dueAt: due.dueAt.toISOString(),
      };
    });
  }

  private async loadLocked(
    connection: PoolConnection,
    organizationId: number,
  ): Promise<OrganizationEntitlement | null> {
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

    return rows.length ? mapEntitlement(rows[0]) : null;
  }

  private async reload(
    connection: PoolConnection,
    organizationId: number,
  ): Promise<OrganizationEntitlement> {
    const current = await this.loadLocked(connection, organizationId);
    if (!current) {
      throw new Error(
        'Lifecycle automation committed an entitlement update but could not reload it',
      );
    }
    return current;
  }

  public async executeCandidateAtomically(
    candidate: LifecycleAutomationCandidate,
    now: Date,
  ): Promise<LifecycleAutomationExecutionResult> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const current = await this.loadLocked(
        connection,
        candidate.organizationId,
      );

      if (!current) {
        await connection.rollback();
        return {
          outcome: 'SKIPPED',
          kind: candidate.kind,
          reason: 'STATE_CHANGED',
        };
      }

      if (current.version !== candidate.version) {
        await connection.rollback();
        return {
          outcome: 'SKIPPED',
          kind: candidate.kind,
          reason: 'STALE_VERSION',
        };
      }

      if (
        current.accessStatus !== 'TRIAL'
        && current.accessStatus !== 'ACTIVE'
        && current.accessStatus !== 'GRACE_PERIOD'
      ) {
        await connection.rollback();
        return {
          outcome: 'SKIPPED',
          kind: candidate.kind,
          reason: 'STATE_CHANGED',
        };
      }

      const due = determineDueKind(current, now);
      if (!due || due.kind !== candidate.kind) {
        await connection.rollback();
        return {
          outcome: 'SKIPPED',
          kind: candidate.kind,
          reason: 'NO_LONGER_DUE',
        };
      }

      let reason: string;
      let customerMessage: string | null;
      let auditAction: string;

      if (due.kind === 'SCHEDULED_SUSPENSION') {
        const scheduledReason =
          current.scheduledSuspensionReason?.trim() ?? '';
        if (!scheduledReason) {
          throw new Error(
            'SCHEDULED_SUSPENSION_REASON_MISSING',
          );
        }

        reason = scheduledReason;
        customerMessage =
          current.scheduledSuspensionCustomerMessage?.trim() || null;
        auditAction = 'ORGANIZATION_SCHEDULED_SUSPENSION_EXECUTED';
      } else if (due.kind === 'GRACE_EXPIRY') {
        reason = 'Grace period expired automatically';
        customerMessage = null;
        auditAction = 'ORGANIZATION_GRACE_EXPIRED_AUTOMATICALLY';
      } else if (due.kind === 'ACTIVE_EXPIRY') {
        reason = 'Access period expired automatically';
        customerMessage = null;
        auditAction = 'ORGANIZATION_ACCESS_EXPIRED_AUTOMATICALLY';
      } else {
        reason = 'Trial period expired automatically';
        customerMessage = null;
        auditAction = 'ORGANIZATION_TRIAL_EXPIRED_AUTOMATICALLY';
      }

      const prepared = buildOrganizationTransitionState(current, {
        organizationId: current.organizationId,
        toStatus: 'SUSPENDED',
        expectedVersion: current.version,
        source: 'SCHEDULED_JOB',
        platformAdminId: null,
        reason,
        customerMessage,
        effectiveAt: due.dueAt,
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
        await connection.rollback();
        return {
          outcome: 'SKIPPED',
          kind: candidate.kind,
          reason: 'STALE_VERSION',
        };
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
         VALUES (?, ?, 'SUSPENDED', ?, ?, ?, NULL, 'SCHEDULED_JOB')`,
        [
          current.organizationId,
          current.accessStatus,
          prepared.effectiveAt,
          prepared.reason,
          prepared.customerMessage,
        ],
      );

      const updated = await this.reload(connection, current.organizationId);

      await this.auditRepository.appendInTransaction(connection, {
        platformAdminId: null,
        organizationId: current.organizationId,
        action: auditAction,
        targetType: 'ORGANIZATION_ENTITLEMENT',
        targetId: String(current.id),
        before: {
          ...auditSnapshot(current),
          automationKind: due.kind,
          dueAt: due.dueAt.toISOString(),
        },
        after: {
          ...auditSnapshot(updated),
          automationKind: due.kind,
          dueAt: due.dueAt.toISOString(),
        },
        reason: prepared.reason,
        requestId: null,
        ipAddress: null,
        userAgent: 'MIH_DINEOS_LIFECYCLE_AUTOMATION',
      });

      await connection.commit();

      return {
        outcome: 'EXECUTED',
        kind: due.kind,
        entitlement: updated,
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const lifecycleAutomationRepository =
  new LifecycleAutomationRepository();
