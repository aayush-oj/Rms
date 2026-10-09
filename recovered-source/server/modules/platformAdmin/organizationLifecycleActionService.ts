import {
  ConflictError,
  NotFoundError,
} from '../../shared/errors';
import {
  OrganizationLifecycleTransitionService,
  organizationLifecycleTransitionService,
} from '../organizationAccess/transitionService';
import type {
  OrganizationAccessStatus,
  OrganizationEntitlement,
} from '../organizationAccess/types';
import {
  PlatformOrganizationReadRepository,
  platformOrganizationReadRepository,
} from './organizationReadRepository';

interface PlatformLifecycleActionBaseInput {
  organizationId: number;
  expectedVersion: number;
  reason: string;
  customerMessage?: string | null;
  platformAdminId: number;
}

export interface PlatformActivateOrganizationInput
  extends PlatformLifecycleActionBaseInput {
  accessEndsAt: Date | null;
}

export interface PlatformSuspendOrganizationInput
  extends PlatformLifecycleActionBaseInput {}

export interface PlatformReactivateOrganizationInput
  extends PlatformLifecycleActionBaseInput {
  accessEndsAt: Date | null;
}

export interface PlatformStartGraceInput
  extends PlatformLifecycleActionBaseInput {
  graceEndsAt: Date;
}

export interface PlatformEndGraceInput
  extends PlatformLifecycleActionBaseInput {
  accessEndsAt: Date | null;
}

type ActionName =
  | 'activate'
  | 'suspend'
  | 'reactivate'
  | 'startGrace'
  | 'endGrace';

const ACTION_CODES: Record<ActionName, string> = {
  activate: 'PLATFORM_ACTIVATE_NOT_ALLOWED',
  suspend: 'PLATFORM_SUSPEND_NOT_ALLOWED',
  reactivate: 'PLATFORM_REACTIVATE_NOT_ALLOWED',
  startGrace: 'PLATFORM_START_GRACE_NOT_ALLOWED',
  endGrace: 'PLATFORM_END_GRACE_NOT_ALLOWED',
};

const ACTION_LABELS: Record<ActionName, string> = {
  activate: 'Activate',
  suspend: 'Suspend',
  reactivate: 'Reactivate',
  startGrace: 'Start Grace',
  endGrace: 'Return to Active',
};

export class PlatformOrganizationLifecycleActionService {
  constructor(
    private readonly readRepository: PlatformOrganizationReadRepository =
      platformOrganizationReadRepository,
    private readonly transitionService: OrganizationLifecycleTransitionService =
      organizationLifecycleTransitionService,
  ) {}

  private async currentEntitlement(
    organizationId: number,
  ): Promise<OrganizationEntitlement> {
    const organization = await this.readRepository.findBaseById(organizationId);

    if (!organization) {
      throw new NotFoundError(
        'Platform organization not found',
        'PLATFORM_ORGANIZATION_NOT_FOUND',
      );
    }

    if (!organization.entitlement) {
      throw new NotFoundError(
        'Organization entitlement not found',
        'ORGANIZATION_ENTITLEMENT_NOT_FOUND',
      );
    }

    return organization.entitlement;
  }

  private assertExpectedVersion(
    entitlement: OrganizationEntitlement,
    expectedVersion: number,
  ): void {
    if (entitlement.version !== expectedVersion) {
      throw new ConflictError(
        'Organization entitlement changed before this lifecycle action could be applied',
        'ENTITLEMENT_VERSION_CONFLICT',
        {
          expectedVersion,
          currentVersion: entitlement.version,
          currentStatus: entitlement.accessStatus,
        },
      );
    }
  }

  private assertActionAllowed(
    action: ActionName,
    currentStatus: OrganizationAccessStatus,
    allowedStatuses: readonly OrganizationAccessStatus[],
  ): void {
    if (allowedStatuses.includes(currentStatus)) return;

    throw new ConflictError(
      `${ACTION_LABELS[action]} is not allowed from the current organization status`,
      ACTION_CODES[action],
      {
        currentStatus,
        allowedStatuses,
      },
    );
  }

