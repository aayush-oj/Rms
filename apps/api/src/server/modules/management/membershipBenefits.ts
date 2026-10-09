import { BadRequestError } from '../../shared/errors';

export interface MembershipBenefitSource {
  id: number;
  customerId: number;
  membershipNumber: string;
  tier: string;
  startDate: string;
  endDate: string | null;
  benefitDiscountRate: number;
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
}

export interface AppliedMembershipBenefit {
  membershipId: number;
  membershipNumberSnapshot: string;
  membershipTierSnapshot: string;
  membershipDiscount: number;
  manualDiscount: number;
  totalDiscount: number;
}

const round4 = (value: number) => Number(value.toFixed(4));
const dateOnly = (value: string) => String(value).slice(0, 10);

export function applyMembershipBenefit(
  membership: MembershipBenefitSource,
  customerId: number,
  businessDate: string,
  subtotal: number,
  requestedManualDiscount: number
): AppliedMembershipBenefit {
  if (membership.customerId !== customerId) {
    throw new BadRequestError('Membership belongs to a different customer', 'MEMBERSHIP_CUSTOMER_MISMATCH');
  }
  if (membership.status !== 'ACTIVE') {
    throw new BadRequestError('Membership is not active', 'MEMBERSHIP_INACTIVE');
  }
  const day = dateOnly(businessDate);
  if (dateOnly(membership.startDate) > day) {
    throw new BadRequestError('Membership is not valid yet', 'MEMBERSHIP_NOT_STARTED');
  }
  if (membership.endDate && dateOnly(membership.endDate) < day) {
    throw new BadRequestError('Membership has expired', 'MEMBERSHIP_EXPIRED');
  }

  const rate = Number(membership.benefitDiscountRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new BadRequestError('Membership discount configuration is invalid', 'MEMBERSHIP_BENEFIT_INVALID');
  }

  const safeSubtotal = Math.max(0, Number(subtotal));
  const membershipDiscount = round4(Math.min(safeSubtotal, safeSubtotal * rate));
  const remaining = round4(Math.max(0, safeSubtotal - membershipDiscount));
  const manualDiscount = round4(Math.min(Math.max(Number(requestedManualDiscount || 0), 0), remaining));
  return {
    membershipId: membership.id,
    membershipNumberSnapshot: membership.membershipNumber,
    membershipTierSnapshot: membership.tier,
    membershipDiscount,
    manualDiscount,
    totalDiscount: round4(membershipDiscount + manualDiscount),
  };
}
