import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { getEnv, platformJwtSecret } from '../../config/env';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../../shared/errors';
import {
  PlatformAdminRepository,
  platformAdminRepository,
} from './repository';
import {
  PlatformAdminSessionService,
  platformAdminSessionService,
} from './sessionService';
import type {
  PlatformAdminAuthClaims,
  PlatformAdminAuthResult,
  PlatformAdminSessionContext,
} from './types';

const PLATFORM_TOKEN_ISSUER = 'mih-dineos';
const PLATFORM_TOKEN_AUDIENCE = 'mih-dineos-platform';

export interface PlatformAdminTokenConfig {
  secret: string;
  expiresIn: string;
}

function envTokenConfig(): PlatformAdminTokenConfig {
  const env = getEnv();
  return {
    secret: platformJwtSecret(env),
    expiresIn: env.PLATFORM_JWT_EXPIRES_IN,
  };
}

function tokenExpiry(token: string): Date {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
    throw new Error('Platform Admin token was signed without an expiry');
  }
  return new Date(decoded.exp * 1000);
}

export class PlatformAdminAuthService {
  constructor(
    private readonly repository: PlatformAdminRepository = platformAdminRepository,
    private readonly sessions: PlatformAdminSessionService = platformAdminSessionService,
    private readonly tokenConfig: () => PlatformAdminTokenConfig = envTokenConfig,
  ) {}

  public async verifyPassword(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }

  public generateToken(params: {
    platformAdminId: number;
    email: string;
    tokenId: string;
  }): string {
    const config = this.tokenConfig();
    const payload: PlatformAdminAuthClaims = {
      realm: 'PLATFORM_ADMIN',
      platformAdminId: params.platformAdminId,
      email: params.email,
      tokenId: params.tokenId,
    };

    return jwt.sign(payload, config.secret, {
      expiresIn: config.expiresIn as any,
      issuer: PLATFORM_TOKEN_ISSUER,
      audience: PLATFORM_TOKEN_AUDIENCE,
      subject: String(params.platformAdminId),
      jwtid: params.tokenId,
    });
  }

  public verifyToken(token: string): PlatformAdminAuthClaims {
    const config = this.tokenConfig();

    try {
      const decoded = jwt.verify(token, config.secret, {
        issuer: PLATFORM_TOKEN_ISSUER,
        audience: PLATFORM_TOKEN_AUDIENCE,
      }) as JwtPayload & Partial<PlatformAdminAuthClaims>;

      if (
        decoded.realm !== 'PLATFORM_ADMIN'
        || !Number.isInteger(decoded.platformAdminId)
        || Number(decoded.platformAdminId) <= 0
        || typeof decoded.email !== 'string'
        || !decoded.email.trim()
        || typeof decoded.tokenId !== 'string'
        || !decoded.tokenId.trim()
        || decoded.tokenId !== decoded.jti
        || String(decoded.platformAdminId) !== decoded.sub
      ) {
        throw new Error('Invalid Platform Admin token claims');
      }

      return {
        realm: 'PLATFORM_ADMIN',
        platformAdminId: Number(decoded.platformAdminId),
        email: decoded.email,
        tokenId: decoded.tokenId,
      };
    } catch {
      throw new UnauthorizedError(
        'Invalid or expired Platform Admin token',
        'PLATFORM_TOKEN_INVALID'
      );
    }
  }

  public async login(params: {
    email: string;
    password: string;
  }): Promise<PlatformAdminAuthResult> {
    const admin = await this.repository.findByEmail(params.email);
    if (!admin) {
      throw new UnauthorizedError(
        'Invalid email or password',
        'INVALID_PLATFORM_CREDENTIALS'
      );
    }

    const passwordMatches = await this.verifyPassword(params.password, admin.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError(
        'Invalid email or password',
        'INVALID_PLATFORM_CREDENTIALS'
      );
    }

    if (!admin.isActive) {
      throw new ForbiddenError(
        'Platform Admin account is disabled',
        'PLATFORM_ADMIN_DISABLED'
      );
    }

    const tokenId = crypto.randomUUID();
    const token = this.generateToken({
      platformAdminId: admin.id,
      email: admin.email,
      tokenId,
    });
    const expiresAt = tokenExpiry(token);

    await this.sessions.createWithTokenId(tokenId, admin.id, expiresAt);

    try {
      await this.repository.recordSuccessfulLogin(admin.id);
    } catch (error) {
      await this.sessions.revoke(tokenId).catch(() => false);
      throw error;
    }

    const publicAdmin = await this.repository.findById(admin.id);
    if (!publicAdmin) {
      await this.sessions.revoke(tokenId).catch(() => false);
      throw new UnauthorizedError(
        'Platform Admin account is unavailable',
        'PLATFORM_ADMIN_UNAVAILABLE'
      );
    }

    return {
      admin: publicAdmin,
      token,
      tokenId,
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async resolveToken(token: string): Promise<PlatformAdminSessionContext> {
    const claims = this.verifyToken(token);
    const context = await this.sessions.resolve(claims.tokenId);

    if (!context || context.admin.id !== claims.platformAdminId) {
      throw new UnauthorizedError(
        'Platform Admin session is invalid or expired',
        'PLATFORM_SESSION_INVALID'
      );
    }

    return context;
  }

  public async changePassword(params: {
    platformAdminId: number;
    email: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const admin = await this.repository.findByEmail(params.email);
    if (!admin || admin.id !== params.platformAdminId || !admin.isActive) {
      throw new UnauthorizedError(
        'Platform Admin account is unavailable',
        'PLATFORM_SESSION_INVALID',
      );
    }

    if (!(await this.verifyPassword(params.currentPassword, admin.passwordHash))) {
      throw new UnauthorizedError(
        'Current password is incorrect',
        'INVALID_CURRENT_PLATFORM_PASSWORD',
      );
    }
    if (await this.verifyPassword(params.newPassword, admin.passwordHash)) {
      throw new BadRequestError(
        'New password must be different from the current password',
        'PLATFORM_PASSWORD_UNCHANGED',
      );
    }

    const newPasswordHash = await bcrypt.hash(params.newPassword, 12);
    const updated = await this.repository.replacePasswordAndRevokeSessions(
      admin.id,
      admin.passwordHash,
      newPasswordHash,
    );
    if (!updated) {
      throw new ConflictError(
        'Platform password changed in another session. Sign in again and retry.',
        'PLATFORM_PASSWORD_CHANGE_CONFLICT',
      );
    }
  }
}

export const platformAdminAuthService = new PlatformAdminAuthService();
