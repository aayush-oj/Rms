import { RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import type { DiscountType } from './mixedSettlement';
import { calculateOrderPricing } from '../../domain/pricing';

const EPSILON = 0.0001;
export async function applyBillingDiscount(data: {
  organizationId: number;
  branchId: number;
  orderId: number;
  type: DiscountType;
  value: number;
}) {
  const pool = getDatabasePool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [data.orderId, data.organizationId, data.branchId]
    );
    if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const order = orders[0];
    if (['CANCELLED', 'MERGED', 'COMPLETED'].includes(String(order.order_status))) {
      throw new ConflictError('Discount cannot be changed for this order', 'DISCOUNT_LOCKED');
    }

    const [billRows] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
      [data.orderId, data.organizationId, data.branchId]
    );
    if (billRows.length > 1 || billRows.some((row) => row.split_batch_id != null)) {
      throw new ConflictError('Apply the discount before splitting the bill', 'DISCOUNT_SPLIT_LOCKED');
    }
    if (billRows.some((row) => Number(row.amount_paid || 0) > EPSILON || Number(row.credit_total || 0) > EPSILON)) {
      throw new ConflictError('Discount cannot be changed after payment or customer credit has been recorded', 'DISCOUNT_PAYMENT_LOCKED');
    }

    const [items] = await conn.execute<RowDataPacket[]>(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id FOR UPDATE',
      [data.orderId]
    );
    if (!items.length) throw new BadRequestError('Order has no items', 'ORDER_HAS_NO_ITEMS');

    const subtotal = items.reduce((sum, item) => sum + Number(item.line_subtotal || 0), 0);
    const membershipDiscount = Math.min(Number(order.membership_discount || 0), subtotal);
    const rawValue = data.type === 'NONE' ? 0 : Math.max(0, Number(data.value || 0));
    let manualDiscount = 0;
    if (data.type === 'PERCENTAGE') manualDiscount = subtotal * Math.min(rawValue, 100) / 100;
    if (data.type === 'AMOUNT') manualDiscount = rawValue;
    manualDiscount = Math.min(manualDiscount, Math.max(0, subtotal - membershipDiscount));
    const totalDiscount = membershipDiscount + manualDiscount;
    const pricing = calculateOrderPricing(
      items.map((item) => ({ key: Number(item.id), customerPrice: Number(item.line_subtotal || 0) })),
      totalDiscount,
      {
        isVatRegistered: Boolean(order.vat_registered_snapshot),
        vatRate: Number(order.vat_rate_snapshot || 0),
        roundingMethod: String(order.rounding_method_snapshot || 'HALF_EVEN') as 'HALF_EVEN' | 'HALF_UP' | 'ROUND_DOWN' | 'ROUND_UP',
      },
    );

    for (const line of pricing.lines) {
      await conn.execute(
        `UPDATE order_items SET discount_amount_snapshot = ?, taxable_amount = ?, tax_amount = ?, line_total = ?, updated_at = NOW()
         WHERE id = ? AND order_id = ?`,
        [line.discountAmount, line.taxableAmount, line.vatAmount, line.lineTotal, line.key, data.orderId]
      );
    }

    await conn.execute(
      `UPDATE orders
          SET subtotal = ?, discount = ?, manual_discount = ?, billing_discount_type = ?, billing_discount_value = ?,
              taxable_amount = ?, tax = ?, rounding_delta = ?, grand_total = ?, updated_at = NOW()
        WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [pricing.subtotal, pricing.discount, manualDiscount, data.type, rawValue, pricing.taxableAmount, pricing.vatAmount, pricing.roundingDelta, pricing.grandTotal,
        data.orderId, data.organizationId, data.branchId]
    );

    if (billRows.length === 1) {
      const bill = billRows[0];
      await conn.execute(
        `UPDATE bills
            SET subtotal = ?, discount_total = ?, discount_type = ?, discount_value = ?, discount_reason = NULL,
                taxable_amount = ?, tax_total = ?, rounding_delta = ?, grand_total = ?, balance_due = ?, updated_at = NOW()
          WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [pricing.subtotal, pricing.discount, data.type, rawValue, pricing.taxableAmount, pricing.vatAmount, pricing.roundingDelta, pricing.grandTotal, pricing.grandTotal,
          bill.id, data.organizationId, data.branchId]
      );

      for (const item of items) {
        const line = pricing.lines.find((candidate) => Number(candidate.key) === Number(item.id))!;
        await conn.execute(
          `UPDATE bill_lines SET discount_amount = ?, taxable_amount = ?, tax_amount = ?, line_total = ?
           WHERE bill_id = ? AND order_item_id = ?`,
          [line.discountAmount, line.taxableAmount, line.vatAmount, line.lineTotal, bill.id, item.id]
        );
      }
    }

    await conn.commit();
    return {
      subtotal: pricing.subtotal,
      membershipDiscount,
      manualDiscount,
      discountTotal: pricing.discount,
      taxableAmount: pricing.taxableAmount,
      taxTotal: pricing.vatAmount,
      roundingDelta: pricing.roundingDelta,
      grandTotal: pricing.grandTotal,
      discountType: data.type,
      discountValue: rawValue,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
