import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate, requirePermission } from '../identity/middleware';
import { createOrderSchema } from '../order/validation';
import { orderService } from '../order/service';
import { orderRepository } from '../order/repository';
import { kitchenRepository } from '../kitchen/repository';
import { realtimePublisher } from '../../realtime/publisher';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { calculateOrderPricing, type RoundingMethod } from '../../domain/pricing';

const round4 = (value: number) => Number(value.toFixed(4));

export const complimentaryOrderRouter = Router();
complimentaryOrderRouter.use(authenticate());
complimentaryOrderRouter.post('/', requirePermission('pos:complimentary:apply'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.organizationId || !req.user.activeBranchId) throw new ForbiddenError('Active tenant and branch context are required', 'MISSING_TENANT_CONTEXT');
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError('Invalid complimentary order', 'INVALID_COMPLIMENTARY_ORDER');
    const input = parsed.data;
    if (!input.items.some((item) => item.isComplimentary)) throw new BadRequestError('At least one complimentary item is required', 'COMPLIMENTARY_ITEM_REQUIRED');

    const headerKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim() : '';
    if (headerKey && (headerKey.length < 8 || headerKey.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(headerKey))) {
      throw new BadRequestError('Idempotency-Key must be 8-120 URL-safe characters', 'INVALID_IDEMPOTENCY_KEY');
    }
    const baseInput = {
      ...input,
      items: input.items.map(({ isComplimentary: _isComplimentary, complimentaryReason: _complimentaryReason, ...item }) => item),
    };
    const idempotency = headerKey ? { key: headerKey, hash: crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex') } : undefined;
    const base = await orderService.createOrder(req.user.organizationId, req.user.activeBranchId, req.user.id, baseInput, req.user.permissions, idempotency);

    const pool = getDatabasePool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [orders] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
        [base.order.id, req.user.organizationId, req.user.activeBranchId]
      );
      if (!orders.length) throw new NotFoundError('Created order not found', 'ORDER_NOT_FOUND');
      const order = orders[0];
      const [items] = await conn.execute<RowDataPacket[]>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id FOR UPDATE', [base.order.id]);
      if (items.length !== input.items.length) throw new BadRequestError('Order item count changed during complimentary processing', 'COMPLIMENTARY_ITEM_MISMATCH');
      const complimentaryIndexes = new Set(input.items.map((item, index) => item.isComplimentary ? index : -1).filter((index) => index >= 0));
      const alreadyApplied = base.replayed && [...complimentaryIndexes].every((index) => Boolean(items[index]?.is_complimentary));

      if (!alreadyApplied) {
        const originalSubtotal = round4(items.reduce((sum, row) => sum + Number(row.line_subtotal || 0), 0));
        const complimentaryValue = round4(items.reduce((sum, row, index) => sum + (complimentaryIndexes.has(index) ? Number(row.line_subtotal || 0) : 0), 0));
        const chargeableSubtotal = round4(originalSubtotal - complimentaryValue);
        const originalMembershipDiscount = Number(order.membership_discount || 0);
        const membershipRate = originalSubtotal > 0 ? originalMembershipDiscount / originalSubtotal : 0;
        const membershipDiscount = round4(Math.min(chargeableSubtotal, chargeableSubtotal * membershipRate));
        const manualDiscount = round4(Math.min(Number(order.manual_discount || 0), Math.max(0, chargeableSubtotal - membershipDiscount)));
        const normalDiscount = round4(membershipDiscount + manualDiscount);
        const totalDiscount = round4(normalDiscount + complimentaryValue);
        const pricing = calculateOrderPricing(
          items.map((row, index) => ({ key: Number(row.id), customerPrice: Number(row.line_subtotal || 0), complimentary: complimentaryIndexes.has(index) })),
          totalDiscount,
          {
            isVatRegistered: Boolean(order.vat_registered_snapshot),
            vatRate: Number(order.vat_rate_snapshot || 0),
            roundingMethod: String(order.rounding_method_snapshot || 'HALF_EVEN') as RoundingMethod,
          },
        );

        for (let index = 0; index < items.length; index += 1) {
          const row = items[index];
          const requestItem = input.items[index];
          const line = pricing.lines.find((candidate) => Number(candidate.key) === Number(row.id))!;
          if (requestItem.isComplimentary) {
            await conn.execute(
              `UPDATE order_items SET is_complimentary = TRUE, complimentary_reason = ?, complimentary_by = ?, original_unit_price = unit_price,
                      discount_amount_snapshot = ?, taxable_amount = 0, tax_amount = 0, line_total = 0
               WHERE id = ?`,
              [requestItem.complimentaryReason!.trim(), req.user.id, line.discountAmount, row.id]
            );
            continue;
          }
          await conn.execute(
            `UPDATE order_items SET original_unit_price = CASE WHEN original_unit_price = 0 THEN unit_price ELSE original_unit_price END,
                    discount_amount_snapshot = ?, taxable_amount = ?, tax_amount = ?, line_total = ?
             WHERE id = ?`,
            [line.discountAmount, line.taxableAmount, line.vatAmount, line.lineTotal, row.id]
          );
        }

        await conn.execute(
          `UPDATE orders SET subtotal = ?, discount = ?, membership_discount = ?, manual_discount = ?, taxable_amount = ?, tax = ?, rounding_delta = ?, grand_total = ?, updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [pricing.subtotal, pricing.discount, membershipDiscount, manualDiscount, pricing.taxableAmount, pricing.vatAmount, pricing.roundingDelta, pricing.grandTotal, base.order.id, req.user.organizationId, req.user.activeBranchId]
        );
        if (order.membership_id != null) {
          await conn.execute('UPDATE membership_usages SET benefit_amount = ? WHERE order_id = ? AND organization_id = ?', [membershipDiscount, base.order.id, req.user.organizationId]);
        }
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    const updated = await orderRepository.findById(base.order.id, req.user.organizationId, req.user.activeBranchId);
    if (!updated) throw new NotFoundError('Complimentary order not found after update', 'ORDER_NOT_FOUND');

    if (!base.replayed) {
      realtimePublisher.publish({ type: 'order.created', organizationId: req.user.organizationId, branchId: req.user.activeBranchId, entityType: 'order', entityId: updated.id, data: { orderNumber: updated.orderNumber, orderStatus: updated.orderStatus, diningTableId: updated.diningTableId, orderType: updated.orderType, grandTotal: updated.grandTotal } });
      if (updated.diningTableId != null) realtimePublisher.publish({ type: 'table.status_changed', organizationId: req.user.organizationId, branchId: req.user.activeBranchId, entityType: 'table', entityId: updated.diningTableId, data: { status: 'OCCUPIED', orderId: updated.id, diningTableId: updated.diningTableId } });
      const tickets = await kitchenRepository.findTicketsByOrder(updated.id, req.user.organizationId, req.user.activeBranchId);
      tickets.forEach((ticket) => realtimePublisher.publish({ type: 'kot.created', organizationId: req.user!.organizationId, branchId: req.user!.activeBranchId, entityType: 'kot', entityId: ticket.id, data: { orderId: updated.id, ticketStatus: ticket.ticketStatus, orderNumber: updated.orderNumber, diningTableId: updated.diningTableId } }));
      tickets.forEach((ticket) => realtimePublisher.publish({ type: 'kds.ticket.created', organizationId: req.user!.organizationId, branchId: req.user!.activeBranchId, entityType: 'kds_ticket', entityId: ticket.id, data: { orderId: updated.id, ticketStatus: ticket.ticketStatus, diningTableId: updated.diningTableId } }));
      realtimePublisher.publish({ type: 'inventory.stock_changed', organizationId: req.user.organizationId, branchId: req.user.activeBranchId, entityType: 'inventory_balance', entityId: updated.id, data: { source: 'ORDER_SENT', orderId: updated.id } });
    }

    res.setHeader('Idempotency-Replayed', base.replayed ? 'true' : 'false');
    res.status(base.replayed ? 200 : 201).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});
