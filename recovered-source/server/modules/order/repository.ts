import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  Order,
  OrderItem,
  OrderWithItems,
  CreateOrderInput,
  OrderStatus,
  OrderListResult,
  ListOrdersParams,
  OrderRound,
} from './types';
import { KotItemData } from '../order/service';
import { kitchenRepository } from '../kitchen/repository';
import { administrationRepository } from '../administration/repository';
import { NotFoundError, BadRequestError, ConflictError } from '../../shared/errors';
import { getDatabasePool } from '../../db/pool';
import { recipeRepository } from '../recipe/repository';
import { releaseOrderTablesInTransaction } from '../tableOperations/orderTables';

function mapOrderRow(row: RowDataPacket): Order {
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    orderNumber: row.order_number,
    orderType: row.order_type,
    diningTableId: row.dining_table_id != null ? Number(row.dining_table_id) : null,
    customerId: row.customer_id != null ? Number(row.customer_id) : null,
    membershipId: row.membership_id != null ? Number(row.membership_id) : null,
    membershipNumberSnapshot: row.membership_number_snapshot == null ? null : String(row.membership_number_snapshot),
    membershipTierSnapshot: row.membership_tier_snapshot == null ? null : String(row.membership_tier_snapshot),
    waiterId: row.waiter_id != null ? Number(row.waiter_id) : null,
    createdBy: Number(row.created_by),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    membershipDiscount: Number(row.membership_discount || 0),
    manualDiscount: Number(row.manual_discount ?? row.discount ?? 0),
    taxableAmount: Number(row.taxable_amount || 0),
    tax: Number(row.tax),
    vatRegisteredSnapshot: Boolean(row.vat_registered_snapshot),
    taxRegistrationNumberSnapshot: row.tax_registration_number_snapshot == null ? null : String(row.tax_registration_number_snapshot),
    vatRateSnapshot: Number(row.vat_rate_snapshot || 0),
    roundingMethodSnapshot: row.rounding_method_snapshot,
    roundingDelta: Number(row.rounding_delta || 0),
    grandTotal: Number(row.grand_total),
    orderStatus: row.order_status,
    paymentStatus: row.payment_status,
    settlementStatus: row.settlement_status == null ? 'OPEN' : String(row.settlement_status) as Order['settlementStatus'],
    cancelledAt: row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : row.cancelled_at,
    cancelledBy: row.cancelled_by != null ? Number(row.cancelled_by) : null,
    cancellationReason: row.cancellation_reason,
    readyAt: row.ready_at == null ? null : (row.ready_at instanceof Date ? row.ready_at.toISOString() : String(row.ready_at)),
    servedAt: row.served_at == null ? null : (row.served_at instanceof Date ? row.served_at.toISOString() : String(row.served_at)),
    servedBy: row.served_by != null ? Number(row.served_by) : null,
    pickedUpAt: row.picked_up_at == null ? null : (row.picked_up_at instanceof Date ? row.picked_up_at.toISOString() : String(row.picked_up_at)),
    pickedUpBy: row.picked_up_by != null ? Number(row.picked_up_by) : null,
    completedAt: row.completed_at == null ? null : (row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at)),
    completedBy: row.completed_by != null ? Number(row.completed_by) : null,
    mergedIntoOrderId: row.merged_into_order_id != null ? Number(row.merged_into_order_id) : null,
    mergedAt: row.merged_at == null ? null : (row.merged_at instanceof Date ? row.merged_at.toISOString() : String(row.merged_at)),
    mergedBy: row.merged_by != null ? Number(row.merged_by) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapOrderItemRow(row: RowDataPacket): OrderItem {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    orderRoundId: Number(row.order_round_id),
    roundNumber: Number(row.round_number),
    roundType: row.round_type,
    roundStatus: row.round_status,
    menuItemId: Number(row.menu_item_id),
    itemNameSnapshot: row.item_name_snapshot,
    unitPrice: Number(row.unit_price),
    enteredUnitPriceSnapshot: Number(row.entered_unit_price_snapshot),
    priceEntryModeSnapshot: row.price_entry_mode_snapshot,
    quantity: Number(row.quantity),
    lineSubtotal: Number(row.line_subtotal),
    discountAmountSnapshot: Number(row.discount_amount_snapshot || 0),
    lineTotal: Number(row.line_total),
    variantId: row.variant_id != null ? Number(row.variant_id) : null,
    variantNameSnapshot: row.variant_name_snapshot == null ? null : String(row.variant_name_snapshot),
    baseUnitPriceSnapshot: row.base_unit_price_snapshot != null ? Number(row.base_unit_price_snapshot) : Number(row.unit_price),
    modifierTotal: Number(row.modifier_total || 0),
    modifierSnapshot: row.modifier_snapshot_json ? (typeof row.modifier_snapshot_json === 'string' ? JSON.parse(row.modifier_snapshot_json) : row.modifier_snapshot_json) : [],
    taxRateSnapshot: Number(row.tax_rate_snapshot || 0),
    taxableAmount: Number(row.taxable_amount || 0),
    taxAmount: Number(row.tax_amount || 0),
    notes: row.notes,
    originOrderId: row.origin_order_id != null ? Number(row.origin_order_id) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function mapOrderRoundRow(row: RowDataPacket): OrderRound {
  const iso = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
  return {
    id: Number(row.id),
    organizationId: Number(row.organization_id),
    branchId: Number(row.branch_id),
    orderId: Number(row.order_id),
    roundNumber: Number(row.round_number),
    roundType: row.round_type,
    status: row.status,
    priorOrderStatus: row.prior_order_status == null ? null : row.prior_order_status,
    priorReadyAt: iso(row.prior_ready_at),
    priorServedAt: iso(row.prior_served_at),
    priorServedBy: row.prior_served_by == null ? null : Number(row.prior_served_by),
    createdBy: Number(row.created_by),
    cancelledAt: iso(row.cancelled_at),
    cancelledBy: row.cancelled_by == null ? null : Number(row.cancelled_by),
    cancellationReason: row.cancellation_reason == null ? null : String(row.cancellation_reason),
    hasServedItems: Boolean(row.has_served_items),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

export class OrderRepository {
  private pool() {
    return getDatabasePool();
  }

  async generateOrderNumber(
    conn: PoolConnection,
    organizationId: number,
    branchId: number,
    billPrefix: string
  ): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10); // YYYY-MM-DD
    const yyMMDD = today.toISOString().slice(2, 4) + today.toISOString().slice(5, 7) + today.toISOString().slice(8, 10);

    const [counterRows] = await conn.execute<RowDataPacket[]>(
      `SELECT next_seq FROM order_number_counters
       WHERE organization_id = ? AND branch_id = ? AND counter_date = ?
       FOR UPDATE`,
      [organizationId, branchId, dateStr]
    );

    let seq: number;
    if (counterRows.length > 0) {
      seq = Number(counterRows[0].next_seq);
      await conn.execute(
        'UPDATE order_number_counters SET next_seq = next_seq + 1, updated_at = NOW() WHERE organization_id = ? AND branch_id = ? AND counter_date = ?',
        [organizationId, branchId, dateStr]
      );
    } else {
      seq = 1;
      await conn.execute(
        `INSERT INTO order_number_counters (organization_id, branch_id, counter_date, next_seq)
         VALUES (?, ?, ?, 2)`,
        [organizationId, branchId, dateStr]
      );
    }

    const paddedSeq = String(seq).padStart(4, '0');
    return `${billPrefix}${yyMMDD}-${paddedSeq}`;
  }

  async createPrepared(
    organizationId: number,
    branchId: number,
    createdBy: number,
    input: CreateOrderInput,
    billPrefix: string,
    tableLabel: string | null,
    waiterName: string | null,
    prepare: (conn: PoolConnection) => Promise<{ resolvedItems: any[]; kotItems: KotItemData[]; totals: { subtotal: number; discount: number; membershipDiscount: number; manualDiscount: number; taxableAmount: number; tax: number; roundingDelta: number; grandTotal: number }; membershipBenefit: { membershipId: number; membershipNumberSnapshot: string; membershipTierSnapshot: string; membershipDiscount: number } | null; vatSnapshot: { isVatRegistered: boolean; taxRegistrationNumber: string | null; vatRate: number; roundingMethod: string } }>,
    operationalContext?: { businessDayId: number; shiftId: number | null; registerId: number | null },
    idempotency?: { key: string; hash: string }
    ): Promise<{ order: OrderWithItems; replayed: boolean }> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      if (operationalContext) {
        const [days] = await conn.execute<RowDataPacket[]>('SELECT status FROM business_days WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [operationalContext.businessDayId, organizationId, branchId]);
        if (!days.length || days[0].status !== 'OPEN') throw new ConflictError('An open business day is required', 'BUSINESS_DAY_REQUIRED');
      } else {
        await conn.execute('SELECT id FROM branches WHERE id = ? AND organization_id = ? FOR UPDATE', [branchId, organizationId]);
      }
      if (idempotency) {
        const [existingRows] = await conn.execute<RowDataPacket[]>(
          'SELECT id, idempotency_hash FROM orders WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE',
          [organizationId, branchId, idempotency.key]
        );
        if (existingRows.length) {
          if (String(existingRows[0].idempotency_hash || '') !== idempotency.hash) {
            throw new ConflictError('Idempotency key was already used for a different order payload', 'IDEMPOTENCY_KEY_CONFLICT');
          }
          const existingId = Number(existingRows[0].id);
          await conn.rollback();
          const existing = await this.findById(existingId, organizationId, branchId);
          if (!existing) throw new NotFoundError('Idempotent order result not found', 'ORDER_NOT_FOUND');
          return { order: existing, replayed: true };
        }
      }
      if (input.diningTableId != null && input.orderType === 'DINE_IN') {
        await administrationRepository.lockTableForOccupancy(conn, input.diningTableId, organizationId, branchId);
      }
      const prepared = await prepare(conn);
      const orderNumber = await this.generateOrderNumber(conn, organizationId, branchId, billPrefix);
      const [orderResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO orders (organization_id, branch_id, business_day_id, shift_id, register_id, idempotency_key, idempotency_hash, order_number, order_type, dining_table_id, customer_id, membership_id, membership_number_snapshot, membership_tier_snapshot, waiter_id, created_by, subtotal, discount, membership_discount, manual_discount, taxable_amount, tax, vat_registered_snapshot, tax_registration_number_snapshot, vat_rate_snapshot, rounding_method_snapshot, rounding_delta, grand_total, order_status, payment_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLACED', 'UNPAID')`,
        [organizationId, branchId, operationalContext?.businessDayId ?? null, operationalContext?.shiftId ?? null, operationalContext?.registerId ?? null, idempotency?.key ?? null, idempotency?.hash ?? null, orderNumber, input.orderType, input.diningTableId ?? null, input.customerId ?? null, prepared.membershipBenefit?.membershipId ?? null, prepared.membershipBenefit?.membershipNumberSnapshot ?? null, prepared.membershipBenefit?.membershipTierSnapshot ?? null, input.waiterId ?? null, createdBy, prepared.totals.subtotal, prepared.totals.discount, prepared.totals.membershipDiscount, prepared.totals.manualDiscount, prepared.totals.taxableAmount, prepared.totals.tax, prepared.vatSnapshot.isVatRegistered, prepared.vatSnapshot.taxRegistrationNumber, prepared.vatSnapshot.vatRate, prepared.vatSnapshot.roundingMethod, prepared.totals.roundingDelta, prepared.totals.grandTotal]
      );
      const orderId = Number(orderResult.insertId);
      const [roundResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO order_rounds
          (organization_id, branch_id, order_id, round_number, round_type, status, created_by)
         VALUES (?, ?, ?, 1, 'INITIAL', 'ACTIVE', ?)`,
        [organizationId, branchId, orderId, createdBy],
      );
      const orderRoundId = Number(roundResult.insertId);
      if (prepared.membershipBenefit && prepared.membershipBenefit.membershipDiscount > 0 && input.customerId != null) {
        await conn.execute(
          `INSERT INTO membership_usages (organization_id, membership_id, customer_id, order_id, benefit_type, benefit_amount, notes, used_at, created_by)
           VALUES (?, ?, ?, ?, 'ORDER_DISCOUNT', ?, ?, NOW(), ?)`,
          [organizationId, prepared.membershipBenefit.membershipId, input.customerId, orderId, prepared.membershipBenefit.membershipDiscount, `Applied ${prepared.membershipBenefit.membershipTierSnapshot} membership benefit`, createdBy]
        );
      }
      if (input.diningTableId != null && input.orderType === 'DINE_IN') {
        await conn.execute(`UPDATE dining_tables SET status = 'occupied', updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`, [input.diningTableId, organizationId, branchId]);
      }
      for (const item of prepared.resolvedItems) {
        const [itemResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO order_items (order_id, order_round_id, menu_item_id, item_name_snapshot, unit_price, entered_unit_price_snapshot, price_entry_mode_snapshot, quantity, line_subtotal, discount_amount_snapshot, taxable_amount, tax_rate_snapshot, tax_amount, line_total, variant_id, variant_name_snapshot, base_unit_price_snapshot, modifier_total, modifier_snapshot_json, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [orderId, orderRoundId, item.menuItemId, item.itemNameSnapshot, item.unitPrice, item.enteredUnitPrice, item.priceEntryMode, item.quantity, item.lineSubtotal, item.discountAllocation ?? 0, item.taxableAmount, item.taxRateSnapshot, item.taxAmount, item.lineTotal, item.variantId, item.variantNameSnapshot, item.baseUnitPriceSnapshot, item.modifierTotal, JSON.stringify(item.modifierSnapshot), item.notes ?? null]
        );
        await recipeRepository.consumeOrderItemInTransaction(
          conn,
          organizationId,
          branchId,
          orderId,
          Number(itemResult.insertId),
          item.menuItemId,
          item.quantity,
          item.variantId ?? null,
          item.modifierSnapshot ?? [],
          createdBy
        );
      }
      if (prepared.kotItems.length) {
        await kitchenRepository.createKotWithItems(conn, organizationId, branchId, orderId, orderRoundId, orderNumber, input.orderType, tableLabel, waiterName, prepared.kotItems);
      }
      await conn.commit();
      const order = await this.findById(orderId, organizationId, branchId);
      if (!order) throw new NotFoundError('Created order not found', 'ORDER_NOT_FOUND');
      return { order, replayed: false };
    } catch (err: any) {
      await conn.rollback();
      if (idempotency && err?.errno === 1062) {
        const [rows] = await this.pool().execute<RowDataPacket[]>(
          'SELECT id, idempotency_hash FROM orders WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1',
          [organizationId, branchId, idempotency.key]
        );
        if (rows.length) {
          if (String(rows[0].idempotency_hash || '') !== idempotency.hash) throw new ConflictError('Idempotency key was already used for a different order payload', 'IDEMPOTENCY_KEY_CONFLICT');
          const existing = await this.findById(Number(rows[0].id), organizationId, branchId);
          if (existing) return { order: existing, replayed: true };
        }
      }
      throw err;
    } finally { conn.release(); }
  }

  async findById(id: number, organizationId: number, branchId?: number): Promise<OrderWithItems | null> {
    const conditions = 'id = ? AND organization_id = ?' + (branchId != null ? ' AND branch_id = ?' : '');
    const params: any[] = branchId != null ? [id, organizationId, branchId] : [id, organizationId];
    const [orderRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT * FROM orders WHERE ${conditions}`,
      params
    );

    if (orderRows.length === 0) return null;

    const order = mapOrderRow(orderRows[0]);

    const [roundRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT r.*,
              EXISTS(
                SELECT 1
                  FROM kitchen_tickets kt
                  JOIN kitchen_ticket_items kti ON kti.kitchen_ticket_id=kt.id
                 WHERE kt.order_round_id=r.id AND kti.item_status='SERVED'
              ) AS has_served_items
         FROM order_rounds r
        WHERE r.order_id=?
        ORDER BY r.round_number ASC`,
      [id],
    );
    const [itemRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT oi.*, r.round_number, r.round_type, r.status AS round_status
         FROM order_items oi
         JOIN order_rounds r ON r.id = oi.order_round_id
        WHERE oi.order_id = ?
        ORDER BY r.round_number ASC, oi.id ASC`,
      [id],
    );

    return {
      ...order,
      items: itemRows.map(mapOrderItemRow),
      rounds: roundRows.map(mapOrderRoundRow),
    };
  }

  async list(organizationId: number, branchId: number, params: ListOrdersParams): Promise<OrderListResult> {
    const conditions: string[] = ['o.organization_id = ?', 'o.branch_id = ?'];
    const bindValues: any[] = [organizationId, branchId];

    if (params.accessibleTableIds) {
      if (params.accessibleTableIds.length === 0) {
        // Takeaway orders are not table-scoped. A user with order-view permission
        // may still work with takeaway orders even when they have no table allocation.
        conditions.push("o.order_type = 'TAKEAWAY'");
      } else {
        const placeholders = params.accessibleTableIds.map(() => '?').join(',');
        conditions.push(`(
          o.order_type = 'TAKEAWAY'
          OR o.dining_table_id IN (${placeholders})
          OR EXISTS (
            SELECT 1 FROM order_tables ot_access
             WHERE ot_access.organization_id = o.organization_id
               AND ot_access.branch_id = o.branch_id
               AND ot_access.order_id = o.id
               AND ot_access.dining_table_id IN (${placeholders})
          )
        )`);
        bindValues.push(...params.accessibleTableIds, ...params.accessibleTableIds);
      }
    }

    if (params.orderStatus) {
      conditions.push('o.order_status = ?');
      bindValues.push(params.orderStatus);
    }
    if (params.paymentStatus) {
      conditions.push('o.payment_status = ?');
      bindValues.push(params.paymentStatus);
    }
    if (params.diningTableId) {
      conditions.push(`(
        o.dining_table_id = ?
        OR EXISTS (
          SELECT 1 FROM order_tables ot_filter
           WHERE ot_filter.organization_id = o.organization_id
             AND ot_filter.branch_id = o.branch_id
             AND ot_filter.order_id = o.id
             AND ot_filter.dining_table_id = ?
        )
      )`);
      bindValues.push(params.diningTableId, params.diningTableId);
    }
    if (params.waiterId) {
      conditions.push('o.waiter_id = ?');
      bindValues.push(params.waiterId);
    }
    if (params.orderNumber) {
      conditions.push('o.order_number LIKE ?');
      bindValues.push(`%${params.orderNumber}%`);
    }
    if (params.dateFrom) {
      conditions.push('o.created_at >= ?');
      bindValues.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      bindValues.push(params.dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM orders o ${whereClause}`,
      bindValues
    );
    const total = Number(countRows[0].total);

    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const offset = (page - 1) * limit;

    const [orderRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT o.* FROM orders o ${whereClause} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
      [...bindValues, limit, offset]
    );

    const orders = orderRows.map(mapOrderRow);

    return {
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateStatus(
    id: number,
    organizationId: number,
    branchId: number,
    newStatus: OrderStatus,
    userId: number
  ): Promise<Order> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
        [id, organizationId, branchId]
      );

      if (existing.length === 0) {
        throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      }

      const order = existing[0];
      const currentStatus = order.order_status;

      if (currentStatus === 'CANCELLED') {
        throw new BadRequestError('Cannot change status of a cancelled order', 'ORDER_CANCELLED');
      }
      if (currentStatus === 'MERGED') {
        throw new BadRequestError('Cannot change status of a merged order', 'ORDER_MERGED');
      }

      if (newStatus === 'COMPLETED' && order.payment_status !== 'PAID') {
        throw new BadRequestError('Order cannot be completed until its bill is fully paid', 'ORDER_NOT_FINANCIALLY_SETTLED');
      }
      if (newStatus === 'SERVED' && order.order_type !== 'DINE_IN') {
        throw new BadRequestError('Only dine-in orders require a served action', 'ORDER_NOT_SERVABLE');
      }

      if (newStatus === 'SERVED') {
        await conn.execute(
          `UPDATE orders SET order_status = 'SERVED', served_at = COALESCE(served_at, NOW()), served_by = ?, updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [userId, id, organizationId, branchId]
        );
      } else if (newStatus === 'COMPLETED') {
        if (order.dining_table_id != null) {
          await administrationRepository.lockTableForUpdate(conn, Number(order.dining_table_id), organizationId, branchId);
        }
        await conn.execute(
          `UPDATE orders SET order_status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW()), completed_by = ?, updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [userId, id, organizationId, branchId]
        );
        if (order.dining_table_id != null) {
          await administrationRepository.releaseTableIfUnoccupied(conn, Number(order.dining_table_id), organizationId, branchId);
        }
      } else if (newStatus === 'READY') {
        await conn.execute(
          `UPDATE orders SET order_status = 'READY', ready_at = COALESCE(ready_at, NOW()), updated_at = NOW()
           WHERE id = ? AND organization_id = ? AND branch_id = ?`,
          [id, organizationId, branchId]
        );
      } else {
        await conn.execute(
          'UPDATE orders SET order_status = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?',
          [newStatus, id, organizationId, branchId]
        );
      }

      await conn.commit();

      const updated = await this.findById(id, organizationId, branchId);
      if (!updated) {
        throw new NotFoundError('Order not found after update', 'ORDER_NOT_FOUND');
      }
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async serve(
    id: number,
    organizationId: number,
    branchId: number,
    userId: number
  ): Promise<Order> {
    return this.updateStatus(id, organizationId, branchId, 'SERVED', userId);
  }

  async complete(
    id: number,
    organizationId: number,
    branchId: number,
    userId: number
  ): Promise<Order> {
    return this.updateStatus(id, organizationId, branchId, 'COMPLETED', userId);
  }

  async cancel(
    id: number,
    organizationId: number,
    branchId: number,
    cancelledBy: number,
    cancellationReason?: string
  ): Promise<Order> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();

      const [existing] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE',
        [id, organizationId, branchId]
      );

      if (existing.length === 0) {
        throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      }

      const order = existing[0];
      const [activeRounds] = await conn.execute<RowDataPacket[]>(
        `SELECT id, round_number, round_type
           FROM order_rounds
          WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND status = 'ACTIVE'
          ORDER BY round_number`,
        [id, organizationId, branchId],
      );
      if (activeRounds.length > 1) {
        throw new ConflictError(
          'This order has added rounds. Cancel the latest added order first so earlier served or ready items remain intact.',
          'ORDER_HAS_ACTIVE_ADDITIONS',
        );
      }
      if (order.order_status === 'CANCELLED') {
        throw new BadRequestError('Order is already cancelled', 'ORDER_ALREADY_CANCELLED');
      }
      if (order.order_status === 'MERGED') {
        throw new BadRequestError('Cannot cancel a merged order', 'ORDER_MERGED');
      }
      if (order.order_status === 'SERVED' || order.order_status === 'COMPLETED') {
        throw new BadRequestError(
          'Cannot cancel an order that has been served or completed',
          'ORDER_CANNOT_CANCEL'
        );
      }
      if (order.order_type === 'TAKEAWAY' && order.picked_up_at != null) {
        throw new BadRequestError(
          'Cannot cancel a takeaway order after it has been picked up',
          'TAKEAWAY_ALREADY_PICKED_UP'
        );
      }

      await conn.execute(
        `UPDATE orders
         SET order_status = 'CANCELLED',
             cancelled_at = NOW(),
             cancelled_by = ?,
             cancellation_reason = ?,
             updated_at = NOW()
         WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [cancelledBy, cancellationReason ?? null, id, organizationId, branchId]
      );
      await conn.execute(
        `UPDATE order_rounds
            SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=?,
                cancellation_reason=?, updated_at=NOW()
          WHERE order_id=? AND organization_id=? AND branch_id=? AND status='ACTIVE'`,
        [cancelledBy, cancellationReason ?? null, id, organizationId, branchId],
      );

      await kitchenRepository.voidActiveTicketsForOrder(conn, id, cancelledBy);

      await recipeRepository.reverseOrderConsumptionInTransaction(
        conn,
        organizationId,
        branchId,
        id,
        cancelledBy,
        cancellationReason || 'Order cancelled before service'
      );

      if (order.order_type === 'DINE_IN') {
        await releaseOrderTablesInTransaction(
          conn,
          organizationId,
          branchId,
          id,
          cancelledBy,
        );
      }

      await conn.commit();

      const updated = await this.findById(id, organizationId, branchId);
      if (!updated) {
        throw new NotFoundError('Order not found after cancellation', 'ORDER_NOT_FOUND');
      }
      return updated;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

export const orderRepository = new OrderRepository();