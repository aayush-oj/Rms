import { logger } from '../../lib/logger';
import {
  PlatformAdminSessionMaintenanceService,
  platformAdminSessionMaintenanceService,
  type PlatformSessionCleanupResult,
} from './sessionMaintenanceService';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30_000;

export class PlatformAdminSessionMaintenanceWorker {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly service:
      PlatformAdminSessionMaintenanceService =
        platformAdminSessionMaintenanceService,
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

    logger.info('Platform Admin session maintenance worker started', {
      intervalMinutes: Math.round(this.intervalMs / 60_000),
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
  ): Promise<PlatformSessionCleanupResult | null> {
    if (this.running) {
      logger.warn(
        'Platform Admin session maintenance run skipped because the previous run is still active',
      );
      return null;
    }

    this.running = true;

    try {
      const result = await this.service.cleanupStaleSessions(now);
      if (result.deleted > 0) {
        logger.info('Platform Admin stale sessions cleaned', {
          deleted: result.deleted,
          cutoff: result.cutoff,
        });
      }
      return result;
    } catch (error) {
      logger.error('Platform Admin session maintenance run failed', {
        error,
      });
      return null;
    } finally {
      this.running = false;
    }
  }
}

export const platformAdminSessionMaintenanceWorker =
  new PlatformAdminSessionMaintenanceWorker();
