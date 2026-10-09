import {
  BadRequestError,
} from '../../shared/errors';
import type { OrganizationEntitlement } from '../organizationAccess/types';
import {
  PlatformOrganizationEntitlementAdjustmentRepository,
  platformOrganizationEntitlementAdjustmentRepository,
} from './organizationEntitlementAdjustmentRepository';

export interface ChangeActiveAccessExpiryInput {
  organizationId: number;
  expectedVersion: number;
  accessEndsAt: Date | null;
  reason: string;
  customerMessage?: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ExtendGraceInput {
  organizationId: number;
  expectedVersion: number;
  graceEndsAt: Date;
  reason: string;
  customerMessage?: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

function cleanRequiredReason(reason: string): string {
  const value = reason.trim();

  if (!value) {
    throw new BadRequestError(
      'An access-expiry adjustment reason is required',
      'PLATFORM_ACCESS_EXPIRY_REASON_REQUIRED',
    );
  }

  if (value.length > 500) {
    throw new BadRequestError(
      'Access-expiry adjustment reason must be 500 characters or fewer',
      'PLATFORM_ACCESS_EXPIRY_REASON_TOO_LONG',
    );
  }

  return value;
}

function cleanGraceReason(reason: string): string {
  const value = reason.trim();

  if (!value) {
    throw new BadRequestError(
      'A grace extension reason is required',
      'PLATFORM_GRACE_REASON_REQUIRED',
    );
  }

  if (value.length > 500) {
    throw new BadRequestError(
      'Grace extension reason must be 500 characters or fewer',
      'PLATFORM_GRACE_REASON_TOO_LONG',
    );
  }

  return value;
}

function cleanCustomerMessage(value?: string | null): string | null {
  if (value == null) return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function normalizeAccessEndsAt(value: Date | null): Date | null {
  if (value == null) return null;

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestError(
      'accessEndsAt must be a valid date',
      'PLATFORM_ACCESS_EXPIRY_DATE_INVALID',
    );
  }

  const now = Date.now();
  if (value.getTime() <= now) {
    throw new BadRequestError(
      'accessEndsAt must be in the future',
      'PLATFORM_ACCESS_EXPIRY_DATE_NOT_FUTURE',
    );
  }

  // MySQL DATETIME in this schema stores whole seconds.
  return new Date(Math.floor(value.getTime() / 1000) * 1000);
}

function normalizeGraceEndsAt(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestError(
      'graceEndsAt must be a valid date',
      'PLATFORM_GRACE_END_INVALID',
    );
  }

  if (value.getTime() <= Date.now()) {
    throw new BadRequestError(
      'graceEndsAt must be in the future',
      'PLATFORM_GRACE_END_NOT_FUTURE',
    );
  }

  return new Date(Math.floor(value.getTime() / 1000) * 1000);
}

export class PlatformOrganizationEntitlementAdjustmentService {
  constructor(
    private readonly repository:
      PlatformOrganizationEntitlementAdjustmentRepository =
      platformOrganizationEntitlementAdjustmentRepository,
  ) {}

  public async changeActiveAccessExpiry(
    input: ChangeActiveAccessExpiryInput,
  ): Promise<OrganizationEntitlement> {
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

    return this.repository.changeActiveAccessExpiryAtomically({
      organizationId: input.organizationId,
      expectedVersion: input.expectedVersion,
      accessEndsAt: normalizeAccessEndsAt(input.accessEndsAt),
      reason: cleanRequiredReason(input.reason),
      customerMessage: cleanCustomerMessage(input.customerMessage),
      platformAdminId: input.platformAdminId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  }
  public async extendGrace(
    input: ExtendGraceInput,
  ): Promise<OrganizationEntitlement> {
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

    return this.repository.extendGraceAtomically({
      organizationId: input.organizationId,
      expectedVersion: input.expectedVersion,
      graceEndsAt: normalizeGraceEndsAt(input.graceEndsAt),
      reason: cleanGraceReason(input.reason),
      customerMessage: cleanCustomerMessage(input.customerMessage),
      platformAdminId: input.platformAdminId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  }

}

export const platformOrganizationEntitlementAdjustmentService =
  new PlatformOrganizationEntitlementAdjustmentService();
