import { logger } from '../../lib/logger';
import {
  LifecycleAutomationService,
  lifecycleAutomationService,
  type LifecycleAutomationRunResult,
} from './lifecycleAutomationService';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 5_000;

export class LifecycleAutomationWorker {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly service: LifecycleAutomationService =
      lifecycleAutomationService,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
    private readonly initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  ) {}

  public start(): void {
    if (this.timer || this.initialTimer) return;

    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.runOnce();
    }, this.initialDelayMs);
    this.initialTimer.unref();

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();

    logger.info('Scheduled lifecycle automation worker started', {
      intervalSeconds: Math.round(this.intervalMs / 1000),
      initialDelaySeconds: Math.round(this.initialDelayMs / 1000),
    });
  }

  public stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  public async runOnce(
    now: Date = new Date(),
  ): Promise<LifecycleAutomationRunResult | null> {
    if (this.running) {
      logger.warn('Scheduled lifecycle automation run skipped because the previous run is still active');
      return null;
    }

    this.running = true;

    try {
      const result = await this.service.runDueOnce(now);

      if (
        result.executed > 0
        || result.failed > 0
        || result.skipped > 0
      ) {
        logger.info('Scheduled lifecycle automation run completed', {
          scanned: result.scanned,
          executed: result.executed,
          skipped: result.skipped,
          failed: result.failed,
        });
      }

      return result;
    } catch (error) {
      logger.error('Scheduled lifecycle automation run failed', { error });
      return {
        scanned: 0,
        executed: 0,
        skipped: 0,
        failed: 1,
        failures: [
          {
            organizationId: 0,
            kind: 'RUN',
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    } finally {
      this.running = false;
    }
  }
}

export const lifecycleAutomationWorker =
  new LifecycleAutomationWorker();
