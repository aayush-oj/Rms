import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../shared/errors';
import {
  OrganizationEntitlementRepository,
  organizationEntitlementRepository,
} from './repository';
import {
  OrganizationBlockingInvalidationService,
  organizationBlockingInvalidationService,
} from './blockingInvalidation';
import type {
  AtomicOrganizationTransition,
  OrganizationAccessStatus,
  OrganizationEntitlement,
  OrganizationEntitlementTransitionState,
  OrganizationLifecycleTransitionInput,
  OrganizationStatusHistorySource,
} from './types';

const ALLOWED_TRANSITIONS: Record<
  OrganizationAccessStatus,
  ReadonlySet<OrganizationAccessStatus>
> = {
  PENDING: new Set(['TRIAL', 'ACTIVE', 'SECURITY_SUSPENDED', 'CANCELLED']),
  TRIAL: new Set([
    'ACTIVE',
    'GRACE_PERIOD',
    'SUSPENDED',
    'SECURITY_SUSPENDED',
    'CANCELLED',
  ]),
  ACTIVE: new Set([
    'GRACE_PERIOD',
    'SUSPENDED',
    'SECURITY_SUSPENDED',
    'CANCELLED',
  ]),
  GRACE_PERIOD: new Set([
    'ACTIVE',
    'SUSPENDED',
    'SECURITY_SUSPENDED',
    'CANCELLED',
  ]),
  SUSPENDED: new Set(['ACTIVE', 'SECURITY_SUSPENDED', 'CANCELLED']),
  SECURITY_SUSPENDED: new Set(['ACTIVE', 'SUSPENDED', 'CANCELLED']),
  CANCELLED: new Set(),
};

function cleanRequiredReason(reason: string): string {
  const value = reason.trim();
  if (!value) {
    throw new BadRequestError(
      'A lifecycle transition reason is required',
      'LIFECYCLE_REASON_REQUIRED',
    );
  }
  if (value.length > 500) {
    throw new BadRequestError(
      'Lifecycle transition reason must be 500 characters or fewer',
      'LIFECYCLE_REASON_TOO_LONG',
    );
  }
  return value;
}

function cleanCustomerMessage(value?: string | null): string | null {
  if (value == null) return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function assertValidDate(
  value: Date | null | undefined,
  field: string,
): Date | null | undefined {
  if (value == null) return value;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestError(
      `${field} must be a valid date`,
      'LIFECYCLE_DATE_INVALID',
      { field },
    );
  }
  return value;
}

function requireFutureDate(
  value: Date | null | undefined,
  field: string,
  effectiveAt: Date,
): Date {
  const checked = assertValidDate(value, field);
  if (!checked) {
    throw new BadRequestError(
      `${field} is required for this lifecycle transition`,
      'LIFECYCLE_DATE_REQUIRED',
      { field },
    );
  }
  if (checked.getTime() <= effectiveAt.getTime()) {
    throw new BadRequestError(
      `${field} must be later than the transition effective time`,
      'LIFECYCLE_DATE_NOT_FUTURE',
      { field },
    );
  }
  return checked;
}

function optionalFutureDate(
  value: Date | null | undefined,
  field: string,
  effectiveAt: Date,
): Date | null {
  const checked = assertValidDate(value, field);
  if (checked == null) return null;
  if (checked.getTime() <= effectiveAt.getTime()) {
    throw new BadRequestError(
      `${field} must be later than the transition effective time`,
      'LIFECYCLE_DATE_NOT_FUTURE',
      { field },
    );
  }
  return checked;
}

function normalizeActor(
  source: OrganizationStatusHistorySource,
  platformAdminId?: number | null,
): number | null {
  if (source === 'PLATFORM_ADMIN') {
    if (
      !Number.isInteger(platformAdminId)
      || Number(platformAdminId) <= 0
    ) {
      throw new BadRequestError(
        'Platform Admin lifecycle transitions require a valid Platform Admin actor',
        'PLATFORM_ADMIN_ACTOR_REQUIRED',
      );
    }
    return Number(platformAdminId);
  }

  if (
    platformAdminId != null
    && (!Number.isInteger(platformAdminId) || Number(platformAdminId) <= 0)
  ) {
    throw new BadRequestError(
      'platformAdminId must be a positive integer when provided',
      'PLATFORM_ADMIN_ACTOR_INVALID',
    );
  }

  return platformAdminId == null ? null : Number(platformAdminId);
}