  private assertNoScheduledSuspension(
    entitlement: OrganizationEntitlement,
  ): void {
    if (entitlement.scheduledSuspensionAt == null) return;

    throw new ConflictError(
      'Resolve the scheduled suspension before changing grace lifecycle state',
      'PLATFORM_GRACE_SCHEDULE_CONFLICT',
      {
        scheduledSuspensionAt: entitlement.scheduledSuspensionAt,
        currentStatus: entitlement.accessStatus,
      },
    );
  }

  public async activate(
    input: PlatformActivateOrganizationInput,
  ): Promise<OrganizationEntitlement> {
    const current = await this.currentEntitlement(input.organizationId);
    this.assertExpectedVersion(current, input.expectedVersion);
    this.assertActionAllowed('activate', current.accessStatus, [
      'PENDING',
      'TRIAL',
    ]);

    return this.transitionService.transition({
      organizationId: input.organizationId,
      toStatus: 'ACTIVE',
      expectedVersion: input.expectedVersion,
      source: 'PLATFORM_ADMIN',
      platformAdminId: input.platformAdminId,
      reason: input.reason,
      customerMessage: input.customerMessage,
      accessEndsAt: input.accessEndsAt,
    });
  }

  public async suspend(
    input: PlatformSuspendOrganizationInput,
  ): Promise<OrganizationEntitlement> {
    const current = await this.currentEntitlement(input.organizationId);
    this.assertExpectedVersion(current, input.expectedVersion);
    this.assertActionAllowed('suspend', current.accessStatus, [
      'TRIAL',
      'ACTIVE',
      'GRACE_PERIOD',
    ]);

    return this.transitionService.transition({
      organizationId: input.organizationId,
      toStatus: 'SUSPENDED',
      expectedVersion: input.expectedVersion,
      source: 'PLATFORM_ADMIN',
      platformAdminId: input.platformAdminId,
      reason: input.reason,
      customerMessage: input.customerMessage,
    });
  }

  public async reactivate(
    input: PlatformReactivateOrganizationInput,
  ): Promise<OrganizationEntitlement> {
    const current = await this.currentEntitlement(input.organizationId);
    this.assertExpectedVersion(current, input.expectedVersion);
    this.assertActionAllowed('reactivate', current.accessStatus, [
      'SUSPENDED',
    ]);

    return this.transitionService.transition({
      organizationId: input.organizationId,
      toStatus: 'ACTIVE',
      expectedVersion: input.expectedVersion,
      source: 'PLATFORM_ADMIN',
      platformAdminId: input.platformAdminId,
      reason: input.reason,
      customerMessage: input.customerMessage,
      accessEndsAt: input.accessEndsAt,
    });
  }

  public async startGrace(
    input: PlatformStartGraceInput,
  ): Promise<OrganizationEntitlement> {
    const current = await this.currentEntitlement(input.organizationId);
    this.assertExpectedVersion(current, input.expectedVersion);
    this.assertActionAllowed('startGrace', current.accessStatus, ['ACTIVE']);
    this.assertNoScheduledSuspension(current);

    return this.transitionService.transition({
      organizationId: input.organizationId,
      toStatus: 'GRACE_PERIOD',
      expectedVersion: input.expectedVersion,
      source: 'PLATFORM_ADMIN',
      platformAdminId: input.platformAdminId,
      reason: input.reason,
      customerMessage: input.customerMessage,
      graceEndsAt: input.graceEndsAt,
    });
  }

  public async endGrace(
    input: PlatformEndGraceInput,
  ): Promise<OrganizationEntitlement> {
    const current = await this.currentEntitlement(input.organizationId);
    this.assertExpectedVersion(current, input.expectedVersion);
    this.assertActionAllowed('endGrace', current.accessStatus, [
      'GRACE_PERIOD',
    ]);
    this.assertNoScheduledSuspension(current);

    return this.transitionService.transition({
      organizationId: input.organizationId,
      toStatus: 'ACTIVE',
      expectedVersion: input.expectedVersion,
      source: 'PLATFORM_ADMIN',
      platformAdminId: input.platformAdminId,
      reason: input.reason,
      customerMessage: input.customerMessage,
      accessEndsAt: input.accessEndsAt,
    });
  }
}

export const platformOrganizationLifecycleActionService =
  new PlatformOrganizationLifecycleActionService();
