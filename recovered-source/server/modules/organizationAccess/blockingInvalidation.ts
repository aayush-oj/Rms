import { identityRepository, type IdentityRepository } from '../identity/repository';
import { logger } from '../../lib/logger';
import { realtimeGateway, type RealtimeGateway } from '../../realtime/gateway';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from './types';

const BLOCKING_STATUSES = new Set<OrganizationAccessStatus>([
  'SUSPENDED',
  'SECURITY_SUSPENDED',
  'CANCELLED',
]);

export interface OrganizationBlockingInvalidationResult {
  attempted: boolean;
  sessionsRevoked: number;
  socketsDisconnected: number;
  warnings: string[];
}

export function requiresOrganizationBlockingInvalidation(
  status: OrganizationAccessStatus,
): boolean {
  return BLOCKING_STATUSES.has(status);
}

/**
 * Defense-in-depth cleanup after a blocking lifecycle transition has committed.
 *
 * Persistent entitlement enforcement remains authoritative. These effects are
 * deliberately post-commit and best-effort so a socket/session cleanup failure
 * can never roll back or misrepresent an already-committed suspension.
 */
export class OrganizationBlockingInvalidationService {
  constructor(
    private readonly sessions: Pick<IdentityRepository, 'revokeOrganizationSessions'> =
      identityRepository,
    private readonly realtime: Pick<RealtimeGateway, 'disconnectOrganization'> =
      realtimeGateway,
  ) {}

  public async afterCommittedTransition(
    entitlement: OrganizationEntitlement,
  ): Promise<OrganizationBlockingInvalidationResult> {
    if (!requiresOrganizationBlockingInvalidation(entitlement.accessStatus)) {
      return {
        attempted: false,
        sessionsRevoked: 0,
        socketsDisconnected: 0,
        warnings: [],
      };
    }

    const warnings: string[] = [];
    let sessionsRevoked = 0;
    let socketsDisconnected = 0;

    try {
      sessionsRevoked = await this.sessions.revokeOrganizationSessions(
        entitlement.organizationId,
      );
    } catch (error) {
      warnings.push('SESSION_REVOCATION_FAILED');
      logger.error('Failed to revoke restaurant sessions after blocking lifecycle transition', {
        organizationId: entitlement.organizationId,
        accessStatus: entitlement.accessStatus,
        err: error,
      });
    }

    try {
      socketsDisconnected = this.realtime.disconnectOrganization(
        entitlement.organizationId,
      );
    } catch (error) {
      warnings.push('REALTIME_DISCONNECT_FAILED');
      logger.error('Failed to disconnect realtime sockets after blocking lifecycle transition', {
        organizationId: entitlement.organizationId,
        accessStatus: entitlement.accessStatus,
        err: error,
      });
    }

    if (!warnings.length) {
      logger.info('Applied blocking organization access invalidation', {
        organizationId: entitlement.organizationId,
        accessStatus: entitlement.accessStatus,
        sessionsRevoked,
        socketsDisconnected,
      });
    }

    return {
      attempted: true,
      sessionsRevoked,
      socketsDisconnected,
      warnings,
    };
  }
}

export const organizationBlockingInvalidationService =
  new OrganizationBlockingInvalidationService();
