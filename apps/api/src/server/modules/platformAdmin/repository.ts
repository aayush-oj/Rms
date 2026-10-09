import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import type {
  PlatformAdmin,
  PlatformAdminSessionContext,
  PlatformAdminSessionRecord,
  PlatformAdminWithSecrets,
} from './types';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return new Date(value as any).toISOString();
}

function toNullableIso(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function mapAdmin(row: RowDataPacket): PlatformAdmin {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    isActive: toBool(row.is_active),
    mustChangePassword: toBool(row.must_change_password),
    lastLoginAt: toNullableIso(row.last_login_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapAdminWithSecrets(row: RowDataPacket): PlatformAdminWithSecrets {
  return {
    ...mapAdmin(row),
    passwordHash: String(row.password_hash),
  };
}

function mapSession(row: RowDataPacket): PlatformAdminSessionRecord {
  return {
    tokenId: String(row.token_id),
    platformAdminId: Number(row.platform_admin_id),
    isRevoked: toBool(row.is_revoked),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    revokedAt: toNullableIso(row.revoked_at),
  };
}

export class PlatformAdminRepository {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  public async findByEmail(email: string): Promise<PlatformAdminWithSecrets | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name, email, password_hash, is_active, must_change_password, last_login_at, created_at, updated_at
         FROM platform_admins
        WHERE email = ?
        LIMIT 1`,
      [normalizedEmail]
    );
    if (!rows.length) return null;
    return mapAdminWithSecrets(rows[0]);
  }

  public async findById(id: number): Promise<PlatformAdmin | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name, email, is_active, must_change_password, last_login_at, created_at, updated_at
         FROM platform_admins
        WHERE id = ?
        LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;
    return mapAdmin(rows[0]);
  }

  public async recordSuccessfulLogin(id: number): Promise<void> {
    await this.pool.execute<ResultSetHeader>(
      'UPDATE platform_admins SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?',
      [id]
    );
  }

  public async replacePasswordAndRevokeSessions(
    platformAdminId: number,
    expectedPasswordHash: string,
    newPasswordHash: string,
  ): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE platform_admins
            SET password_hash = ?,
                must_change_password = FALSE,
                updated_at = NOW()
          WHERE id = ?
            AND password_hash = ?
            AND is_active = TRUE`,
        [newPasswordHash, platformAdminId, expectedPasswordHash],
      );

      if (result.affectedRows !== 1) {
        await connection.rollback();
        return false;
      }

      await connection.execute<ResultSetHeader>(
        `UPDATE platform_admin_sessions
            SET is_revoked = TRUE,
                revoked_at = COALESCE(revoked_at, NOW())
          WHERE platform_admin_id = ?
            AND is_revoked = FALSE`,
        [platformAdminId],
      );
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  public async createSession(
    tokenId: string,
    platformAdminId: number,
    expiresAt: Date
  ): Promise<PlatformAdminSessionRecord> {
    await this.pool.execute<ResultSetHeader>(
      `INSERT INTO platform_admin_sessions
        (token_id, platform_admin_id, is_revoked, expires_at)
       VALUES (?, ?, FALSE, ?)`,
      [tokenId, platformAdminId, expiresAt]
    );

    const session = await this.findSessionByTokenId(tokenId);
    if (!session) {
      throw new Error('Platform Admin session was created but could not be reloaded');
    }
    return session;
  }

  public async findSessionByTokenId(tokenId: string): Promise<PlatformAdminSessionRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT token_id, platform_admin_id, is_revoked, expires_at, created_at, revoked_at
         FROM platform_admin_sessions
        WHERE token_id = ?
        LIMIT 1`,
      [tokenId]
    );
    if (!rows.length) return null;
    return mapSession(rows[0]);
  }

  public async resolveActiveSession(tokenId: string): Promise<PlatformAdminSessionContext | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT
          s.token_id,
          s.platform_admin_id,
          s.is_revoked,
          s.expires_at,
          s.created_at AS session_created_at,
          s.revoked_at,
          a.id AS admin_id,
          a.name AS admin_name,
          a.email AS admin_email,
          a.is_active AS admin_is_active,
          a.must_change_password AS admin_must_change_password,
          a.last_login_at,
          a.created_at AS admin_created_at,
          a.updated_at AS admin_updated_at
         FROM platform_admin_sessions s
         INNER JOIN platform_admins a ON a.id = s.platform_admin_id
        WHERE s.token_id = ?
          AND s.is_revoked = FALSE
          AND s.expires_at > NOW()
          AND a.is_active = TRUE
        LIMIT 1`,
      [tokenId]
    );
    if (!rows.length) return null;

    const row = rows[0];
    return {
      session: {
        tokenId: String(row.token_id),
        platformAdminId: Number(row.platform_admin_id),
        isRevoked: toBool(row.is_revoked),
        expiresAt: toIso(row.expires_at),
        createdAt: toIso(row.session_created_at),
        revokedAt: toNullableIso(row.revoked_at),
      },
      admin: {
        id: Number(row.admin_id),
        name: String(row.admin_name),
        email: String(row.admin_email),
        isActive: toBool(row.admin_is_active),
        mustChangePassword: toBool(row.admin_must_change_password),
        lastLoginAt: toNullableIso(row.last_login_at),
        createdAt: toIso(row.admin_created_at),
        updatedAt: toIso(row.admin_updated_at),
      },
    };
  }

  public async revokeSession(tokenId: string): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE platform_admin_sessions
          SET is_revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE token_id = ?
          AND is_revoked = FALSE`,
      [tokenId]
    );
    return result.affectedRows > 0;
  }

  public async revokeAllSessionsForAdmin(platformAdminId: number): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE platform_admin_sessions
          SET is_revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE platform_admin_id = ?
          AND is_revoked = FALSE`,
      [platformAdminId]
    );
    return result.affectedRows;
  }

  public async deleteStaleSessions(
    cutoff: Date,
    limit: number,
  ): Promise<number> {
    const boundedLimit = Math.max(1, Math.min(5000, Math.trunc(limit)));
    const [result] = await this.pool.execute<ResultSetHeader>(
      `DELETE FROM platform_admin_sessions
        WHERE (
          expires_at <= ?
          OR (
            is_revoked = TRUE
            AND revoked_at IS NOT NULL
            AND revoked_at <= ?
          )
        )
        ORDER BY id ASC
        LIMIT ${boundedLimit}`,
      [cutoff, cutoff],
    );
    return result.affectedRows;
  }
}

export const platformAdminRepository = new PlatformAdminRepository();
