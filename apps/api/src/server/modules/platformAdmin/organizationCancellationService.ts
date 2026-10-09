import { BadRequestError } from '../../shared/errors';
import {
  OrganizationBlockingInvalidationService,
  organizationBlockingInvalidationService,
} from '../organizationAccess/blockingInvalidation';
import type { OrganizationEntitlement } from '../organizationAccess/types';
import {
  PlatformOrganizationCancellationRepository,
  platformOrganizationCancellationRepository,
} from './organizationCancellationRepository';

export interface PlatformCancelOrganizationInput {
  organizationId: number;
  expectedVersion: number;
  confirmationText: string;
  reason: string;
  customerMessage?: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

function cleanInput(input: PlatformCancelOrganizationInput) {
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

  const confirmationText = input.confirmationText.trim();
  if (!confirmationText || confirmationText.length > 120) {
    throw new BadRequestError(
      'A valid cancellation confirmation is required',
      'PLATFORM_CANCELLATION_CONFIRMATION_INVALID',
    );
  }

  const reason = input.reason.trim();
  if (!reason) {
    throw new BadRequestError(
      'A cancellation reason is required',
      'PLATFORM_CANCELLATION_REASON_REQUIRED',
    );
  }
  if (reason.length > 500) {
    throw new BadRequestError(
      'Cancellation reason must be 500 characters or fewer',
      'PLATFORM_CANCELLATION_REASON_TOO_LONG',
    );
  }

  let customerMessage: string | null = null;
  if (input.customerMessage != null) {
    const cleaned = input.customerMessage.trim();
    customerMessage = cleaned || null;

    if (customerMessage != null && customerMessage.length > 2000) {
      throw new BadRequestError(
        'Cancellation customer message must be 2000 characters or fewer',
        'PLATFORM_CANCELLATION_CUSTOMER_MESSAGE_TOO_LONG',
      );
    }
  }

  return { confirmationText, reason, customerMessage };
}

export class PlatformOrganizationCancellationService {
  constructor(
    private readonly repository:
      PlatformOrganizationCancellationRepository =
      platformOrganizationCancellationRepository,
    private readonly blockingInvalidation:
      OrganizationBlockingInvalidationService =
      organizationBlockingInvalidationService,
  ) {}

  public async cancel(
    input: PlatformCancelOrganizationInput,
  ): Promise<OrganizationEntitlement> {
    const cleaned = cleanInput(input);

    const updated = await this.repository.cancelAtomically({
      ...input,
      confirmationText: cleaned.confirmationText,
      reason: cleaned.reason,
      customerMessage: cleaned.customerMessage,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });

    await this.blockingInvalidation.afterCommittedTransition(updated);
    return updated;
  }
}

export const platformOrganizationCancellationService =
  new PlatformOrganizationCancellationService();
