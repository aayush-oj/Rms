import path from 'path';
import http from 'http';
import { createApp } from './app';
import { allowedOrigins, getEnv } from './config/env';
import { logger } from './lib/logger';
import { checkDatabaseConnection, closeDatabasePool } from './db/pool';
import { migrationRunner } from './db/migrations';
import { identityRepository } from './modules/identity/repository';
import { Server as SocketIOServer } from 'socket.io';
import { realtimeGateway } from './realtime/gateway';
import { actionAlertEvaluator } from './modules/alerts/actionEvaluator';
import { lifecycleAutomationWorker } from './modules/organizationAccess/lifecycleAutomationWorker';
import { platformAdminSessionMaintenanceWorker } from './modules/platformAdmin/sessionMaintenanceWorker';
import { bootstrapPlatformAdminFromEnvironment } from './modules/platformAdmin/bootstrap';

export async function startServer(): Promise<{ server: http.Server; port: number }> {
  const env = getEnv();
  const app = createApp();

  if (env.NODE_ENV !== 'production') {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
      app.use(vite.middlewares);
      logger.info('Vite development middleware mounted.');
    } catch (viteErr) {
      logger.warn('Failed to mount Vite middleware. Serving API only.', { error: viteErr });
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const express = (await import('express')).default;
    app.use(express.static(distPath));
    app.get('*', (_req, res) => { res.sendFile(path.join(distPath, 'index.html')); });
    logger.info(`Static production assets served from ${distPath}`);
  }

  const server = http.createServer(app);
  const realtimeOrigins = new Set(allowedOrigins());
  const io = new SocketIOServer(server, {
    path: '/socket.io',
    cors: { origin: [...realtimeOrigins], credentials: true, methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || realtimeOrigins.has(origin));
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 64 * 1024,
  });
  realtimeGateway.attach(io);

  const PORT = env.PORT;
  const dbStatus = await checkDatabaseConnection();
  if (!dbStatus.healthy && env.NODE_ENV === 'production') {
    throw new Error(`Production startup refused: authoritative MySQL is unavailable (${dbStatus.message})`);
  }
  if (dbStatus.healthy) {
    logger.info(`Database connectivity verified (${dbStatus.latencyMs}ms latency).`);
    const migrationResult = await migrationRunner.runPending();
    if (migrationResult.applied.length > 0) {
      logger.info(`[MigrationRunner] Applied ${migrationResult.applied.length} pending migration(s).`, {
        migrations: migrationResult.applied,
        batch: migrationResult.batch,
      });
    }

    const platformBootstrap = await bootstrapPlatformAdminFromEnvironment();
    if (platformBootstrap.status === 'created') {
      logger.info('Initial Platform Admin created from protected environment configuration.', {
        platformAdminId: platformBootstrap.admin.id,
        email: platformBootstrap.admin.email,
      });
    } else if (platformBootstrap.status === 'already-bootstrapped') {
      logger.info('Platform Admin environment bootstrap skipped because an account already exists.');
    }
  } else {
    logger.warn(`Database unavailable (${dbStatus.message}). Development/test identity fallback only.`);
  }

  await identityRepository.initialize();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, env.HOST, () => {
      server.off('error', reject);
      logger.info(`FoodieHub RMS Backend running on http://${env.HOST}:${PORT} [${env.NODE_ENV}]`);
      resolve();
    });
  });

  if (dbStatus.healthy) {
    await actionAlertEvaluator.start();
    lifecycleAutomationWorker.start();
    platformAdminSessionMaintenanceWorker.start();
  }

  let isShuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`Received ${signal}. Initiating graceful shutdown...`);
    lifecycleAutomationWorker.stop();
    platformAdminSessionMaintenanceWorker.stop();
    server.close(async () => {
      logger.info('HTTP server closed.');
      actionAlertEvaluator.stop();
      try { await closeDatabasePool(); }
      catch (poolErr) { logger.error('Error while closing database pool:', { error: poolErr }); }
      logger.info('Graceful shutdown complete. Process exiting.');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forceful shutdown timeout reached. Terminating process.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Promise Rejection: ${String(reason)}`, { reason });
  });

  return { server, port: PORT };
}
