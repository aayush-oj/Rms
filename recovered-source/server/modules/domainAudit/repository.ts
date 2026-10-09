import { getDatabasePool } from '../../db/pool';

export interface DomainAuditInput {
  organizationId: number;
  branchId: number | null;
  actorUserId: number;
  actorName: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | number;
  relatedEntityType?: string | null;
  relatedEntityId?: string | number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
}

export const domainAuditRepository = {
  async append(input: DomainAuditInput): Promise<void> {
    await getDatabasePool().execute(
      `INSERT INTO domain_audit_events
       (organization_id, branch_id, actor_user_id, actor_name, actor_role, action,
        entity_type, entity_id, related_entity_type, related_entity_id,
        before_json, after_json, metadata_json, reason, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationId,
        input.branchId,
        input.actorUserId,
        input.actorName,
        input.actorRole,
        input.action,
        input.entityType,
        String(input.entityId),
        input.relatedEntityType ?? null,
        input.relatedEntityId == null ? null : String(input.relatedEntityId),
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.reason ?? null,
        input.requestId ?? null,
      ]
    );
  },
};
