import type {
  Pool,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { ConflictError, ForbiddenError } from '../../shared/errors';
import type {
  ActivationRequestStatus,
  OrganizationActivationRequest,
} from './types';

interface ActivationRequestRow extends RowDataPacket {
  id: number | string;
  organization_id: number | string;
  requested_by_user_id: number | string;
  requester_name_snapshot: string;
  requester_email_snapshot: string | null;
  requester_phone_snapshot: string | null;
  note: string | null;
  status: ActivationRequestStatus;
  reviewed_by_platform_admin_id: number | string | null;
  review_note: string | null;
  created_at: Date | string;
  reviewed_at: Date | string | null;
  updated_at: Date | string;
}

interface RequesterSnapshotRow extends RowDataPacket {
  name: string;
  email: string | null;
  phone: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | null {
  return value == null ? null : iso(value);
}

function mapRequest(row: ActivationRequestRow): OrganizationActivationRequest {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
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
    status: row.status,
    reviewedByPlatformAdminId:
      row.reviewed_by_platform_admin_id == null
        ? null
        : Number(row.reviewed_by_platform_admin_id),
    reviewNote: row.review_note == null ? null : String(row.review_note),
    createdAt: iso(row.created_at),
    reviewedAt: optionalIso(row.reviewed_at),
    updatedAt: iso(row.updated_at),
  };
}

export interface ActivationRequesterSnapshot {
  name: string;
  email: string | null;
  phone: string | null;
}

export class OrganizationActivationRequestRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  public async findRequesterSnapshot(
    organizationId: number,
    userId: number,
  ): Promise<ActivationRequesterSnapshot> {
    const [rows] = await this.pool.execute<RequesterSnapshotRow[]>(
      `SELECT u.name, u.email, u.phone
         FROM users u
         JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?
          AND u.organization_id = ?
          AND u.is_active = TRUE
          AND r.name = 'OWNER'
        LIMIT 1`,
      [userId, organizationId],
    );

    if (!rows.length) {
      throw new ForbiddenError(
        'Owner account is unavailable for activation requests',
        'ACTIVATION_REQUEST_OWNER_UNAVAILABLE',
      );
    }

    return {
      name: String(rows[0].name),
      email: rows[0].email == null ? null : String(rows[0].email),
      phone: rows[0].phone == null ? null : String(rows[0].phone),
    };
  }

  public async createOpen(input: {
    organizationId: number;
    requestedByUserId: number;
    requester: ActivationRequesterSnapshot;
    note: string | null;
  }): Promise<OrganizationActivationRequest> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO organization_activation_requests
           (
             organization_id,
             requested_by_user_id,
             requester_name_snapshot,
             requester_email_snapshot,
             requester_phone_snapshot,
             note,
             status
           )
         VALUES (?, ?, ?, ?, ?, ?, 'OPEN')`,
        [
          input.organizationId,
          input.requestedByUserId,
          input.requester.name,
          input.requester.email,
          input.requester.phone,
          input.note,
        ],
      );

      const request = await this.findById(
        input.organizationId,
        Number(result.insertId),
      );
      if (!request) {
        throw new Error('Activation request was created but could not be read back');
      }
      return request;
    } catch (error: any) {
      if (error?.errno === 1062 || error?.code === 'ER_DUP_ENTRY') {
        throw new ConflictError(
          'An activation request is already open for this restaurant',
          'ACTIVATION_REQUEST_ALREADY_OPEN',
        );
      }
      throw error;
    }
  }

  public async findLatestForOrganization(
    organizationId: number,
  ): Promise<OrganizationActivationRequest | null> {
    const [rows] = await this.pool.execute<ActivationRequestRow[]>(
      `SELECT *
         FROM organization_activation_requests
        WHERE organization_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [organizationId],
    );
    return rows.length ? mapRequest(rows[0]) : null;
  }

  public async findById(
    organizationId: number,
    requestId: number,
  ): Promise<OrganizationActivationRequest | null> {
    const [rows] = await this.pool.execute<ActivationRequestRow[]>(
      `SELECT *
         FROM organization_activation_requests
        WHERE id = ?
          AND organization_id = ?
        LIMIT 1`,
      [requestId, organizationId],
    );
    return rows.length ? mapRequest(rows[0]) : null;
  }
}

export const organizationActivationRequestRepository =
  new OrganizationActivationRequestRepository();
