import { BadRequestError, NotFoundError } from '../../shared/errors';
import {
  PlatformAuditReadRepository,
  platformAuditReadRepository,
} from './platformAuditReadRepository';
import type {
  PlatformAuditDetail,
  PlatformAuditListFilters,
  PlatformAuditListItem,
  PlatformAuditListResult,
  PlatformAuditReadRecord,
} from './platformAuditReadTypes';

interface NormalizedFilters {
  organizationId?: number;
  platformAdminId?: number;
  action?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

function normalizeDate(
  value: string | undefined,
  field: 'from' | 'to',
): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(
      `${field} must be a valid date/time`,
      'PLATFORM_AUDIT_DATE_INVALID',
      { field },
    );
  }
  return parsed;
}

function normalizeFilters(
  input: PlatformAuditListFilters,
): NormalizedFilters {
  const parsedLimit = Number(input.limit);
  const parsedOffset = Number(input.offset);
  const from = normalizeDate(input.from, 'from');
  const to = normalizeDate(input.to, 'to');

  if (from && to && from.getTime() > to.getTime()) {
    throw new BadRequestError(
      'Audit date range is invalid',
      'PLATFORM_AUDIT_DATE_RANGE_INVALID',
    );
  }

  return {
    organizationId: input.organizationId,
    platformAdminId: input.platformAdminId,
    action: input.action?.trim() || undefined,
    targetType: input.targetType?.trim() || undefined,
    from,
    to,
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

function listItem(
  record: PlatformAuditReadRecord,
): PlatformAuditListItem {
  return {
    id: record.id,
    actor:
      record.platformAdminId != null
      && record.platformAdminName
      && record.platformAdminEmail
        ? {
            id: record.platformAdminId,
            name: record.platformAdminName,
            email: record.platformAdminEmail,
          }
        : null,
    organization:
      record.organizationId != null
      && record.organizationHandle
      && record.organizationName
        ? {
            id: record.organizationId,
            handle: record.organizationHandle,
            name: record.organizationName,
          }
        : null,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId,
    reason: record.reason,
    requestId: record.requestId,
    createdAt: record.createdAt,
  };
}

export class PlatformAuditReadService {
  constructor(
    private readonly repository:
      PlatformAuditReadRepository = platformAuditReadRepository,
  ) {}

  public async list(
    input: PlatformAuditListFilters = {},
  ): Promise<PlatformAuditListResult> {
    const filters = normalizeFilters(input);
    const result = await this.repository.list(filters);

    return {
      items: result.rows.map(listItem),
      pagination: {
        total: result.total,
        limit: filters.limit,
        offset: filters.offset,
      },
    };
  }

  public async detail(auditId: number): Promise<PlatformAuditDetail> {
    if (!Number.isInteger(auditId) || auditId <= 0) {
      throw new NotFoundError(
        'Platform audit log not found',
        'PLATFORM_AUDIT_LOG_NOT_FOUND',
      );
    }

    const record = await this.repository.findById(auditId);
    if (!record) {
      throw new NotFoundError(
        'Platform audit log not found',
        'PLATFORM_AUDIT_LOG_NOT_FOUND',
      );
    }

    return {
      ...listItem(record),
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      before: record.before,
      after: record.after,
    };
  }
}

export const platformAuditReadService =
  new PlatformAuditReadService();
