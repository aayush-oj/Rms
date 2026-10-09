import { NotFoundError } from '../../shared/errors';
import { evaluateOrganizationEntitlement } from '../organizationAccess/service';
import type { EffectiveOrganizationAccess } from '../organizationAccess/types';
import {
  PlatformActivationRequestReadRepository,
  platformActivationRequestReadRepository,
} from './activationRequestReadRepository';
import type {
  PlatformActivationRequestAccessSnapshot,
  PlatformActivationRequestDetail,
  PlatformActivationRequestListFilters,
  PlatformActivationRequestListItem,
  PlatformActivationRequestListResult,
  PlatformActivationRequestReadRecord,
} from './activationRequestReadTypes';

interface NormalizedFilters {
  status?: PlatformActivationRequestListFilters['status'];
  search?: string;
  limit: number;
  offset: number;
}

function normalizeFilters(
  input: PlatformActivationRequestListFilters,
): NormalizedFilters {
  const parsedLimit = Number(input.limit);
  const parsedOffset = Number(input.offset);
  const search = input.search?.trim().slice(0, 100);
  return {
    status: input.status,
    search: search || undefined,
    limit:
      Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 25,
    offset:
      Number.isInteger(parsedOffset) && parsedOffset >= 0
        ? parsedOffset
        : 0,
  };
}

function accessSnapshot(
  access: EffectiveOrganizationAccess,
): PlatformActivationRequestAccessSnapshot {
  return {
    configuredStatus: access.configuredStatus,
    accessMode: access.accessMode,
    blockingReason: access.blockingReason,
    entitlementVersion: access.version,
    trialEndsAt: access.trialEndsAt,
    accessEndsAt: access.accessEndsAt,
    graceEndsAt: access.graceEndsAt,
    scheduledSuspensionAt: access.scheduledSuspensionAt,
    evaluatedAt: access.evaluatedAt,
  };
}

function listItem(
  record: PlatformActivationRequestReadRecord,
  now: Date,
): PlatformActivationRequestListItem {
  const access = evaluateOrganizationEntitlement(
    record.entitlement,
    record.organizationId,
    now,
  );

  return {
    id: record.id,
    status: record.status,
    organization: {
      id: record.organizationId,
      handle: record.organizationHandle,
      name: record.organizationName,
      primaryBranch: record.primaryBranchName
        ? {
            name: record.primaryBranchName,
            address: record.primaryBranchAddress,
          }
        : null,
    },
    requester: {
      userId: record.requestedByUserId,
      name: record.requesterNameSnapshot,
      email: record.requesterEmailSnapshot,
      phone: record.requesterPhoneSnapshot,
    },
    createdAt: record.createdAt,
    reviewedAt: record.reviewedAt,
    access: accessSnapshot(access),
  };
}

export class PlatformActivationRequestReadService {
  constructor(
    private readonly repository:
      PlatformActivationRequestReadRepository =
        platformActivationRequestReadRepository,
  ) {}

  public async list(
    input: PlatformActivationRequestListFilters = {},
    now: Date = new Date(),
  ): Promise<PlatformActivationRequestListResult> {
    const filters = normalizeFilters(input);
    const result = await this.repository.list(filters);

    return {
      items: result.rows.map(record => listItem(record, now)),
      pagination: {
        total: result.total,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }

  public async detail(
    requestId: number,
    now: Date = new Date(),
  ): Promise<PlatformActivationRequestDetail> {
    if (!Number.isInteger(requestId) || requestId <= 0) {
      throw new NotFoundError(
        'Platform activation request not found',
        'PLATFORM_ACTIVATION_REQUEST_NOT_FOUND',
      );
    }

    const record = await this.repository.findById(requestId);
    if (!record) {
      throw new NotFoundError(
        'Platform activation request not found',
        'PLATFORM_ACTIVATION_REQUEST_NOT_FOUND',
      );
    }

    return {
      ...listItem(record, now),
      note: record.note,
      reviewNote: record.reviewNote,
      reviewer:
        record.reviewedByPlatformAdminId != null
        && record.reviewerName
        && record.reviewerEmail
          ? {
              id: record.reviewedByPlatformAdminId,
              name: record.reviewerName,
              email: record.reviewerEmail,
            }
          : null,
      updatedAt: record.updatedAt,
    };
  }
}

export const platformActivationRequestReadService =
  new PlatformActivationRequestReadService();