export function isOrganizationTransitionAllowed(
  from: OrganizationAccessStatus,
  to: OrganizationAccessStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

function storedDate(value: string | null): Date | null {
  return value == null ? null : new Date(value);
}

export function buildOrganizationTransitionState(
  current: OrganizationEntitlement,
  input: OrganizationLifecycleTransitionInput,
): {
  next: OrganizationEntitlementTransitionState;
  effectiveAt: Date;
  reason: string;
  customerMessage: string | null;
  platformAdminId: number | null;
} {
  const effectiveAt = input.effectiveAt ?? new Date();
  assertValidDate(effectiveAt, 'effectiveAt');

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
    throw new BadRequestError(
      'expectedVersion must be a positive integer',
      'ENTITLEMENT_VERSION_INVALID',
    );
  }

  if (current.version !== input.expectedVersion) {
    throw new ConflictError(
      'Organization entitlement changed before this lifecycle action could be applied',
      'ENTITLEMENT_VERSION_CONFLICT',
      {
        expectedVersion: input.expectedVersion,
        currentVersion: current.version,
      },
    );
  }

  if (!isOrganizationTransitionAllowed(current.accessStatus, input.toStatus)) {
    throw new BadRequestError(
      `Lifecycle transition ${current.accessStatus} -> ${input.toStatus} is not allowed`,
      'ILLEGAL_ORGANIZATION_TRANSITION',
      {
        fromStatus: current.accessStatus,
        toStatus: input.toStatus,
      },
    );
  }

  if (input.source === 'REGISTRATION') {
    throw new BadRequestError(
      'REGISTRATION is reserved for initial entitlement creation',
      'LIFECYCLE_SOURCE_RESERVED',
      { source: input.source },
    );
  }

  const reason = cleanRequiredReason(input.reason);
  const customerMessage = cleanCustomerMessage(input.customerMessage);
  const platformAdminId = normalizeActor(
    input.source,
    input.platformAdminId,
  );

  const next: OrganizationEntitlementTransitionState = {
    accessStatus: input.toStatus,
    trialStartedAt: storedDate(current.trialStartedAt),
    trialEndsAt: storedDate(current.trialEndsAt),
    activatedAt: storedDate(current.activatedAt),
    accessEndsAt: storedDate(current.accessEndsAt),
    graceEndsAt: storedDate(current.graceEndsAt),
    scheduledSuspensionAt: null,
    scheduledSuspensionReason: null,
    scheduledSuspensionCustomerMessage: null,
    suspendedAt: storedDate(current.suspendedAt),
    cancelledAt: storedDate(current.cancelledAt),
    internalReason: reason,
    customerMessage,
  };

  switch (input.toStatus) {
    case 'TRIAL': {
      const trialEndsAt = requireFutureDate(
        input.trialEndsAt,
        'trialEndsAt',
        effectiveAt,
      );
      next.trialStartedAt = effectiveAt;
      next.trialEndsAt = trialEndsAt;
      next.activatedAt = null;
      next.accessEndsAt = null;
      next.graceEndsAt = null;
      next.suspendedAt = null;
      next.cancelledAt = null;
      break;
    }

    case 'ACTIVE': {
      next.activatedAt = storedDate(current.activatedAt) ?? effectiveAt;
      next.accessEndsAt = optionalFutureDate(
        input.accessEndsAt,
        'accessEndsAt',
        effectiveAt,
      );
      next.graceEndsAt = null;
      next.suspendedAt = null;
      next.cancelledAt = null;
      break;
    }

    case 'GRACE_PERIOD': {
      next.graceEndsAt = requireFutureDate(
        input.graceEndsAt,
        'graceEndsAt',
        effectiveAt,
      );
      next.suspendedAt = null;
      next.cancelledAt = null;
      break;
    }

    case 'SUSPENDED':
    case 'SECURITY_SUSPENDED': {
      next.graceEndsAt = null;
      next.suspendedAt = effectiveAt;
      next.cancelledAt = null;
      break;
    }

    case 'CANCELLED': {
      next.graceEndsAt = null;
      next.cancelledAt = effectiveAt;
      break;
    }

    case 'PENDING':
      // No valid transition currently targets PENDING.
      throw new BadRequestError(
        'Transitioning an existing entitlement back to PENDING is not supported',
        'ILLEGAL_ORGANIZATION_TRANSITION',
      );
  }

  return {
    next,
    effectiveAt,
    reason,
    customerMessage,
    platformAdminId,
  };
}

export class OrganizationLifecycleTransitionService {
  constructor(
    private readonly repository: OrganizationEntitlementRepository =
      organizationEntitlementRepository,
    private readonly blockingInvalidation: OrganizationBlockingInvalidationService =
      organizationBlockingInvalidationService,
  ) {}

  public async transition(
    input: OrganizationLifecycleTransitionInput,
  ): Promise<OrganizationEntitlement> {
    if (!Number.isInteger(input.organizationId) || input.organizationId <= 0) {
      throw new BadRequestError(
        'organizationId must be a positive integer',
        'ORGANIZATION_ID_INVALID',
      );
    }

    const current = await this.repository.findByOrganizationId(
      input.organizationId,
    );

    if (!current) {
      throw new NotFoundError(
        'Organization entitlement not found',
        'ORGANIZATION_ENTITLEMENT_NOT_FOUND',
      );
    }

    const prepared = buildOrganizationTransitionState(current, input);

    const transition: AtomicOrganizationTransition = {
      organizationId: input.organizationId,
      expectedVersion: input.expectedVersion,
      expectedFromStatus: current.accessStatus,
      toStatus: input.toStatus,
      next: prepared.next,
      effectiveAt: prepared.effectiveAt,
      reason: prepared.reason,
      customerMessage: prepared.customerMessage,
      platformAdminId: prepared.platformAdminId,
      source: input.source,
    };

    const updated = await this.repository.transitionAtomically(transition);

    // The entitlement/history transaction is already committed at this point.
    // Blocking-state cleanup is defense in depth and must never participate in
    // or roll back the lifecycle transaction itself.
    await this.blockingInvalidation.afterCommittedTransition(updated);

    return updated;
  }
}

export const organizationLifecycleTransitionService =
  new OrganizationLifecycleTransitionService();
