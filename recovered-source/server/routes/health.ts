import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { checkDatabaseConnection } from '../db/pool';
import { migrationRunner } from '../db/migrations';
import { getEnv } from '../config/env';
import { HealthCheckData } from '../shared/types';

export const healthRouter = Router();
const runtimeInstanceId = randomUUID();

export async function handleHealthCheck(_req: Request, res: Response): Promise<void> {
  const env = getEnv();
  const dbHealth = await checkDatabaseConnection();

  const healthData: HealthCheckData = {
    status: dbHealth.healthy ? 'ok' : 'degraded',
    application: 'healthy',
    database: dbHealth.healthy ? 'connected' : 'unavailable',
    databaseLatencyMs: dbHealth.latencyMs ?? null,
    environment: env.NODE_ENV,
    apiVersion: 'v1',
    instanceId: runtimeInstanceId,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    phase: 'Production stabilization',
  };

  // Liveness stays HTTP 200 so infrastructure can distinguish an alive process
  // from dependency readiness. Use /api/ready before sending production traffic.
  res.status(200).json({
    success: true,
    data: healthData,
  });
}

export async function handleReadinessCheck(_req: Request, res: Response): Promise<void> {
  const dbHealth = await checkDatabaseConnection();
  if (!dbHealth.healthy) {
    res.status(503).json({
      success: false,
      data: {
        status: 'not_ready',
        database: 'unavailable',
        databaseLatencyMs: dbHealth.latencyMs ?? null,
        migrations: 'unknown',
        pendingMigrations: [],
        instanceId: runtimeInstanceId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  const migrations = await migrationRunner.getMigrationStatus();
  const ready = migrations.initialized && migrations.pendingCount === 0;
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: {
      status: ready ? 'ready' : 'not_ready',
      database: 'connected',
      databaseLatencyMs: dbHealth.latencyMs ?? null,
      migrations: migrations.initialized ? (ready ? 'current' : 'pending') : 'unavailable',
      pendingMigrations: migrations.pending,
      totalRegisteredMigrations: migrations.totalRegistered,
      totalAppliedMigrations: migrations.totalApplied,
      instanceId: runtimeInstanceId,
      timestamp: new Date().toISOString(),
    },
  });
}

healthRouter.get('/health', handleHealthCheck);
healthRouter.get('/ready', handleReadinessCheck);
