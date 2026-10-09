import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';

export interface ActivityLogRecord {
  id: number;
  organizationId: number;
  branchId: number | null;
  actorUserId: number;
  actorName: string;
  actorRole: string;
  method: string;
  action: string;
  path: string;
  entityType: string | null;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  statusCode: number;
  success: boolean;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

function mapRow(row: RowDataPacket): ActivityLogRecord {
  let changes: Record<string, unknown> | null = null;
  if (row.changes_json != null) {
    if (typeof row.changes_json === 'string') {
      try { changes = JSON.parse(row.changes_json); } catch { changes = null; }
    } else if (typeof row.changes_json === 'object') {
      changes = row.changes_json as Record<string, unknown>;
    }
  }
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    actorUserId: Number(row.actor_user_id),
    actorName: String(row.actor_name),
    actorRole: String(row.actor_role),
    method: String(row.method),
    action: String(row.action),
    path: String(row.path),
    entityType: row.entity_type == null ? null : String(row.entity_type),
    entityId: row.entity_id == null ? null : String(row.entity_id),
    changes,
    statusCode: Number(row.status_code),
    success: Boolean(row.success),
    ipAddress: row.ip_address == null ? null : String(row.ip_address),
    requestId: row.request_id == null ? null : String(row.request_id),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export const activityLogRepository = {
  async append(input: Omit<ActivityLogRecord, 'id' | 'createdAt'>): Promise<void> {
    await getDatabasePool().execute(
      `INSERT INTO activity_logs
       (organization_id, branch_id, actor_user_id, actor_name, actor_role, method, action, path,
        entity_type, entity_id, changes_json, status_code, success, ip_address, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationId, input.branchId, input.actorUserId, input.actorName, input.actorRole,
        input.method, input.action, input.path, input.entityType, input.entityId,
        input.changes ? JSON.stringify(input.changes) : null, input.statusCode, input.success,
        input.ipAddress, input.requestId,
      ]
    );
  },

  async list(organizationId: number, filters: {
    branchId?: number; actorUserId?: number; method?: string; search?: string; from?: string; to?: string; limit?: number; offset?: number;
  }): Promise<ActivityLogRecord[]> {
    let sql = 'SELECT * FROM activity_logs WHERE organization_id = ?';
    const params: Array<string | number> = [organizationId];
    if (filters.branchId) { sql += ' AND branch_id = ?'; params.push(filters.branchId); }
    if (filters.actorUserId) { sql += ' AND actor_user_id = ?'; params.push(filters.actorUserId); }
    if (filters.method) { sql += ' AND method = ?'; params.push(filters.method.toUpperCase()); }
    if (filters.from) { sql += ' AND created_at >= ?'; params.push(filters.from); }
    if (filters.to) { sql += ' AND created_at <= ?'; params.push(filters.to); }
    if (filters.search) {
      sql += ' AND (actor_name LIKE ? OR actor_role LIKE ? OR action LIKE ? OR path LIKE ? OR entity_type LIKE ? OR entity_id LIKE ?)';
      const q = `%${filters.search}%`; params.push(q, q, q, q, q, q);
    }
    sql += ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
    params.push(Math.min(Math.max(filters.limit ?? 100, 1), 500), Math.max(filters.offset ?? 0, 0));
    const [rows] = await getDatabasePool().execute<RowDataPacket[]>(sql, params);
    return rows.map(mapRow);
  },
};
