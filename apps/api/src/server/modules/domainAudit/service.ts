import { Request } from 'express';
import { logger } from '../../lib/logger';
import { DomainAuditInput, domainAuditRepository } from './repository';

export type DomainAuditDetails = Omit<
  DomainAuditInput,
  'organizationId' | 'branchId' | 'actorUserId' | 'actorName' | 'actorRole' | 'requestId'
>;

function requestId(req: Request): string | null {
  if (req.id) return String(req.id).slice(0, 100);
  const value = req.headers['x-request-id'];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;
}

/**
 * Append a structured business audit event after the authoritative transaction succeeds.
 * Audit persistence is intentionally best-effort: an audit storage outage must never make
 * a successfully committed payment/order/table transaction appear failed to the operator.
 */
export function appendDomainAudit(req: Request, details: DomainAuditDetails): void {
  const actor = req.user;
  if (!actor) return;

  void domainAuditRepository.append({
    organizationId: actor.organizationId,
    branchId: actor.activeBranchId || null,
    actorUserId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    requestId: requestId(req),
    ...details,
  }).catch((error) => {
    logger.warn('Failed to append domain audit event', {
      action: details.action,
      entityType: details.entityType,
      entityId: details.entityId,
      error,
    });
  });
}
