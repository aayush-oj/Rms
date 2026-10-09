import crypto from 'node:crypto';
import {
  PlatformAdminRepository,
  platformAdminRepository,
} from './repository';
import type {
  PlatformAdminSessionContext,
  PlatformAdminSessionRecord,
} from './types';

export class PlatformAdminSessionService {
  constructor(private readonly repository: PlatformAdminRepository = platformAdminRepository) {}

  public async create(
    platformAdminId: number,
    expiresAt: Date,
  ): Promise<PlatformAdminSessionRecord> {
    return this.createWithTokenId(crypto.randomUUID(), platformAdminId, expiresAt);
  }

  public async createWithTokenId(
    tokenId: string,
    platformAdminId: number,
    expiresAt: Date,
  ): Promise<PlatformAdminSessionRecord> {
    const normalizedTokenId = tokenId.trim();
    if (!normalizedTokenId) {
      throw new Error('Platform Admin session token ID is required');
    }
    if (!Number.isInteger(platformAdminId) || platformAdminId <= 0) {
      throw new Error('Platform Admin ID must be a positive integer');
    }
    if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error('Platform Admin session expiry must be a valid future date');
    }

    return this.repository.createSession(normalizedTokenId, platformAdminId, expiresAt);
  }

  public async resolve(tokenId: string): Promise<PlatformAdminSessionContext | null> {
    const normalizedTokenId = tokenId.trim();
    if (!normalizedTokenId) return null;
    return this.repository.resolveActiveSession(normalizedTokenId);
  }

  public async revoke(tokenId: string): Promise<boolean> {
    const normalizedTokenId = tokenId.trim();
    if (!normalizedTokenId) return false;
    return this.repository.revokeSession(normalizedTokenId);
  }

  public async revokeAllForAdmin(platformAdminId: number): Promise<number> {
    if (!Number.isInteger(platformAdminId) || platformAdminId <= 0) {
      throw new Error('Platform Admin ID must be a positive integer');
    }
    return this.repository.revokeAllSessionsForAdmin(platformAdminId);
  }
}

export const platformAdminSessionService = new PlatformAdminSessionService();
