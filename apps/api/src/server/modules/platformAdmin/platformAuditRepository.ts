import type {
  PoolConnection,
  ResultSetHeader,
} from 'mysql2/promise';

export interface PlatformAuditAppendInput {
  platformAdminId: number | null;
  organizationId: number | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

function jsonValue(value: unknown): string | null {
  return value === undefined || value === null
    ? null
    : JSON.stringify(value);
}

export class PlatformAuditRepository {
  public async appendInTransaction(
    connection: PoolConnection,
    input: PlatformAuditAppendInput,
  ): Promise<number> {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO platform_audit_logs (
         platform_admin_id,
         organization_id,
         action,
         target_type,
         target_id,
         before_json,
         after_json,
         reason,
         ip_address,
         user_agent,
         request_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.platformAdminId,
        input.organizationId,
        input.action,
        input.targetType,
        input.targetId ?? null,
        jsonValue(input.before),
        jsonValue(input.after),
        input.reason ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.requestId ?? null,
      ],
    );

    return Number(result.insertId);
  }
}

export const platformAuditRepository = new PlatformAuditRepository();
