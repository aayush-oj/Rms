import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  getEnv,
  publicSupportContact,
  type PublicSupportContact,
} from '../../config/env';
import { getDatabasePool } from '../../db/pool';
import { UnauthorizedError, ForbiddenError } from '../../shared/errors';
import { identityRepository, type IdentityRepository } from './repository';
import { SYSTEM_ROLES } from './types';
import {
  organizationAccessService,
  type OrganizationAccessService,
} from '../organizationAccess/service';
import type { EffectiveOrganizationAccess } from '../organizationAccess/types';

const ACCESS_STATUS_ISSUER = 'mih-dineos-access-status';
const ACCESS_STATUS_AUDIENCE = 'mih-dineos-owner-status';
const ACCESS_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

export interface AccessStatusClaims {
  userId: number;
  organizationId: number;
  username: string;
  tokenId: string;
  authLevel: 'ACCESS_STATUS';
}

export interface AccessStatusContext {
  userId: number;
  organizationId: number;
  username: string;
  name: string;
  email: string | null;
  role: typeof SYSTEM_ROLES.OWNER;
  tokenId: string;
  organization: {
    id: number;
    name: string;
    legalName: string | null;
    currencyCode: string;
  };
  access: EffectiveOrganizationAccess;
}

export interface SafeAccessStatusResult {
  authLevel: 'ACCESS_STATUS';
  user: {
    id: number;
    name: string;
    username: string;
    email: string | null;
    role: typeof SYSTEM_ROLES.OWNER;
  };
  organization: AccessStatusContext['organization'];
  support: PublicSupportContact;
  access: {
    status: EffectiveOrganizationAccess['configuredStatus'];
    accessMode: EffectiveOrganizationAccess['accessMode'];
    reason: EffectiveOrganizationAccess['blockingReason'];
    customerMessage: string | null;
    trialEndsAt: string | null;
    accessEndsAt: string | null;
    graceEndsAt: string | null;
    scheduledSuspensionAt: string | null;
    suspendedAt: string | null;
    cancelledAt: string | null;
  };
}

export function safeAccessStatusResult(
  context: AccessStatusContext,
  support: PublicSupportContact = publicSupportContact(),
): SafeAccessStatusResult {
  return {
    authLevel: 'ACCESS_STATUS',
    user: {
      id: context.userId,
      name: context.name,
      username: context.username,
      email: context.email,
      role: context.role,
    },
    organization: context.organization,
    support,
    access: {
      status: context.access.configuredStatus,
      accessMode: context.access.accessMode,
      reason: context.access.blockingReason,
      customerMessage: context.access.customerMessage,
      trialEndsAt: context.access.trialEndsAt,
      accessEndsAt: context.access.accessEndsAt,
      graceEndsAt: context.access.graceEndsAt,
      scheduledSuspensionAt: context.access.scheduledSuspensionAt,
      suspendedAt: context.access.suspendedAt,
      cancelledAt: context.access.cancelledAt,
    },
  };
}

interface AccessStatusSessionRow extends RowDataPacket {
  token_id: string;
  user_id: number | string;
  organization_id: number | string;
  is_revoked: number | boolean;
  expires_at: Date | string;
}

export class AccessStatusSessionRepository {
  public async create(
    tokenId: string,
    userId: number,
    organizationId: number,
    expiresAt: Date,
  ): Promise<void> {
    await getDatabasePool().execute(
      `INSERT INTO organization_access_status_sessions
        (token_id, user_id, organization_id, expires_at)
       VALUES (?, ?, ?, ?)`,
      [tokenId, userId, organizationId, expiresAt],
    );
  }

