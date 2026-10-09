import path from 'path';
import express, { Express } from 'express';
import cors from 'cors';
import { allowedOrigins, getEnv, legacyStateEnabled } from './config/env';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { errorHandlerMiddleware } from './middleware/errorHandler';
import { notFoundMiddleware } from './middleware/notFound';
import { activityAuditMiddleware } from './middleware/activityAudit';
import { apiV1Router } from './routes';
import { stateRouter } from './routes/state';
import { handleHealthCheck, handleReadinessCheck } from './routes/health';
import { realtimeGateway } from './realtime/gateway';
import { securityHeadersMiddleware } from './middleware/security';
import { getUploadsRoot } from './config/uploads';
import { applyOperationalInventoryBoundary } from './modules/recipe/operationalBoundary';
import { applyOperationalTableReconciliationBoundary } from './modules/tableOperations/operationalBoundary';
import { platformMutationOriginGuard } from './modules/platformAdmin/originGuard';

export function createApp(): Express {
  getEnv();
  // Legacy recipe/unit inventory remains dormant, but the authoritative order
  // lifecycle now uses the simple count-based stock engine. Redirect the old
  // transactional recipe hooks before accepting requests so create/append/
  // cancel flows consume or restore simple stock inside the existing POS transaction.
  applyOperationalInventoryBoundary();

  // Keep all legacy order completion/cancellation paths on the same table
  // occupancy source of truth used by the Dining Floor and table operations.
  applyOperationalTableReconciliationBoundary();

  const app = express();
  app.disable('x-powered-by');
  // API consumers always expect a JSON body. Express ETags can otherwise turn
  // authenticated GETs such as /auth/me into empty 304 responses.
  app.disable('etag');
  if (getEnv().TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(securityHeadersMiddleware);
  app.use('/uploads', express.static(getUploadsRoot(), { maxAge: '1d' }));

  // Fail closed before CORS for cookie-authenticated unsafe Platform methods.
  // Safe methods and bearer-authenticated Platform API calls are unaffected.
  app.use('/api/v1/platform', platformMutationOriginGuard());

  const originAllowlist = new Set(allowedOrigins());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || originAllowlist.has(origin)) return callback(null, true);
      return callback(new Error('CORS_ORIGIN_FORBIDDEN'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'Idempotency-Key', 'X-RMS-Context'],
    maxAge: 600,
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '512kb' }));
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Registers before API routers; the finish callback reads req.user after route authentication.
  app.use('/api/v1', activityAuditMiddleware);

  app.get('/api/health', handleHealthCheck);
  app.get('/api/ready', handleReadinessCheck);
  app.get('/api/v1/realtime/health', (req, res) => {
    void req;
    res.json({ success: true, data: realtimeGateway.health() });
  });

  if (legacyStateEnabled()) app.use('/api/state', stateRouter);
  app.use('/api/v1', apiV1Router);
  app.use('/api', notFoundMiddleware);
  app.use(errorHandlerMiddleware);
  return app;
}
