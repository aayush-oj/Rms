import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    const logContext = {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode,
      durationMs,
    };

    if (statusCode >= 500) {
      logger.error(`HTTP ${req.method} ${req.originalUrl} finished ${statusCode}`, logContext);
    } else if (statusCode >= 400) {
      logger.warn(`HTTP ${req.method} ${req.originalUrl} finished ${statusCode}`, logContext);
    } else {
      logger.info(`HTTP ${req.method} ${req.originalUrl} finished ${statusCode}`, logContext);
    }
  });

  next();
}
