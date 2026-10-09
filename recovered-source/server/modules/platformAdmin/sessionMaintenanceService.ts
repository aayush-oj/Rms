import crypto from 'node:crypto';
import type {
  Pool,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import {
  PlatformAuditRepository,
  platformAuditRepository,
} from './platformAuditRepository';
import {
  PlatformAdminRepository,
  platformAdminRepository,
} from './repository';

export const PLATFORM_SESSION_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000;
export const PLATFORM_SESSION_CLEANUP_BATCH_SIZE = 500;

export interface PlatformSessionCleanupResult {
  deleted: number;
  cutoff: string;
}

export interface PlatformAdminRevokeAllResult {
  platformAdminId: number;
  email: string;
  revokedSessions: number;
  auditId: number;
  requestId: string;
}

export class PlatformAdminSessionMaintenanceService {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly repository:
      PlatformAdminRepository = platformAdminRepository,
    private readonly audit:
      PlatformAuditRepository = platformAuditRepository,
  ) {}

  public async cleanupStaleSessions(
    now: Date = new Date(),
    retentionMs = PLATFORM_SESSION_RETENTION_MS,
    limit = PLATFORM_SESSION_CLEANUP_BATCH_SIZE,
  ): Promise<PlatformSessionCleanupResult> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error('Platform session cleanup requires a valid current time');
    }
    if (!Number.isFinite(retentionMs) || retentionMs < 0) {
      throw new Error('Platform session retention must be non-negative');
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 5000) {
      throw new Error('Platform session cleanup limit must be between 1 and 5000');
    }

    const cutoff = new Date(now.getTime() - retentionMs);
    const deleted = await this.repository.deleteStaleSessions(
      cutoff,
      limit,
    );

    return {
      deleted,
      cutoff: cutoff.toISOString(),
    };
  }

  public async revokeAllByEmail(
    email: string,
    reason: string,
  ): Promise<PlatformAdminRevokeAllResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedReason = reason.trim();

    if (!normalizedEmail) {
      throw new Error('Platform Admin email is required');
    }
    if (!normalizedReason) {
      throw new Error('A revoke-all reason is required');
    }
    if (normalizedReason.length > 500) {
      throw new Error('Revoke-all reason must be 500 characters or fewer');
    }

    const connection = await this.pool.getConnection();
    const requestId = `operator-${crypto.randomUUID()}`;

    try {
      await connection.beginTransaction();

      const [adminRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, email
           FROM platform_admins
          WHERE email = ?
          LIMIT 1
          FOR UPDATE`,
        [normalizedEmail],
      );

      if (!adminRows.length) {
        throw new Error('Platform Admin not found');
      }

      const platformAdminId = Number(adminRows[0].id);
      const resolvedEmail = String(adminRows[0].email);

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE platform_admin_sessions
            SET is_revoked = TRUE,
                revoked_at = COALESCE(revoked_at, NOW())
          WHERE platform_admin_id = ?
            AND is_revoked = FALSE
            AND expires_at > NOW()`,
        [platformAdminId],
      );

      const revokedSessions = Number(result.affectedRows);

      const auditId = await this.audit.appendInTransaction(
        connection,
        {
          platformAdminId: null,
          organizationId: null,
          action: 'PLATFORM_ADMIN_SESSIONS_REVOKED',
          targetType: 'PLATFORM_ADMIN',
          targetId: String(platformAdminId),
          before: {
            activeSessionsMatched: revokedSessions,
          },
          after: {
            revocationApplied: true,
            revokedSessions,
          },
          reason: normalizedReason,
          userAgent: 'operator-cli',
          requestId,
        },
      );

      await connection.commit();

      return {
        platformAdminId,
        email: resolvedEmail,
        revokedSessions,
        auditId,
        requestId,
      };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const platformAdminSessionMaintenanceService =
  new PlatformAdminSessionMaintenanceService();
