import { getBillingEligibility } from '../../domain/orderLifecycle';
import { ConflictError } from '../../shared/errors';

type BillableOrder = {
  order_type: string;
  order_status: string;
};

/**
 * Stable service -> billing boundary.
 *
 * Dine-in becomes billable only after every active service item has been served,
 * which is represented by the order-level SERVED state.
 * Takeaway does not require a waiter/service step and becomes billable at READY.
 */
export function assertOrderReadyForBilling(order: BillableOrder): void {
  const result = getBillingEligibility(String(order.order_type), String(order.order_status));
  if (result.eligible === false) {
    throw new ConflictError(
      result.message,
      result.code,
      { orderStatus: String(order.order_status), orderType: String(order.order_type) }
    );
  }
}
