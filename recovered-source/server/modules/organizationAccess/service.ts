import { ForbiddenError } from '../../shared/errors';
import {
  OrganizationEntitlementRepository,
  organizationEntitlementRepository,
} from './repository';
import type {
  EffectiveOrganizationAccess,
  OrganizationAccessBlockingReason,
  OrganizationEntitlement,
} from './types';

const DEFAULT_MESSAGES: Record<OrganizationAccessBlockingReason, string> = {
  ENTITLEMENT_MISSING:
    'Your MIH DineOS workspace is not currently available. Contact MIH support.',
  PENDING_APPROVAL:
    'Registration received. Your MIH DineOS workspace is awaiting activation.',
  TRIAL_END_REQUIRED:
    'Your MIH DineOS trial access needs review. Contact MIH support.',
  TRIAL_EXPIRED:
    'Your MIH DineOS trial period has ended. Contact MIH to continue access.',
  ACCESS_EXPIRED:
    'Your MIH DineOS access period has ended. Contact MIH to reactivate your workspace.',
  GRACE_END_REQUIRED:
    'Your MIH DineOS grace-period access needs review. Contact MIH support.',
  GRACE_EXPIRED:
    'Your MIH DineOS grace period has ended. Contact MIH to reactivate your workspace.',
  SCHEDULED_SUSPENSION_DUE:
    'Your MIH DineOS workspace is currently inactive. Contact MIH for assistance.',
  SUSPENDED:
    'Your MIH DineOS workspace is currently inactive. Contact MIH to reactivate it.',
  SECURITY_SUSPENDED:
    'Your MIH DineOS workspace is temporarily unavailable. Contact MIH support.',
  CANCELLED:
    'Your MIH DineOS workspace is no longer active. Contact MIH support if you need assistance.',
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function blocked(
  entitlement: OrganizationEntitlement | null,
  organizationId: number,
  reason: OrganizationAccessBlockingReason,
  now: Date,
): EffectiveOrganizationAccess {
  return {
    organizationId,
    configuredStatus: entitlement?.accessStatus ?? null,
    accessMode: 'BLOCKED',
    canOperate: false,
    ownerCanViewStatus: true,
    blockingReason: reason,
    customerMessage:
      entitlement?.customerMessage?.trim() || DEFAULT_MESSAGES[reason],
    version: entitlement?.version ?? null,
    evaluatedAt: now.toISOString(),
    trialEndsAt: entitlement?.trialEndsAt ?? null,
    accessEndsAt: entitlement?.accessEndsAt ?? null,
    graceEndsAt: entitlement?.graceEndsAt ?? null,
    scheduledSuspensionAt: entitlement?.scheduledSuspensionAt ?? null,
    suspendedAt: entitlement?.suspendedAt ?? null,
    cancelledAt: entitlement?.cancelledAt ?? null,
  };
}

function allowed(
  entitlement: OrganizationEntitlement,
  now: Date,
  accessMode: 'NORMAL' | 'GRACE',
): EffectiveOrganizationAccess {
  return {
    organizationId: entitlement.organizationId,
    configuredStatus: entitlement.accessStatus,
    accessMode,
    canOperate: true,
    ownerCanViewStatus: true,
    blockingReason: null,
    customerMessage: entitlement.customerMessage,
    version: entitlement.version,
    evaluatedAt: now.toISOString(),
    trialEndsAt: entitlement.trialEndsAt,
    accessEndsAt: entitlement.accessEndsAt,
    graceEndsAt: entitlement.graceEndsAt,
    scheduledSuspensionAt: entitlement.scheduledSuspensionAt,
    suspendedAt: entitlement.suspendedAt,
    cancelledAt: entitlement.cancelledAt,
  };
}

export function evaluateOrganizationEntitlement(
  entitlement: OrganizationEntitlement | null,
  organizationId: number,
  now: Date = new Date(),
): EffectiveOrganizationAccess {
  if (!entitlement) {
    return blocked(null, organizationId, 'ENTITLEMENT_MISSING', now);
  }

  const nowMs = now.getTime();

  switch (entitlement.accessStatus) {
    case 'PENDING':
      return blocked(entitlement, organizationId, 'PENDING_APPROVAL', now);
    case 'SUSPENDED':
      return blocked(entitlement, organizationId, 'SUSPENDED', now);
    case 'SECURITY_SUSPENDED':
      return blocked(entitlement, organizationId, 'SECURITY_SUSPENDED', now);
    case 'CANCELLED':
      return blocked(entitlement, organizationId, 'CANCELLED', now);
  }

  const scheduledSuspensionAt = timestamp(entitlement.scheduledSuspensionAt);
  if (scheduledSuspensionAt !== null && scheduledSuspensionAt <= nowMs) {
    return blocked(
      entitlement,
      organizationId,
      'SCHEDULED_SUSPENSION_DUE',
      now,
    );
  }

  const graceEndsAt = timestamp(entitlement.graceEndsAt);

  if (entitlement.accessStatus === 'TRIAL') {
    const trialEndsAt = timestamp(entitlement.trialEndsAt);
    if (trialEndsAt === null) {
      return blocked(entitlement, organizationId, 'TRIAL_END_REQUIRED', now);
    }
    if (trialEndsAt > nowMs) {
      return allowed(entitlement, now, 'NORMAL');
    }
    if (graceEndsAt !== null && graceEndsAt > nowMs) {
      return allowed(entitlement, now, 'GRACE');
    }
    return blocked(entitlement, organizationId, 'TRIAL_EXPIRED', now);
  }

  if (entitlement.accessStatus === 'ACTIVE') {
    const accessEndsAt = timestamp(entitlement.accessEndsAt);
    if (accessEndsAt === null || accessEndsAt > nowMs) {
      return allowed(entitlement, now, 'NORMAL');
    }
    if (graceEndsAt !== null && graceEndsAt > nowMs) {
      return allowed(entitlement, now, 'GRACE');
    }
    return blocked(entitlement, organizationId, 'ACCESS_EXPIRED', now);
  }

  if (entitlement.accessStatus === 'GRACE_PERIOD') {
    if (graceEndsAt === null) {
      return blocked(entitlement, organizationId, 'GRACE_END_REQUIRED', now);
    }
    if (graceEndsAt > nowMs) {
      return allowed(entitlement, now, 'GRACE');
    }
    return blocked(entitlement, organizationId, 'GRACE_EXPIRED', now);
  }

  return blocked(entitlement, organizationId, 'ENTITLEMENT_MISSING', now);
}

export class OrganizationAccessService {
  constructor(
    private readonly repository: OrganizationEntitlementRepository =
      organizationEntitlementRepository,
  ) {}

  public async resolveEffectiveAccess(
    organizationId: number,
    now: Date = new Date(),
  ): Promise<EffectiveOrganizationAccess> {
    const entitlement = await this.repository.findByOrganizationId(organizationId);
    return evaluateOrganizationEntitlement(entitlement, organizationId, now);
  }

  public async assertOperationalAccess(
    organizationId: number,
    now: Date = new Date(),
  ): Promise<EffectiveOrganizationAccess> {
    const access = await this.resolveEffectiveAccess(organizationId, now);
    if (!access.canOperate) {
      throw new ForbiddenError(
        'Restaurant workspace is currently inactive',
        'ORGANIZATION_ACCESS_BLOCKED',
        {
          status: access.configuredStatus,
          accessMode: access.accessMode,
          reason: access.blockingReason,
        },
      );
    }
    return access;
  }

  public async ensureRegistrationEntitlement(
    organizationId: number,
  ): Promise<OrganizationEntitlement> {
    return this.repository.ensureRegistrationEntitlement(organizationId);
  }
}

export const organizationAccessService = new OrganizationAccessService();
