import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'];
  const candidate = typeof incomingId === 'string' ? incomingId.trim() : '';
  const requestId = candidate.length > 0 && candidate.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(candidate)
    ? candidate
    : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
