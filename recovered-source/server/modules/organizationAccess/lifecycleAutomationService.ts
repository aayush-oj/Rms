import { logger } from '../../lib/logger';
import {
  OrganizationBlockingInvalidationService,
  organizationBlockingInvalidationService,
} from './blockingInvalidation';
import {
  LifecycleAutomationRepository,
  lifecycleAutomationRepository,
  type LifecycleAutomationKind,
} from './lifecycleAutomationRepository';
import {
  LifecycleAutomationAttentionRepository,
  lifecycleAutomationAttentionRepository,
} from './lifecycleAutomationAttentionRepository';

export interface LifecycleAutomationRunFailure {
  organizationId: number;
  kind: LifecycleAutomationKind | 'RUN';
  error: string;
}

export interface LifecycleAutomationRunResult {
  scanned: number;
  executed: number;
  skipped: number;
  failed: number;
  failures: LifecycleAutomationRunFailure[];
}

export class LifecycleAutomationService {
  constructor(
    private readonly repository: LifecycleAutomationRepository =
      lifecycleAutomationRepository,
    private readonly blockingInvalidation:
      OrganizationBlockingInvalidationService =
      organizationBlockingInvalidationService,
    private readonly attentionRepository:
      LifecycleAutomationAttentionRepository =
      lifecycleAutomationAttentionRepository,
  ) {}

  public async runDueOnce(
    now: Date = new Date(),
    limit = 50,
  ): Promise<LifecycleAutomationRunResult> {
    const candidates = await this.repository.listDueCandidates(now, limit);

    const result: LifecycleAutomationRunResult = {
      scanned: candidates.length,
      executed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };

    for (const candidate of candidates) {
      try {
        const execution =
          await this.repository.executeCandidateAtomically(candidate, now);

        if (execution.outcome === 'SKIPPED') {
          result.skipped += 1;
          continue;
        }

        result.executed += 1;
        await this.blockingInvalidation.afterCommittedTransition(
          execution.entitlement,
        );
      } catch (error) {
        result.failed += 1;
        const message =
          error instanceof Error ? error.message : String(error);

        result.failures.push({
          organizationId: candidate.organizationId,
          kind: candidate.kind,
          error: message,
        });

        logger.error('Scheduled lifecycle automation candidate failed', {
          organizationId: candidate.organizationId,
          kind: candidate.kind,
          error,
        });

        try {
          await this.attentionRepository.recordFailure({
            candidate,
            failedAt: now,
            error,
          });
        } catch (attentionError) {
          logger.error(
            'Lifecycle automation failure attention persistence failed',
            {
              organizationId: candidate.organizationId,
              kind: candidate.kind,
              error: attentionError,
            },
          );
        }
      }
    }

    try {
      await this.attentionRepository.reconcileResolved(now);
    } catch (attentionError) {
      logger.error(
        'Lifecycle automation failure attention reconciliation failed',
        { error: attentionError },
      );
    }

    return result;
  }
}

export const lifecycleAutomationService =
  new LifecycleAutomationService();
