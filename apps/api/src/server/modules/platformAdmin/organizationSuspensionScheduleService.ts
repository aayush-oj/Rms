import { BadRequestError } from '../../shared/errors';
import type { OrganizationEntitlement } from '../organizationAccess/types';
import {
  PlatformOrganizationSuspensionScheduleRepository,
  platformOrganizationSuspensionScheduleRepository,
} from './organizationSuspensionScheduleRepository';

interface PlatformSuspensionScheduleBaseInput {
  organizationId: number;
  expectedVersion: number;
  reason: string;
  customerMessage?: string | null;
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ScheduleSuspensionInput
  extends PlatformSuspensionScheduleBaseInput {
  scheduledSuspensionAt: Date;
}

export interface RescheduleSuspensionInput
  extends PlatformSuspensionScheduleBaseInput {
  scheduledSuspensionAt: Date;
}

export type CancelScheduledSuspensionInput =
  PlatformSuspensionScheduleBaseInput;

function validateCommon(
  input: PlatformSuspensionScheduleBaseInput,
): {
  reason: string;
  customerMessage: string | null;
} {
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

  const reason = input.reason.trim();
  if (!reason) {
    throw new BadRequestError(
      'A suspension schedule action reason is required',
      'PLATFORM_SUSPENSION_SCHEDULE_REASON_REQUIRED',
    );
  }

  if (reason.length > 500) {
    throw new BadRequestError(
      'Suspension schedule reason must be 500 characters or fewer',
      'PLATFORM_SUSPENSION_SCHEDULE_REASON_TOO_LONG',
    );
  }

  let customerMessage: string | null = null;
  if (input.customerMessage != null) {
    const cleaned = input.customerMessage.trim();
    customerMessage = cleaned || null;

    if (customerMessage != null && customerMessage.length > 2000) {
      throw new BadRequestError(
        'Suspension schedule customer message must be 2000 characters or fewer',
        'PLATFORM_SUSPENSION_SCHEDULE_CUSTOMER_MESSAGE_TOO_LONG',
      );
    }
  }

  return { reason, customerMessage };
}

function normalizeFutureSchedule(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestError(
      'scheduledSuspensionAt must be a valid date',
      'PLATFORM_SUSPENSION_DATE_INVALID',
    );
  }

  if (value.getTime() <= Date.now()) {
    throw new BadRequestError(
      'scheduledSuspensionAt must be in the future',
      'PLATFORM_SUSPENSION_DATE_NOT_FUTURE',
    );
  }

  return new Date(Math.floor(value.getTime() / 1000) * 1000);
}

export class PlatformOrganizationSuspensionScheduleService {
  constructor(
    private readonly repository:
      PlatformOrganizationSuspensionScheduleRepository =
      platformOrganizationSuspensionScheduleRepository,
  ) {}

  public async schedule(
    input: ScheduleSuspensionInput,
  ): Promise<OrganizationEntitlement> {
    const cleaned = validateCommon(input);

    return this.repository.scheduleAtomically({
      ...input,
      scheduledSuspensionAt: normalizeFutureSchedule(
        input.scheduledSuspensionAt,
      ),
      reason: cleaned.reason,
      customerMessage: cleaned.customerMessage,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  }

  public async reschedule(
    input: RescheduleSuspensionInput,
  ): Promise<OrganizationEntitlement> {
    const cleaned = validateCommon(input);

    return this.repository.rescheduleAtomically({
      ...input,
      scheduledSuspensionAt: normalizeFutureSchedule(
        input.scheduledSuspensionAt,
      ),
      reason: cleaned.reason,
      customerMessage: cleaned.customerMessage,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  }

  public async cancel(
    input: CancelScheduledSuspensionInput,
  ): Promise<OrganizationEntitlement> {
    const cleaned = validateCommon(input);

    return this.repository.cancelAtomically({
      ...input,
      reason: cleaned.reason,
      customerMessage: cleaned.customerMessage,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  }
}

export const platformOrganizationSuspensionScheduleService =
  new PlatformOrganizationSuspensionScheduleService();
