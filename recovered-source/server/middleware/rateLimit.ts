import { NextFunction, Request, Response } from 'express';
import { TooManyRequestsError } from '../shared/errors';

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  key?: (req: Request) => string;
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep > 60_000) {
      lastSweep = now;
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    }
    const identity = options.key?.(req) || clientIp(req);
    const key = `${options.keyPrefix}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > options.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return next(new TooManyRequestsError('Too many attempts. Please wait and try again.', 'RATE_LIMITED'));
    }
    next();
  };
}

export function resetRateLimitsForTests(): void { buckets.clear(); lastSweep = 0; }
