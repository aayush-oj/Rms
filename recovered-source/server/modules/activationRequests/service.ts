import { ForbiddenError } from '../../shared/errors';
import type { AccessStatusContext } from '../identity/accessStatusAuth';
import type { OrganizationAccessStatus } from '../organizationAccess/types';
import {
  OrganizationActivationRequestRepository,
  organizationActivationRequestRepository,
} from './repository';
import type { OrganizationActivationRequest } from './types';

const REQUEST_ELIGIBLE_CONFIGURED_STATUSES =
  new Set<OrganizationAccessStatus>([
    'PENDING',
    'TRIAL',
    'ACTIVE',
    'GRACE_PERIOD',
    'SUSPENDED',
  ]);

export interface OwnerActivationRequestView {
  id: number;
  status: OrganizationActivationRequest['status'];
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

function safeOwnerView(
  request: OrganizationActivationRequest,
): OwnerActivationRequestView {
  return {
    id: request.id,
    status: request.status,
    note: request.note,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
  };
}

export class OrganizationActivationRequestService {
  constructor(
    private readonly repository:
      OrganizationActivationRequestRepository =
        organizationActivationRequestRepository,
  ) {}

  private assertSubmissionEligible(context: AccessStatusContext): void {
    const configuredStatus = context.access.configuredStatus;

    if (
      context.access.canOperate
      || !configuredStatus
      || !REQUEST_ELIGIBLE_CONFIGURED_STATUSES.has(configuredStatus)
    ) {
      throw new ForbiddenError(
        'Activation requests are not available for this workspace state',
        'ACTIVATION_REQUEST_NOT_AVAILABLE',
      );
    }
  }

  public async submit(
    context: AccessStatusContext,
    note: string | null,
  ): Promise<OwnerActivationRequestView> {
    this.assertSubmissionEligible(context);

    const requester = await this.repository.findRequesterSnapshot(
      context.organizationId,
      context.userId,
    );

    const request = await this.repository.createOpen({
      organizationId: context.organizationId,
      requestedByUserId: context.userId,
      requester,
      note,
    });

    return safeOwnerView(request);
  }

  public async current(
    context: AccessStatusContext,
  ): Promise<OwnerActivationRequestView | null> {
    const request =
      await this.repository.findLatestForOrganization(
        context.organizationId,
      );

    return request ? safeOwnerView(request) : null;
  }
}

export const organizationActivationRequestService =
  new OrganizationActivationRequestService();