  public async findActive(tokenId: string): Promise<{
    tokenId: string;
    userId: number;
    organizationId: number;
    expiresAt: string;
  } | null> {
    const [rows] = await getDatabasePool().execute<AccessStatusSessionRow[]>(
      `SELECT token_id, user_id, organization_id, is_revoked, expires_at
         FROM organization_access_status_sessions
        WHERE token_id = ?
        LIMIT 1`,
      [tokenId],
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (Boolean(Number(row.is_revoked))) return null;
    const expiresAt = new Date(row.expires_at);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return {
      tokenId: String(row.token_id),
      userId: Number(row.user_id),
      organizationId: Number(row.organization_id),
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async revoke(tokenId: string): Promise<void> {
    await getDatabasePool().execute<ResultSetHeader>(
      `UPDATE organization_access_status_sessions
          SET is_revoked = TRUE,
              revoked_at = COALESCE(revoked_at, NOW())
        WHERE token_id = ?`,
      [tokenId],
    );
  }
}

export class AccessStatusAuthService {
  constructor(
    private readonly sessions: AccessStatusSessionRepository =
      new AccessStatusSessionRepository(),
    private readonly identity: IdentityRepository = identityRepository,
    private readonly organizationAccess: OrganizationAccessService =
      organizationAccessService,
  ) {}

  public generateToken(claims: AccessStatusClaims): string {
    return jwt.sign(claims, getEnv().JWT_SECRET, {
      expiresIn: '24h',
      issuer: ACCESS_STATUS_ISSUER,
      audience: ACCESS_STATUS_AUDIENCE,
    });
  }

  public verifyToken(token: string): AccessStatusClaims {
    try {
      const decoded = jwt.verify(token, getEnv().JWT_SECRET, {
        issuer: ACCESS_STATUS_ISSUER,
        audience: ACCESS_STATUS_AUDIENCE,
      }) as Partial<AccessStatusClaims>;

      if (
        decoded.authLevel !== 'ACCESS_STATUS'
        || !Number.isInteger(decoded.userId)
        || !Number.isInteger(decoded.organizationId)
        || typeof decoded.username !== 'string'
        || typeof decoded.tokenId !== 'string'
        || !decoded.tokenId
      ) {
        throw new Error('invalid access-status claims');
      }

      return decoded as AccessStatusClaims;
    } catch {
      throw new UnauthorizedError(
        'Invalid or expired access-status session',
        'ACCESS_STATUS_TOKEN_INVALID',
      );
    }
  }

  public async issueForBlockedOwner(params: {
    userId: number;
    organizationId: number;
    username: string;
    role: string;
    access: EffectiveOrganizationAccess;
  }): Promise<{ token: string; expiresIn: '24h' }> {
    if (params.role !== SYSTEM_ROLES.OWNER) {
      throw new ForbiddenError(
        'Only the restaurant owner can access account status',
        'ACCESS_STATUS_OWNER_REQUIRED',
      );
    }
    if (params.access.canOperate || !params.access.ownerCanViewStatus) {
      throw new ForbiddenError(
        'Restricted account-status access is not available',
        'ACCESS_STATUS_NOT_AVAILABLE',
      );
    }

    const tokenId = crypto.randomUUID();
    const token = this.generateToken({
      userId: params.userId,
      organizationId: params.organizationId,
      username: params.username,
      tokenId,
      authLevel: 'ACCESS_STATUS',
    });
    await this.sessions.create(
      tokenId,
      params.userId,
      params.organizationId,
      new Date(Date.now() + ACCESS_STATUS_TTL_MS),
    );
    return { token, expiresIn: '24h' };
  }

  public async resolve(claims: AccessStatusClaims): Promise<AccessStatusContext> {
    const session = await this.sessions.findActive(claims.tokenId);
    if (
      !session
      || session.userId !== claims.userId
      || session.organizationId !== claims.organizationId
    ) {
      throw new UnauthorizedError(
        'Access-status session has expired or been revoked',
        'ACCESS_STATUS_SESSION_REVOKED',
      );
    }

    const user = await this.identity.findUserById(
      claims.organizationId,
      claims.userId,
    );
    if (!user?.isActive) {
      throw new UnauthorizedError(
        'Owner account is unavailable',
        'ACCESS_STATUS_USER_INACTIVE',
      );
    }

    const role = await this.identity.getRoleById(user.roleId, claims.organizationId);
    if (!role || role.name !== SYSTEM_ROLES.OWNER) {
      throw new ForbiddenError(
        'Only the restaurant owner can access account status',
        'ACCESS_STATUS_OWNER_REQUIRED',
      );
    }

    const organization = await this.identity.findOrganizationById(
      claims.organizationId,
    );
    if (!organization) {
      throw new UnauthorizedError(
        'Restaurant for this session is unavailable',
        'ACCESS_STATUS_ORGANIZATION_INVALID',
      );
    }

    const access = await this.organizationAccess.resolveEffectiveAccess(
      claims.organizationId,
    );
    if (access.canOperate || !access.ownerCanViewStatus) {
      throw new ForbiddenError(
        'Restricted account-status access is no longer available',
        'ACCESS_STATUS_NOT_AVAILABLE',
      );
    }

    return {
      userId: user.id,
      organizationId: organization.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: SYSTEM_ROLES.OWNER,
      tokenId: claims.tokenId,
      organization: {
        id: organization.id,
        name: organization.name,
        legalName: organization.legalName,
        currencyCode: organization.currencyCode,
      },
      access,
    };
  }

  public async revoke(tokenId: string): Promise<void> {
    await this.sessions.revoke(tokenId);
  }
}

export const accessStatusSessionRepository = new AccessStatusSessionRepository();
export const accessStatusAuthService = new AccessStatusAuthService(
  accessStatusSessionRepository,
);
