import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors';
import { ApiErrorResponse } from '../shared/types';
import { logger } from '../lib/logger';
import { getEnv } from '../config/env';

export function errorHandlerMiddleware(
  err: Error | AppError,
  req: Request,
  res: Response,
  // Express requires 4 arguments to recognize error middleware
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const env = getEnv();
  const requestId = req.id || 'unknown';
  const timestamp = new Date().toISOString();

  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred.';
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    message = err.message;
    details = err.details;
  } else if (err.message === 'CORS_ORIGIN_FORBIDDEN') {
    statusCode = 403;
    errorCode = 'CORS_ORIGIN_FORBIDDEN';
    message = 'Request origin is not allowed.';
  } else if ((err as any).type === 'entity.parse.failed') {
    statusCode = 400;
    errorCode = 'MALFORMED_JSON';
    message = 'Malformed JSON payload received in request body.';
  }

  // Log the error
  const logContext = {
    requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode,
    errorCode,
    message: err.message,
    stack: env.NODE_ENV !== 'production' ? err.stack : undefined,
  };

  if (statusCode >= 500) {
    logger.error(`Unhandled server error: ${err.message}`, logContext);
  } else {
    logger.warn(`Operational request error: ${err.message}`, logContext);
  }

  const responseBody: ApiErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message,
      statusCode,
      details,
      requestId,
      timestamp,
    },
  };

  res.status(statusCode).json(responseBody);
}
