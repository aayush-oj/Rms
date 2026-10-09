import type {
  Pool,
  ResultSetHeader,
} from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import type {
  LifecycleAutomationCandidate,
  LifecycleAutomationKind,
} from './lifecycleAutomationRepository';

export interface LifecycleAutomationAttentionFailureInput {
  candidate: LifecycleAutomationCandidate;
  failedAt: Date;
  error: unknown;
}

export interface SafeLifecycleAutomationFailure {
  code:
    | 'SCHEDULED_SUSPENSION_REASON_MISSING'
    | 'LIFECYCLE_AUTOMATION_EXECUTION_FAILED';
  summary: string;
}

export function classifyLifecycleAutomationFailure(
  error: unknown,
): SafeLifecycleAutomationFailure {
  if (
    error instanceof Error
    && error.message === 'SCHEDULED_SUSPENSION_REASON_MISSING'
  ) {
    return {
      code: 'SCHEDULED_SUSPENSION_REASON_MISSING',
      summary: 'Scheduled suspension reason is missing.',
    };
  }

  return {
    code: 'LIFECYCLE_AUTOMATION_EXECUTION_FAILED',
    summary: 'Lifecycle automation execution failed.',
  };
}

export class LifecycleAutomationAttentionRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  public async recordFailure(
    input: LifecycleAutomationAttentionFailureInput,
  ): Promise<void> {
    const safe = classifyLifecycleAutomationFailure(input.error);

    await this.pool.execute(
      `INSERT INTO lifecycle_automation_attention (
         organization_id,
         automation_kind,
         first_failed_at,
         last_failed_at,
         failure_count,
         last_due_at,
         last_entitlement_version,
         last_error_code,
         last_error_summary,
         resolved_at,
         resolution_reason,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, NULL, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         first_failed_at = IF(
           resolved_at IS NULL,
           first_failed_at,
           VALUES(first_failed_at)
         ),
         last_failed_at = VALUES(last_failed_at),
         failure_count = IF(
           resolved_at IS NULL,
           failure_count + 1,
           1
         ),
         last_due_at = VALUES(last_due_at),
         last_entitlement_version = VALUES(last_entitlement_version),
         last_error_code = VALUES(last_error_code),
         last_error_summary = VALUES(last_error_summary),
         resolved_at = NULL,
         resolution_reason = NULL,
         updated_at = NOW()`,
      [
        input.candidate.organizationId,
        input.candidate.kind,
        input.failedAt,
        input.failedAt,
        new Date(input.candidate.dueAt),
        input.candidate.version,
        safe.code,
        safe.summary,
      ],
    );
  }

  public async reconcileResolved(
    now: Date,
  ): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE lifecycle_automation_attention a
       LEFT JOIN organization_entitlements e
         ON e.organization_id = a.organization_id
       SET
         a.resolved_at = ?,
         a.resolution_reason = 'NO_LONGER_DUE',
         a.updated_at = NOW()
       WHERE a.resolved_at IS NULL
         AND (
           e.id IS NULL
           OR NOT (
             (
               a.automation_kind = 'SCHEDULED_SUSPENSION'
               AND e.access_status IN ('ACTIVE', 'GRACE_PERIOD')
               AND e.scheduled_suspension_at IS NOT NULL
               AND e.scheduled_suspension_at <= ?
             )
             OR (
               a.automation_kind = 'GRACE_EXPIRY'
               AND (
                 (
                   e.access_status = 'GRACE_PERIOD'
                   AND e.grace_ends_at IS NOT NULL
                   AND e.grace_ends_at <= ?
                 )
                 OR (
                   e.access_status = 'ACTIVE'
                   AND e.access_ends_at IS NOT NULL
                   AND e.access_ends_at <= ?
                   AND e.grace_ends_at IS NOT NULL
                   AND e.grace_ends_at > e.access_ends_at
                   AND e.grace_ends_at <= ?
                 )
                 OR (
                   e.access_status = 'TRIAL'
                   AND e.trial_ends_at IS NOT NULL
                   AND e.trial_ends_at <= ?
                   AND e.grace_ends_at IS NOT NULL
                   AND e.grace_ends_at > e.trial_ends_at
                   AND e.grace_ends_at <= ?
                 )
               )
             )
             OR (
               a.automation_kind = 'ACTIVE_EXPIRY'
               AND e.access_status = 'ACTIVE'
               AND e.access_ends_at IS NOT NULL
               AND e.access_ends_at <= ?
               AND (
                 e.grace_ends_at IS NULL
                 OR e.grace_ends_at <= e.access_ends_at
               )
             )
             OR (
               a.automation_kind = 'TRIAL_EXPIRY'
               AND e.access_status = 'TRIAL'
               AND e.trial_ends_at IS NOT NULL
               AND e.trial_ends_at <= ?
               AND (
                 e.grace_ends_at IS NULL
                 OR e.grace_ends_at <= e.trial_ends_at
               )
             )
           )
         )`,
      [
        now,
        now,
        now,
        now,
        now,
        now,
        now,
        now,
        now,
      ],
    );

    return Number(result.affectedRows);
  }
}

export type LifecycleAutomationAttentionKind = LifecycleAutomationKind;

export const lifecycleAutomationAttentionRepository =
  new LifecycleAutomationAttentionRepository();
