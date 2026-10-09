import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import type { ActivationRequestStatus } from '../activationRequests/types';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from '../organizationAccess/types';
import type {
  PlatformActivationRequestReadRecord,
} from './activationRequestReadTypes';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toNullableIso(value: unknown): string | null {
  return value == null ? null : toIso(value);
}

function mapEntitlement(row: RowDataPacket): OrganizationEntitlement | null {
  if (row.entitlement_id == null) return null;
  return {
    id: Number(row.entitlement_id),
    organizationId: Number(row.organization_id),
    accessStatus: String(
      row.entitlement_access_status,
    ) as OrganizationAccessStatus,
    trialStartedAt: toNullableIso(row.entitlement_trial_started_at),
    trialEndsAt: toNullableIso(row.entitlement_trial_ends_at),
    activatedAt: toNullableIso(row.entitlement_activated_at),
    accessEndsAt: toNullableIso(row.entitlement_access_ends_at),
    graceEndsAt: toNullableIso(row.entitlement_grace_ends_at),
    scheduledSuspensionAt: toNullableIso(
      row.entitlement_scheduled_suspension_at,
    ),
    scheduledSuspensionReason:
      row.entitlement_scheduled_suspension_reason == null
        ? null
        : String(row.entitlement_scheduled_suspension_reason),
    scheduledSuspensionCustomerMessage:
      row.entitlement_scheduled_suspension_customer_message == null
        ? null
        : String(row.entitlement_scheduled_suspension_customer_message),
    suspendedAt: toNullableIso(row.entitlement_suspended_at),
    cancelledAt: toNullableIso(row.entitlement_cancelled_at),
    internalReason:
      row.entitlement_internal_reason == null
        ? null
        : String(row.entitlement_internal_reason),
    customerMessage:
      row.entitlement_customer_message == null
        ? null
        : String(row.entitlement_customer_message),
    version: Number(row.entitlement_version),
    createdAt: toIso(row.entitlement_created_at),
    updatedAt: toIso(row.entitlement_updated_at),
  };
}

function mapRecord(row: RowDataPacket): PlatformActivationRequestReadRecord {
  return {
    id: Number(row.request_id),
    organizationId: Number(row.organization_id),
    organizationHandle: String(row.organization_handle),
    organizationName: String(row.organization_name),
    primaryBranchName:
      row.primary_branch_name == null ? null : String(row.primary_branch_name),
    primaryBranchAddress:
      row.primary_branch_address == null ? null : String(row.primary_branch_address),
    requestedByUserId: Number(row.requested_by_user_id),
    requesterNameSnapshot: String(row.requester_name_snapshot),
    requesterEmailSnapshot:
      row.requester_email_snapshot == null
        ? null
        : String(row.requester_email_snapshot),
    requesterPhoneSnapshot:
      row.requester_phone_snapshot == null
        ? null
        : String(row.requester_phone_snapshot),
    note: row.note == null ? null : String(row.note),
    status: String(row.request_status) as ActivationRequestStatus,
    reviewedByPlatformAdminId:
      row.reviewed_by_platform_admin_id == null
        ? null
        : Number(row.reviewed_by_platform_admin_id),
    reviewerName:
      row.reviewer_name == null ? null : String(row.reviewer_name),
    reviewerEmail:
      row.reviewer_email == null ? null : String(row.reviewer_email),
    reviewNote:
      row.review_note == null ? null : String(row.review_note),
    createdAt: toIso(row.request_created_at),
    reviewedAt: toNullableIso(row.reviewed_at),
    updatedAt: toIso(row.request_updated_at),
    entitlement: mapEntitlement(row),
  };
}

function escapeLike(value: string): string {
  return value.replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_');
}

