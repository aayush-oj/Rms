import { BadRequestError } from '../../shared/errors';
import {
  OrganizationBlockingInvalidationService,
  organizationBlockingInvalidationService,
} from '../organizationAccess/blockingInvalidation';
import type {
  OrganizationEntitlement,
} from '../organizationAccess/types';
import {
  PlatformOrganizationSecuritySuspensionRepository,
  type PlatformSecurityRestoreTarget,
  platformOrganizationSecuritySuspensionRepository,
} from './organizationSecuritySuspensionRepository';

interface PlatformSecurityActionBaseInput {
  organizationId: number;
  expectedVersion: number;
  confirmationHandle: string;
  reason: string;
  customerMessage?: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface PlatformSecuritySuspendInput
  extends PlatformSecurityActionBaseInput {}

export interface PlatformClearSecuritySuspensionInput
  extends PlatformSecurityActionBaseInput {
  restoreTo: PlatformSecurityRestoreTarget;
  accessEndsAt?: Date | null;
}

function cleanCommon(input: PlatformSecurityActionBaseInput) {
  if (!Number.isInteger(input.organizationId) || input.organizationId <= 0) {
    throw new BadRequestError(
      'organizationId must be a positive integer',
      'ORGANIZATION_ID_INVALID',
    );
  }

  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
    throw new BadRequestError(
      'expectedVersion must be a positive integer',
      'ENTITLEMENT_VERSION_INVALID',
    );
  }

  if (!Number.isInteger(input.platformAdminId) || input.platformAdminId <= 0) {
    throw new BadRequestError(
      'A valid Platform Admin actor is required',
      'PLATFORM_ADMIN_ACTOR_REQUIRED',
    );
  }

  const confirmationHandle = input.confirmationHandle.trim();
  if (!confirmationHandle || confirmationHandle.length > 100) {
    throw new BadRequestError(
      'A valid organization confirmation handle is required',
      'PLATFORM_SECURITY_CONFIRMATION_INVALID',
    );
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new BadRequestError(
      'A security action reason is required',
      'PLATFORM_SECURITY_REASON_REQUIRED',
    );
  }

  if (reason.length > 500) {
    throw new BadRequestError(
      'Security action reason must be 500 characters or fewer',
      'PLATFORM_SECURITY_REASON_TOO_LONG',
    );
  }

  let customerMessage: string | null = null;
  if (input.customerMessage != null) {
    const cleaned = input.customerMessage.trim();
    customerMessage = cleaned || null;

    if (customerMessage != null && customerMessage.length > 2000) {
      throw new BadRequestError(
        'Security customer message must be 2000 characters or fewer',
        'PLATFORM_SECURITY_CUSTOMER_MESSAGE_TOO_LONG',
      );
    }
  }

  return {
    confirmationHandle,
    reason,
    customerMessage,
  };
}

function validateActiveExpiry(
  input: PlatformClearSecuritySuspensionInput,
): Date | null | undefined {
  if (input.restoreTo === 'ACTIVE') {
    if (input.accessEndsAt === undefined) {
      throw new BadRequestError(
        'ACTIVE security clearance requires an explicit access expiry choice',
        'PLATFORM_SECURITY_ACTIVE_EXPIRY_REQUIRED',
      );
    }

    if (
      input.accessEndsAt != null
      && (
        !(input.accessEndsAt instanceof Date)
        || Number.isNaN(input.accessEndsAt.getTime())
      )
    ) {
      throw new BadRequestError(
        'accessEndsAt must be a valid date or null',
        'LIFECYCLE_DATE_INVALID',
        { field: 'accessEndsAt' },
      );
    }

    return input.accessEndsAt;
  }

  if (input.accessEndsAt !== undefined) {
    throw new BadRequestError(
      'accessEndsAt is only valid when restoring security suspension to ACTIVE',
      'PLATFORM_SECURITY_SUSPENDED_EXPIRY_NOT_ALLOWED',
    );
  }

  return undefined;
}

export class PlatformOrganizationSecuritySuspensionService {
  constructor(
    private readonly repository:
      PlatformOrganizationSecuritySuspensionRepository =
      platformOrganizationSecuritySuspensionRepository,
    private readonly blockingInvalidation:
      OrganizationBlockingInvalidationService =
      organizationBlockingInvalidationService,
  ) {}

  public async securitySuspend(
    input: PlatformSecuritySuspendInput,
  ): Promise<OrganizationEntitlement> {
    const cleaned = cleanCommon(input);

    const updated = await this.repository.securitySuspendAtomically({
      ...input,
      confirmationHandle: cleaned.confirmationHandle,
      reason: cleaned.reason,
      customerMessage: cleaned.customerMessage,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });

    await this.blockingInvalidation.afterCommittedTransition(updated);
    return updated;
  }

  public async clearSecuritySuspension(
    input: PlatformClearSecuritySuspensionInput,
  ): Promise<OrganizationEntitlement> {
    const cleaned = cleanCommon(input);

    if (input.restoreTo !== 'ACTIVE' && input.restoreTo !== 'SUSPENDED') {
      throw new BadRequestError(
        'restoreTo must be ACTIVE or SUSPENDED',
        'PLATFORM_SECURITY_CLEAR_TARGET_INVALID',
      );
    }

    const accessEndsAt = validateActiveExpiry(input);

    const updated =
      await this.repository.clearSecuritySuspensionAtomically({
        ...input,
        confirmationHandle: cleaned.confirmationHandle,
        reason: cleaned.reason,
        customerMessage: cleaned.customerMessage,
        accessEndsAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
      });

    await this.blockingInvalidation.afterCommittedTransition(updated);
    return updated;
  }
}

export const platformOrganizationSecuritySuspensionService =
  new PlatformOrganizationSecuritySuspensionService();
