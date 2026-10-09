import { BadRequestError } from '../../shared/errors';
import type { OrganizationEntitlement } from '../organizationAccess/types';
import {
  PlatformActivationRequestReviewRepository,
  platformActivationRequestReviewRepository,
} from './activationRequestReviewRepository';
import {
  PlatformActivationRequestReadService,
  platformActivationRequestReadService,
} from './activationRequestReadService';
import type { PlatformActivationRequestDetail } from './activationRequestReadTypes';

interface ReviewMetadata {
  platformAdminId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestIdHeader?: string | null;
}

export interface ApproveActivationRequestInput extends ReviewMetadata {
  requestId: number;
  expectedVersion: number;
  reason: string;
  customerMessage?: string | null;
}

export interface ApproveActivationRequestUntilInput
  extends ApproveActivationRequestInput {
  accessEndsAt: Date;
}

export interface RejectActivationRequestInput extends ReviewMetadata {
  requestId: number;
  reviewNote: string;
}

function cleanReason(value: string): string {
  const reason = value.trim();
  if (!reason) {
    throw new BadRequestError(
      'An activation-request approval reason is required',
      'ACTIVATION_REQUEST_APPROVAL_REASON_REQUIRED',
    );
  }
  if (reason.length > 500) {
    throw new BadRequestError(
      'Activation-request approval reason must be 500 characters or fewer',
      'ACTIVATION_REQUEST_APPROVAL_REASON_TOO_LONG',
    );
  }
  return reason;
}

function cleanCustomerMessage(value?: string | null): string | null {
  if (value == null) return null;
  const message = value.trim();
  if (!message) return null;
  if (message.length > 2000) {
    throw new BadRequestError(
      'Activation-request customer message must be 2000 characters or fewer',
      'ACTIVATION_REQUEST_CUSTOMER_MESSAGE_TOO_LONG',
    );
  }
  return message;
}

function cleanReviewNote(value: string): string {
  const note = value.trim();
  if (!note) {
    throw new BadRequestError(
      'A rejection note is required',
      'ACTIVATION_REQUEST_REJECTION_NOTE_REQUIRED',
    );
  }
  if (note.length > 500) {
    throw new BadRequestError(
      'Activation-request rejection note must be 500 characters or fewer',
      'ACTIVATION_REQUEST_REJECTION_NOTE_TOO_LONG',
    );
  }
  return note;
}

function assertPositiveInteger(value: number, field: string): void {
  if (Number.isInteger(value) && value > 0) return;
  throw new BadRequestError(
    `${field} must be a positive integer`,
    'ACTIVATION_REQUEST_REVIEW_INPUT_INVALID',
    { field },
  );
}

function futureAccessEnd(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new BadRequestError(
      'accessEndsAt must be a valid date',
      'LIFECYCLE_DATE_INVALID',
      { field: 'accessEndsAt' },
    );
  }
  if (value.getTime() <= Date.now()) {
    throw new BadRequestError(
      'accessEndsAt must be in the future',
      'LIFECYCLE_DATE_NOT_FUTURE',
      { field: 'accessEndsAt' },
    );
  }
  return value;
}

export interface PlatformActivationRequestApprovalResult {
  entitlement: OrganizationEntitlement;
  request: PlatformActivationRequestDetail;
}

export class PlatformActivationRequestReviewService {
  constructor(
    private readonly repository:
      PlatformActivationRequestReviewRepository =
        platformActivationRequestReviewRepository,
    private readonly readService:
      PlatformActivationRequestReadService =
        platformActivationRequestReadService,
  ) {}

  private metadata(input: ReviewMetadata) {
    assertPositiveInteger(input.platformAdminId, 'platformAdminId');
    return {
      platformAdminId: input.platformAdminId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestIdHeader: input.requestIdHeader ?? null,
    };
  }

  public async approve(
    input: ApproveActivationRequestInput,
  ): Promise<PlatformActivationRequestApprovalResult> {
    assertPositiveInteger(input.requestId, 'requestId');
    assertPositiveInteger(input.expectedVersion, 'expectedVersion');

    const entitlement = await this.repository.approveAtomically({
      requestId: input.requestId,
      expectedVersion: input.expectedVersion,
      accessEndsAt: null,
      reason: cleanReason(input.reason),
      customerMessage: cleanCustomerMessage(input.customerMessage),
      ...this.metadata(input),
    });

    return {
      entitlement,
      request: await this.readService.detail(input.requestId),
    };
  }

  public async approveUntil(
    input: ApproveActivationRequestUntilInput,
  ): Promise<PlatformActivationRequestApprovalResult> {
    assertPositiveInteger(input.requestId, 'requestId');
    assertPositiveInteger(input.expectedVersion, 'expectedVersion');

    const entitlement = await this.repository.approveAtomically({
      requestId: input.requestId,
      expectedVersion: input.expectedVersion,
      accessEndsAt: futureAccessEnd(input.accessEndsAt),
      reason: cleanReason(input.reason),
      customerMessage: cleanCustomerMessage(input.customerMessage),
      ...this.metadata(input),
    });

    return {
      entitlement,
      request: await this.readService.detail(input.requestId),
    };
  }

  public async reject(
    input: RejectActivationRequestInput,
  ): Promise<PlatformActivationRequestDetail> {
    assertPositiveInteger(input.requestId, 'requestId');

    await this.repository.rejectAtomically({
      requestId: input.requestId,
      reviewNote: cleanReviewNote(input.reviewNote),
      ...this.metadata(input),
    });

    return this.readService.detail(input.requestId);
  }
}

export const platformActivationRequestReviewService =
  new PlatformActivationRequestReviewService();