const BASE_SELECT = `
  SELECT
    ar.id AS request_id,
    ar.organization_id,
    ar.requested_by_user_id,
    ar.requester_name_snapshot,
    ar.requester_email_snapshot,
    ar.requester_phone_snapshot,
    ar.note,
    ar.status AS request_status,
    ar.reviewed_by_platform_admin_id,
    ar.review_note,
    ar.created_at AS request_created_at,
    ar.reviewed_at,
    ar.updated_at AS request_updated_at,

    o.handle AS organization_handle,
    o.name AS organization_name,
    (
      SELECT b.name
        FROM branches b
       WHERE b.organization_id = o.id
       ORDER BY b.is_active DESC, b.id ASC
       LIMIT 1
    ) AS primary_branch_name,
    (
      SELECT b.address
        FROM branches b
       WHERE b.organization_id = o.id
       ORDER BY b.is_active DESC, b.id ASC
       LIMIT 1
    ) AS primary_branch_address,

    pa.name AS reviewer_name,
    pa.email AS reviewer_email,

    e.id AS entitlement_id,
    e.access_status AS entitlement_access_status,
    e.trial_started_at AS entitlement_trial_started_at,
    e.trial_ends_at AS entitlement_trial_ends_at,
    e.activated_at AS entitlement_activated_at,
    e.access_ends_at AS entitlement_access_ends_at,
    e.grace_ends_at AS entitlement_grace_ends_at,
    e.scheduled_suspension_at AS entitlement_scheduled_suspension_at,
    e.scheduled_suspension_reason AS entitlement_scheduled_suspension_reason,
    e.scheduled_suspension_customer_message
      AS entitlement_scheduled_suspension_customer_message,
    e.suspended_at AS entitlement_suspended_at,
    e.cancelled_at AS entitlement_cancelled_at,
    e.internal_reason AS entitlement_internal_reason,
    e.customer_message AS entitlement_customer_message,
    e.version AS entitlement_version,
    e.created_at AS entitlement_created_at,
    e.updated_at AS entitlement_updated_at
  FROM organization_activation_requests ar
  JOIN organizations o ON o.id = ar.organization_id
  LEFT JOIN platform_admins pa
    ON pa.id = ar.reviewed_by_platform_admin_id
  LEFT JOIN organization_entitlements e
    ON e.organization_id = ar.organization_id
`;

export interface PlatformActivationRequestStableFilters {
  status?: ActivationRequestStatus;
  search?: string;
}

function whereClause(
  filters: PlatformActivationRequestStableFilters,
): { sql: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];

  if (filters.status) {
    clauses.push('ar.status = ?');
    params.push(filters.status);
  }

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    clauses.push(`(
      o.name LIKE ? ESCAPE '='
      OR o.handle LIKE ? ESCAPE '='
      OR ar.requester_name_snapshot LIKE ? ESCAPE '='
      OR ar.requester_email_snapshot LIKE ? ESCAPE '='
    )`);
    params.push(pattern, pattern, pattern, pattern);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export class PlatformActivationRequestReadRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  public async list(input: PlatformActivationRequestStableFilters & {
    limit: number;
    offset: number;
  }): Promise<{
    rows: PlatformActivationRequestReadRecord[];
    total: number;
  }> {
    const where = whereClause(input);

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
         FROM organization_activation_requests ar
         JOIN organizations o ON o.id = ar.organization_id
         ${where.sql}`,
      where.params,
    );

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       ${where.sql}
       ORDER BY
         CASE WHEN ar.status = 'OPEN' THEN 0 ELSE 1 END,
         ar.created_at DESC,
         ar.id DESC
       LIMIT ? OFFSET ?`,
      [...where.params, input.limit, input.offset],
    );

    return {
      rows: rows.map(mapRecord),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  public async findById(
    requestId: number,
  ): Promise<PlatformActivationRequestReadRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `${BASE_SELECT}
       WHERE ar.id = ?
       LIMIT 1`,
      [requestId],
    );
    return rows.length ? mapRecord(rows[0]) : null;
  }
}

export const platformActivationRequestReadRepository =
  new PlatformActivationRequestReadRepository();
