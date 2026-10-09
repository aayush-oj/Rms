import type { OrderStatus, OrderType } from '../modules/order/types';

export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  MERGED: [],
};

export const ACTIVE_ORDER_STATUSES = ['PLACED', 'PREPARING', 'READY', 'SERVED'] as const satisfies readonly OrderStatus[];
export const TERMINAL_ORDER_STATUSES = ['COMPLETED', 'CANCELLED', 'MERGED'] as const satisfies readonly OrderStatus[];
export const TABLE_OWNING_ORDER_STATUSES = ACTIVE_ORDER_STATUSES;
export const APPENDABLE_ORDER_STATUSES = ['PLACED', 'PREPARING', 'READY'] as const satisfies readonly OrderStatus[];

export function isOrderStatus(value: string): value is OrderStatus {
  return value in ORDER_STATUS_TRANSITIONS;
}

export function isActiveOrderStatus(status: string): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function isTerminalOrderStatus(status: string): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

export function canOrderOwnTable(status: string): boolean {
  return (TABLE_OWNING_ORDER_STATUSES as readonly string[]).includes(status);
}

export function isOrderAppendable(status: string): boolean {
  return (APPENDABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export function canAppendOrderItems(
  orderType: OrderType | string,
  orderStatus: OrderStatus | string,
  pickedUp: boolean
): boolean {
  if (orderType === 'DINE_IN') return ['PLACED', 'PREPARING', 'READY', 'SERVED'].includes(String(orderStatus));
  if (orderType === 'TAKEAWAY') return !pickedUp && ['PLACED', 'PREPARING', 'READY'].includes(String(orderStatus));
  return false;
}

export type BillingEligibility =
  | { eligible: true }
  | { eligible: false; code: 'ORDER_NOT_BILLABLE' | 'ORDER_NOT_READY_FOR_BILLING'; message: string };

export function getBillingEligibility(orderType: string, orderStatus: string): BillingEligibility {
  if (isTerminalOrderStatus(orderStatus)) {
    return { eligible: false, code: 'ORDER_NOT_BILLABLE', message: 'Closed historical orders cannot be billed' };
  }

  if (orderType === 'DINE_IN') {
    return orderStatus === 'SERVED'
      ? { eligible: true }
      : { eligible: false, code: 'ORDER_NOT_READY_FOR_BILLING', message: 'Dine-in orders must be fully served before billing' };
  }

  if (orderType === 'TAKEAWAY') {
    return orderStatus === 'READY' || orderStatus === 'SERVED'
      ? { eligible: true }
      : { eligible: false, code: 'ORDER_NOT_READY_FOR_BILLING', message: 'Takeaway orders must be ready before billing' };
  }

  return { eligible: false, code: 'ORDER_NOT_BILLABLE', message: 'This order type cannot be billed' };
}

export function canCompleteOrderAfterSettlement(
  orderType: OrderType | string,
  orderStatus: OrderStatus | string,
  financiallySettled: boolean,
  pickedUp: boolean
): boolean {
  if (!financiallySettled) return false;
  if (orderType === 'DINE_IN') return orderStatus === 'SERVED';
  if (orderType === 'TAKEAWAY') return orderStatus === 'READY' && pickedUp;
  return false;
}

export function isBillableOrder(orderType: OrderType | string, orderStatus: OrderStatus | string): boolean {
  return getBillingEligibility(orderType, orderStatus).eligible;
}
