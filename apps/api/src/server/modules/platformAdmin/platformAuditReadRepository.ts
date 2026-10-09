import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import type { PlatformAuditReadRecord } from './platformAuditReadTypes';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function jsonValue(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapRecord(row: RowDataPacket): PlatformAuditReadRecord {
  return {
    id: Number(row.audit_id),
    platformAdminId:
      row.platform_admin_id == null ? null : Number(row.platform_admin_id),
    platformAdminName:
      row.platform_admin_name == null
        ? null
        : String(row.platform_admin_name),
    platformAdminEmail:
      row.platform_admin_email == null
        ? null
        : String(row.platform_admin_email),
    organizationId:
      row.organization_id == null ? null : Number(row.organization_id),
    organizationHandle:
      row.organization_handle == null
        ? null
        : String(row.organization_handle),
    organizationName:
      row.organization_name == null
        ? null
        : String(row.organization_name),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: row.target_id == null ? null : String(row.target_id),
    before: jsonValue(row.before_json),
    after: jsonValue(row.after_json),
    reason: row.reason == null ? null : String(row.reason),
    ipAddress: row.ip_address == null ? null : String(row.ip_address),
    userAgent: row.user_agent == null ? null : String(row.user_agent),
    requestId: row.request_id == null ? null : String(row.request_id),
    createdAt: toIso(row.created_at),
  };
}

const BASE_SELECT = `
  SELECT
    pal.id AS audit_id,
    pal.platform_admin_id,
    pa.name AS platform_admin_name,
    pa.email AS platform_admin_email,
    pal.organization_id,
    o.handle AS organization_handle,
    o.name AS organization_name,
    pal.action,
    pal.target_type,
    pal.target_id,
    pal.before_json,
    pal.after_json,
    pal.reason,
    pal.ip_address,
    pal.user_agent,
    pal.request_id,
    pal.created_at
  FROM platform_audit_logs pal
  LEFT JOIN platform_admins pa
    ON pa.id = pal.platform_admin_id
  LEFT JOIN organizations o
    ON o.id = pal.organization_id
`;

interface StableFilters {
  organizationId?: number;
  platformAdminId?: number;
  action?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
}

function whereClause(
  filters: StableFilters,
): { sql: string; params: Array<string | number | Date> } {
  const clauses: string[] = [];
  const params: Array<string | number | Date> = [];

  if (filters.organizationId != null) {
    clauses.push('pal.organization_id = ?');
    params.push(filters.organizationId);
  }

  if (filters.platformAdminId != null) {
    clauses.push('pal.platform_admin_id = ?');
    params.push(filters.platformAdminId);
  }

  if (filters.action) {
    clauses.push('pal.action = ?');
    params.push(filters.action);
  }

  if (filters.targetType) {
    clauses.push('pal.target_type = ?');
    params.push(filters.targetType);
  }

  if (filters.from) {
    clauses.push('pal.created_at >= ?');
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push('pal.created_at <= ?');
    params.push(filters.to);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export class PlatformAuditReadRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  public async list(
    input: StableFilters & { limit: number; offset: number },
  ): Promise<{ rows: PlatformAuditReadRecord[]; total: number }> {
    const where = whereClause(input);

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM platform_audit_logs pal
         ${where.sql}`,
      where.params,
    );

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       ${where.sql}
       ORDER BY pal.created_at DESC, pal.id DESC
       LIMIT ? OFFSET ?`,
      [...where.params, input.limit, input.offset],
    );

    return {
      rows: rows.map(mapRecord),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  public async findById(
    auditId: number,
  ): Promise<PlatformAuditReadRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       WHERE pal.id = ?
       LIMIT 1`,
      [auditId],
    );

    return rows.length ? mapRecord(rows[0]) : null;
  }
}

export const platformAuditReadRepository =
  new PlatformAuditReadRepository();
