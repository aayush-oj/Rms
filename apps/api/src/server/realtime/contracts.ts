import { realtimePublisher } from './publisher';

export type OrderPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface RealtimeTenantContext {
  organizationId: number;
  branchId: number;
}

export function publishPaymentCompleted(
  context: RealtimeTenantContext,
  input: { paymentId: number; billId: number; amount: number; paymentStatus: OrderPaymentStatus; orderId: number }
) {
  return realtimePublisher.publish({
    type: 'payment.completed',
    organizationId: context.organizationId,
    branchId: context.branchId,
    entityType: 'payment',
    entityId: input.paymentId,
    data: {
      billId: input.billId,
      amount: input.amount,
      paymentStatus: input.paymentStatus,
      orderId: input.orderId,
    },
  });
}

export function publishPaymentReversed(
  context: RealtimeTenantContext,
  input: { paymentId: number; billId: number; status: string; orderId: number; paymentStatus: OrderPaymentStatus }
) {
  return realtimePublisher.publish({
    type: 'payment.reversed',
    organizationId: context.organizationId,
    branchId: context.branchId,
    entityType: 'payment',
    entityId: input.paymentId,
    data: {
      billId: input.billId,
      status: input.status,
      orderId: input.orderId,
      paymentStatus: input.paymentStatus,
    },
  });
}

export function publishBillUpdated(
  context: RealtimeTenantContext,
  input: { billId: number; orderId: number; status: string; amountPaid: number; balanceDue: number }
) {
  return realtimePublisher.publish({
    type: 'bill.updated',
    organizationId: context.organizationId,
    branchId: context.branchId,
    entityType: 'bill',
    entityId: input.billId,
    data: {
      orderId: input.orderId,
      status: input.status,
      amountPaid: input.amountPaid,
      balanceDue: input.balanceDue,
    },
  });
}

export function publishOrderPaymentStatusChanged(
  context: RealtimeTenantContext,
  input: {
    orderId: number;
    paymentStatus: OrderPaymentStatus;
    orderStatus: string;
    billId?: number;
    reversedPaymentId?: number;
  }
) {
  return realtimePublisher.publish({
    type: 'order.payment_status_changed',
    organizationId: context.organizationId,
    branchId: context.branchId,
    entityType: 'order',
    entityId: input.orderId,
    data: {
      paymentStatus: input.paymentStatus,
      orderStatus: input.orderStatus,
      ...(input.billId != null ? { billId: input.billId } : {}),
      ...(input.reversedPaymentId != null ? { reversedPaymentId: input.reversedPaymentId } : {}),
    },
  });
}

export function publishOrderCompleted(
  context: RealtimeTenantContext,
  input: { orderId: number; paymentStatus?: OrderPaymentStatus; diningTableId: number | null }
) {
  return realtimePublisher.publish({
    type: 'order.completed',
    organizationId: context.organizationId,
    branchId: context.branchId,
    entityType: 'order',
    entityId: input.orderId,
    data: {
      orderStatus: 'COMPLETED',
      ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
      diningTableId: input.diningTableId,
    },
  });
}

export function publishTableOrderReleased(
  context: RealtimeTenantContext,
  input: { tableId: number; orderId: number; status: string }
) {
  return realtimePublisher.publish({
    type: 'table.order_released',
    organizationId: context.organizationId,
    branchId: context.branchId,
    entityType: 'table',
    entityId: input.tableId,
    data: { orderId: input.orderId, status: input.status.toUpperCase() },
  });
}
