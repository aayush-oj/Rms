import { NextFunction, Request, Response } from 'express';
import { activityLogRepository } from '../modules/activityLog/repository';
import { logger } from '../lib/logger';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_PARTS = ['password', 'pin', 'token', 'secret', 'authorization', 'cookie', 'cvv', 'cardnumber', 'apikey', 'hash'];

function sanitize(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, '');
    output[key] = SENSITIVE_PARTS.some(part => normalized.includes(part)) ? '[REDACTED]' : sanitize(child);
  }
  return output;
}

function deriveEntity(path: string): { entityType: string | null; entityId: string | null } {
  const clean = path.split('?')[0].replace(/^\/api\/v1\/?/, '');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) return { entityType: null, entityId: null };
  const entityId = [...parts].reverse().find(part => /^\d+$/.test(part)) ?? null;
  const entityParts = parts.filter(part => !/^\d+$/.test(part) && !['status','serve','complete','cancel','usage'].includes(part));
  return { entityType: entityParts.slice(0, 3).join('.') || null, entityId };
}

function deriveAction(method: string, path: string): string {
  const verb = method === 'POST' ? 'CREATE/ACTION' : method === 'PATCH' || method === 'PUT' ? 'UPDATE' : method === 'DELETE' ? 'DELETE' : method;
  const clean = path.split('?')[0].replace(/^\/api\/v1\/?/, '');
  return `${verb} ${clean}`.slice(0, 80);
}

export function activityAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return next();
  const startedPath = req.originalUrl;
  const sanitizedBody = sanitize(req.body ?? {}) as Record<string, unknown>;

  res.on('finish', () => {
    const actor = req.user;
    if (!actor) return;
    const { entityType, entityId } = deriveEntity(startedPath);
    void activityLogRepository.append({
      organizationId: actor.organizationId,
      branchId: actor.activeBranchId || null,
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      method: req.method.toUpperCase(),
      action: deriveAction(req.method.toUpperCase(), startedPath),
      path: startedPath.slice(0, 255),
      entityType,
      entityId,
      changes: Object.keys(sanitizedBody).length ? sanitizedBody : null,
      statusCode: res.statusCode,
      success: res.statusCode >= 200 && res.statusCode < 400,
      ipAddress: req.ip?.slice(0, 64) || null,
      requestId: (res.getHeader('x-request-id') || req.headers['x-request-id'] || null) as string | null,
    }).catch((err) => logger.warn('Failed to append activity audit log', { err, method: req.method, url: startedPath }));
  });

  next();
}
