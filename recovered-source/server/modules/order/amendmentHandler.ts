import { createHash } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { menuCustomizationRepository } from '../menuCustomization/repository';
import { ModifierSelectionInput } from '../menuCustomization/types';
import { kitchenRepository } from '../kitchen/repository';
import { recipeRepository } from '../recipe/repository';
import { managementRepository } from '../management/repository';
import { realtimePublisher } from '../../realtime/publisher';
import { orderRepository } from './repository';
import { addMoney, calculateMenuPrice, calculateOrderPricing, multiplyMoney, type RoundingMethod, type VatProfileInput } from '../../domain/pricing';
import { canAppendOrderItems } from '../../domain/orderLifecycle';
import { buildComboKotItems } from './comboSupport';

const MOVEABLE_STATUSES = new Set(['READY', 'SERVED']);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const EPSILON = 0.0001;

function round4(value: number): number { return Number(value.toFixed(4)); }

function parseOrderId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestError('Valid order ID is required', 'INVALID_ORDER_ID');
  return id;
}

function parseIdempotencyKey(req: Request): string | null {
  const raw = req.header('Idempotency-Key');
  if (!raw) return null;
  const key = raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new BadRequestError('Idempotency-Key must be 8-120 characters using letters, numbers, dot, underscore, colon or hyphen', 'INVALID_IDEMPOTENCY_KEY');
  }
  return key;
}

function appendRequestHash(orderId: number, items: unknown[]): string {
  return createHash('sha256').update(JSON.stringify({ orderId, items })).digest('hex');
}

function assertAuth(req: Request) {
  if (!req.user?.organizationId || !req.user.activeBranchId) throw new ForbiddenError('Authenticated branch context is required', 'MISSING_TENANT_CONTEXT');
  return { organizationId: req.user.organizationId, branchId: req.user.activeBranchId, userId: req.user.id, permissions: req.user.permissions };
}

async function assertTableAccess(req: Request, tableId: number) {
  const { organizationId, branchId, userId, permissions } = assertAuth(req);
  const privileged = req.user!.role === 'OWNER' || permissions.includes('admin:all') || permissions.includes('admin:tables:manage') || permissions.includes('admin:access:manage');
  if (privileged) return;
  if (!(await managementRepository.canAccessTable(organizationId, userId, branchId, tableId, permissions))) throw new ForbiddenError('You do not have access to this table', 'TABLE_ACCESS_FORBIDDEN');
}

async function lockOrder(conn: PoolConnection, organizationId: number, branchId: number, orderId: number) {
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [orderId, organizationId, branchId]);
  if (!rows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
  return rows[0];
}

async function assertNoBill(conn: PoolConnection, organizationId: number, branchId: number, orderId: number) {
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT id FROM bills WHERE organization_id = ? AND branch_id = ? AND order_id = ? LIMIT 1 FOR UPDATE', [organizationId, branchId, orderId]);
  if (rows.length) throw new ConflictError('This order already has billing records and can no longer be amended', 'ORDER_BILL_EXISTS');
}

async function lockPendingBillForAppend(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  orderType: string,
  orderStatus: string,
): Promise<number | null> {
  const [bills] = await conn.execute<RowDataPacket[]>(
    `SELECT id, status, amount_paid, credit_total, split_batch_id
     FROM bills
     WHERE organization_id = ? AND branch_id = ? AND order_id = ?
     ORDER BY id
     FOR UPDATE`,
    [organizationId, branchId, orderId]
  );
  if (!bills.length) return null;

  // Dine-in may append after service; takeaway may append while ready for pickup.
  // In both cases the unpaid bill snapshot is refreshed after the new items are priced.
  const billCanBeRefreshed =
    (orderType === 'DINE_IN' && orderStatus === 'SERVED') ||
    (orderType === 'TAKEAWAY' && orderStatus === 'READY');
  if (!billCanBeRefreshed) {
    throw new ConflictError('This order already has billing records and can no longer be amended', 'ORDER_BILL_EXISTS');
  }
  if (bills.length > 1 || bills.some((bill) => bill.split_batch_id != null)) {
    throw new ConflictError('Items cannot be added after a bill has been split', 'ORDER_SPLIT_BILL_EXISTS');
  }

  const bill = bills[0];
  if (!['DRAFT', 'FINALIZED'].includes(String(bill.status))) {
    throw new ConflictError('This bill is no longer available for order changes', 'ORDER_BILL_NOT_APPENDABLE');
  }
  if (Number(bill.amount_paid || 0) > EPSILON || Number(bill.credit_total || 0) > EPSILON) {
    throw new ConflictError('Payment or customer credit has already been recorded for this bill', 'ORDER_FINANCIAL_SETTLEMENT_EXISTS');
  }

  const [payments] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM payments
     WHERE organization_id = ? AND branch_id = ? AND bill_id = ? AND status = 'CAPTURED'
     LIMIT 1 FOR UPDATE`,
    [organizationId, branchId, bill.id]
  );
  if (payments.length) {
    throw new ConflictError('Payment has already been recorded for this bill', 'ORDER_FINANCIAL_SETTLEMENT_EXISTS');
  }

  const [receivables] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM customer_receivables
     WHERE organization_id = ? AND branch_id = ? AND bill_id = ?
     LIMIT 1 FOR UPDATE`,
    [organizationId, branchId, bill.id]
  );
  if (receivables.length) {
    throw new ConflictError('Customer credit has already been recorded for this bill', 'ORDER_FINANCIAL_SETTLEMENT_EXISTS');
  }

  return Number(bill.id);
}

function orderVatProfile(row: RowDataPacket): VatProfileInput {
  return {
    isVatRegistered: Boolean(row.vat_registered_snapshot),
    vatRate: Number(row.vat_rate_snapshot || 0),
    roundingMethod: String(row.rounding_method_snapshot || 'HALF_EVEN') as RoundingMethod,
  };
}

export async function recalcOrder(conn: PoolConnection, organizationId: number, branchId: number, orderId: number) {
  const order = await lockOrder(conn, organizationId, branchId, orderId);
  if (Math.abs(Number(order.discount || 0)) > 0.0001 || Math.abs(Number(order.membership_discount || 0)) > 0.0001 || Math.abs(Number(order.manual_discount || 0)) > 0.0001) {
    throw new ConflictError('Add/move items is currently blocked on discounted or membership-discounted orders to preserve financial snapshots', 'ORDER_AMENDMENT_DISCOUNT_UNSUPPORTED');
  }
  const [items] = await conn.execute<RowDataPacket[]>(
    `SELECT oi.*
       FROM order_items oi
       JOIN order_rounds r ON r.id = oi.order_round_id
      WHERE oi.order_id = ? AND r.status = 'ACTIVE'
      ORDER BY oi.id FOR UPDATE`,
    [orderId],
  );
  if (!items.length) throw new ConflictError('An active order must keep at least one item', 'ORDER_ITEMS_REQUIRED');

  const pricing = calculateOrderPricing(
    items.map((item) => ({ key: Number(item.id), customerPrice: Number(item.line_subtotal || 0) })),
    0,
    orderVatProfile(order),
  );
  for (const line of pricing.lines) {
    await conn.execute(
      `UPDATE order_items SET discount_amount_snapshot = 0, taxable_amount = ?, tax_amount = ?, line_total = ?, updated_at = NOW() WHERE id = ?`,
      [line.taxableAmount, line.vatAmount, line.lineTotal, line.key],
    );
  }
  await conn.execute(
    `UPDATE orders SET subtotal = ?, discount = 0, membership_discount = 0, manual_discount = 0, taxable_amount = ?, tax = ?, rounding_delta = ?, grand_total = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?`,
    [pricing.subtotal, pricing.taxableAmount, pricing.vatAmount, pricing.roundingDelta, pricing.grandTotal, orderId, organizationId, branchId],
  );
}

export async function refreshPendingBill(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  orderId: number,
  billId: number,
) {
  const order = await lockOrder(conn, organizationId, branchId, orderId);
  const [items] = await conn.execute<RowDataPacket[]>(
    `SELECT oi.*
       FROM order_items oi
       JOIN order_rounds r ON r.id = oi.order_round_id
      WHERE oi.order_id = ? AND r.status = 'ACTIVE'
      ORDER BY oi.id FOR UPDATE`,
    [orderId],
  );
  const [billUpdate] = await conn.execute<ResultSetHeader>(
    `UPDATE bills
     SET subtotal = ?, discount_total = 0, discount_type = 'NONE', discount_value = 0, discount_reason = NULL,
         taxable_amount = ?, tax_total = ?, vat_registered_snapshot = ?, tax_registration_number_snapshot = ?,
         vat_rate_snapshot = ?, rounding_method_snapshot = ?, rounding_delta = ?, grand_total = ?,
         balance_due = ?, updated_at = NOW()
     WHERE id = ? AND organization_id = ? AND branch_id = ? AND order_id = ?
       AND status IN ('DRAFT','FINALIZED') AND amount_paid = 0 AND credit_total = 0`,
    [
      Number(order.subtotal || 0), Number(order.taxable_amount || 0), Number(order.tax || 0), Boolean(order.vat_registered_snapshot),
      order.tax_registration_number_snapshot ?? null, Number(order.vat_rate_snapshot || 0), String(order.rounding_method_snapshot || 'HALF_EVEN'),
      Number(order.rounding_delta || 0), Number(order.grand_total || 0), Number(order.grand_total || 0),
      billId, organizationId, branchId, orderId,
    ]
  );
  if (billUpdate.affectedRows !== 1) {
    throw new ConflictError('The bill changed while the order was being amended', 'ORDER_BILL_CHANGED');
  }

  await conn.execute(
    `DELETE bl
       FROM bill_lines bl
       JOIN order_items oi ON oi.id = bl.order_item_id
       JOIN order_rounds r ON r.id = oi.order_round_id
      WHERE bl.bill_id = ? AND bl.organization_id = ? AND bl.branch_id = ?
        AND r.status = 'CANCELLED'`,
    [billId, organizationId, branchId],
  );

  for (const item of items) {
    const modifierSnapshot = item.modifier_snapshot_json
      ? (typeof item.modifier_snapshot_json === 'string' ? JSON.parse(item.modifier_snapshot_json) : item.modifier_snapshot_json)
      : [];
    const lineSubtotal = Number(item.line_subtotal || 0);
    const discountAmount = Number(item.discount_amount_snapshot || 0);
    const taxAmount = Number(item.tax_amount || 0);
    const lineTotal = Number(item.line_total || 0);

    const [lineUpdate] = await conn.execute<ResultSetHeader>(
      `UPDATE bill_lines
       SET menu_item_id = ?, item_name_snapshot = ?, variant_name_snapshot = ?, modifier_snapshot_json = CAST(? AS JSON),
           quantity = ?, unit_price = ?, line_subtotal = ?, discount_amount = ?, taxable_amount = ?, tax_amount = ?,
           line_total = ?, notes = ?
       WHERE bill_id = ? AND organization_id = ? AND branch_id = ? AND order_item_id = ?`,
      [
        item.menu_item_id, item.item_name_snapshot, item.variant_name_snapshot, JSON.stringify(modifierSnapshot),
        Number(item.quantity), Number(item.unit_price), lineSubtotal, discountAmount, Number(item.taxable_amount || 0),
        taxAmount, lineTotal, item.notes, billId, organizationId, branchId, item.id,
      ]
    );
    if (lineUpdate.affectedRows === 0) {
      await conn.execute(
        `INSERT INTO bill_lines
          (bill_id, organization_id, branch_id, order_item_id, menu_item_id, item_name_snapshot, variant_name_snapshot,
           modifier_snapshot_json, quantity, unit_price, line_subtotal, discount_amount, taxable_amount, tax_amount,
           line_total, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billId, organizationId, branchId, item.id, item.menu_item_id, item.item_name_snapshot, item.variant_name_snapshot,
          JSON.stringify(modifierSnapshot), Number(item.quantity), Number(item.unit_price), lineSubtotal, discountAmount,
          Number(item.taxable_amount || 0), taxAmount, lineTotal, item.notes,
        ]
      );
    }
  }

  // Keep reporting snapshots complete for newly-added bill lines.
  await conn.execute(
    `UPDATE bill_lines bl
     LEFT JOIN menu_items mi ON mi.id = bl.menu_item_id
     LEFT JOIN menu_categories mc ON mc.id = mi.category_id
     LEFT JOIN departments d ON d.id = mi.department_id
     SET bl.item_classification_snapshot = COALESCE(bl.item_classification_snapshot, mi.item_classification, 'OTHER'),
         bl.category_id_snapshot = COALESCE(bl.category_id_snapshot, mi.category_id),
         bl.category_name_snapshot = COALESCE(bl.category_name_snapshot, mc.name),
         bl.department_id_snapshot = COALESCE(bl.department_id_snapshot, mi.department_id),
         bl.department_name_snapshot = COALESCE(bl.department_name_snapshot, d.name)
     WHERE bl.bill_id = ? AND bl.organization_id = ? AND bl.branch_id = ?`,
    [billId, organizationId, branchId]
  );
}

async function prepareAddedItems(conn: PoolConnection, organizationId: number, branchId: number, rawItems: any[], order: RowDataPacket) {
  const vatProfile = orderVatProfile(order);
  const resolvedItems: any[] = [];
  const kotItems: any[] = [];
  for (const input of rawItems) {
    if (!Number.isInteger(Number(input.menuItemId)) || Number(input.menuItemId) <= 0 || !Number.isInteger(Number(input.quantity)) || Number(input.quantity) <= 0 || Number(input.quantity) > 1000) {
      throw new BadRequestError('Each added item needs a valid menu item and quantity', 'INVALID_ORDER_ITEM');
    }
    if (input.isComplimentary) throw new ConflictError('Complimentary additions must use the dedicated complimentary flow', 'COMPLIMENTARY_APPEND_UNSUPPORTED');
    const customization = await menuCustomizationRepository.resolveForOrder(conn, Number(input.menuItemId), organizationId, input.variantId == null ? null : Number(input.variantId), input.modifiers as ModifierSelectionInput[] | undefined);
    const [menuRows] = await conn.execute<RowDataPacket[]>('SELECT id, name, category_id, default_prep_station_id, prep_time_minutes, is_combo FROM menu_items WHERE id = ? AND organization_id = ? FOR UPDATE', [input.menuItemId, organizationId]);
    if (!menuRows.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
    const menu = menuRows[0];
    let prepStationId: number | null = null; let prepStationName: string | null = null;
    if (menu.default_prep_station_id != null) {
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT id, name FROM preparation_stations WHERE id = ? AND organization_id = ? AND branch_id = ? AND is_active = TRUE', [menu.default_prep_station_id, organizationId, branchId]);
      if (rows.length) { prepStationId = Number(rows[0].id); prepStationName = String(rows[0].name); }
    }
    if (prepStationId == null) {
      const [rows] = await conn.execute<RowDataPacket[]>(`SELECT ps.id, ps.name FROM menu_categories mc LEFT JOIN preparation_stations ps ON ps.id = mc.station_id WHERE mc.id = ? AND mc.organization_id = ? AND (ps.branch_id = ? OR ps.id IS NULL) LIMIT 1`, [menu.category_id, organizationId, branchId]);
      if (rows.length && rows[0].id != null) { prepStationId = Number(rows[0].id); prepStationName = String(rows[0].name); }
    }
    const enteredUnitPrice = addMoney(customization.enteredPrice, customization.modifierTotal);
    const unitPrice = calculateMenuPrice(enteredUnitPrice, customization.priceEntryMode, vatProfile).customerPrice;
    if (input.expectedUnitPrice !== undefined && Math.abs(unitPrice - Number(input.expectedUnitPrice)) > 0.0001) throw new ConflictError(`Price changed for ${menu.name}`, 'OFFLINE_PRICE_CHANGED');
    const lineSubtotal = multiplyMoney(unitPrice, Number(input.quantity));
    resolvedItems.push({ menuItemId: Number(menu.id), itemNameSnapshot: String(menu.name), unitPrice, enteredUnitPrice, priceEntryMode: customization.priceEntryMode, quantity: Number(input.quantity), lineSubtotal, lineTotal: lineSubtotal, notes: input.notes || null, variantId: customization.variantId, variantNameSnapshot: customization.variantName, baseUnitPriceSnapshot: customization.enteredPrice, modifierTotal: customization.modifierTotal, modifierSnapshot: customization.modifierSnapshot, taxRateSnapshot: vatProfile.isVatRegistered ? Number(vatProfile.vatRate) : 0 });
    if (Boolean(menu.is_combo)) {
      kotItems.push(...await buildComboKotItems(
        conn,
        organizationId,
        branchId,
        Number(menu.id),
        String(menu.name),
        Number(input.quantity),
        input.notes || null,
      ));
    } else {
      kotItems.push({ menuItemId: Number(menu.id), itemNameSnapshot: String(menu.name), variantNameSnapshot: customization.variantName, modifierSummary: customization.modifierSnapshot.map((m: any) => `${m.optionName}${m.quantity > 1 ? ` x${m.quantity}` : ''}`).join(', ') || null, quantity: Number(input.quantity), notes: input.notes || undefined, prepStationId, prepStationName, prepTimeMinutesSnapshot: menu.prep_time_minutes == null ? null : Number(menu.prep_time_minutes) });
    }
  }
  return { resolvedItems, kotItems };
}

export async function appendOrderItems(req: Request, res: Response, next: NextFunction) {
  const conn = await getDatabasePool().getConnection();
  try {
    const { organizationId, branchId, userId } = assertAuth(req); const orderId = parseOrderId(req);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length || items.length > 50) throw new BadRequestError('Add between 1 and 50 items', 'INVALID_APPEND_ITEMS');
    const idempotencyKey = parseIdempotencyKey(req);
    const requestHash = idempotencyKey ? appendRequestHash(orderId, items) : null;

    await conn.beginTransaction();
    const order = await lockOrder(conn, organizationId, branchId, orderId);

    if (idempotencyKey && requestHash) {
      const [priorRequests] = await conn.execute<RowDataPacket[]>(
        `SELECT order_id, operation_type, request_hash FROM order_amendment_requests
         WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? FOR UPDATE`,
        [organizationId, branchId, idempotencyKey]
      );
      if (priorRequests.length) {
        const prior = priorRequests[0];
        if (Number(prior.order_id) !== orderId || String(prior.operation_type) !== 'APPEND_ITEMS' || String(prior.request_hash) !== requestHash) {
          throw new ConflictError('Idempotency key was already used for a different order amendment', 'IDEMPOTENCY_KEY_REUSED');
        }
        await conn.rollback();
        const replayed = await orderRepository.findById(orderId, organizationId, branchId);
        if (!replayed) throw new NotFoundError('Order not found after idempotent replay', 'ORDER_NOT_FOUND');
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(200).json({ success: true, data: replayed });
        return;
      }
    }

    const orderType = String(order.order_type);
    const orderStatus = String(order.order_status);
    if (!['DINE_IN', 'TAKEAWAY'].includes(orderType)) {
      throw new BadRequestError('This order type cannot be amended here', 'ORDER_TYPE_NOT_APPENDABLE');
    }
    if (orderType === 'DINE_IN') {
      if (order.dining_table_id == null) throw new BadRequestError('Dine-in order is missing its table', 'ORDER_NOT_TABLE_ASSOCIATED');
      await assertTableAccess(req, Number(order.dining_table_id));
    } else {
      if (order.dining_table_id != null) throw new ConflictError('Takeaway orders cannot be table-associated', 'TAKEAWAY_TABLE_ASSOCIATED');
      if (order.picked_up_at != null) throw new ConflictError('Items cannot be added after a takeaway order has been picked up', 'TAKEAWAY_ALREADY_PICKED_UP');
    }

    if (!canAppendOrderItems(orderType, orderStatus, order.picked_up_at != null)) {
      throw new ConflictError('Items can only be added while this order is active', 'ORDER_NOT_APPENDABLE');
    }
    if (order.payment_status !== 'UNPAID' || String(order.settlement_status || 'OPEN') !== 'OPEN') throw new ConflictError('Paid, partially paid, or credit-settled orders cannot be amended', 'ORDER_FINANCIAL_SETTLEMENT_EXISTS');
    const pendingBillId = await lockPendingBillForAppend(conn, organizationId, branchId, orderId, orderType, orderStatus);
    if (Math.abs(Number(order.discount || 0)) > 0.0001 || Math.abs(Number(order.membership_discount || 0)) > 0.0001 || Math.abs(Number(order.manual_discount || 0)) > 0.0001) throw new ConflictError('Adding items is currently blocked on discounted orders', 'ORDER_AMENDMENT_DISCOUNT_UNSUPPORTED');

    const prepared = await prepareAddedItems(conn, organizationId, branchId, items, order);
    const [roundNumberRows] = await conn.execute<RowDataPacket[]>(
      'SELECT COALESCE(MAX(round_number), 0) + 1 AS next_round FROM order_rounds WHERE order_id = ?',
      [orderId],
    );
    const roundNumber = Number(roundNumberRows[0]?.next_round || 1);
    const [roundResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO order_rounds
        (organization_id, branch_id, order_id, round_number, round_type, status,
         prior_order_status, prior_ready_at, prior_served_at, prior_served_by, created_by)
       VALUES (?, ?, ?, ?, 'ADDITION', 'ACTIVE', ?, ?, ?, ?, ?)`,
      [
        organizationId,
        branchId,
        orderId,
        roundNumber,
        orderStatus,
        order.ready_at ?? null,
        order.served_at ?? null,
        order.served_by ?? null,
        userId,
      ],
    );
    const orderRoundId = Number(roundResult.insertId);
    for (const item of prepared.resolvedItems) {
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO order_items (order_id, order_round_id, menu_item_id, item_name_snapshot, unit_price, entered_unit_price_snapshot, price_entry_mode_snapshot, quantity, line_subtotal, discount_amount_snapshot, taxable_amount, tax_rate_snapshot, tax_amount, line_total, variant_id, variant_name_snapshot, base_unit_price_snapshot, modifier_total, modifier_snapshot_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`, [orderId, orderRoundId, item.menuItemId, item.itemNameSnapshot, item.unitPrice, item.enteredUnitPrice, item.priceEntryMode, item.quantity, item.lineSubtotal, item.taxRateSnapshot, item.lineTotal, item.variantId, item.variantNameSnapshot, item.baseUnitPriceSnapshot, item.modifierTotal, JSON.stringify(item.modifierSnapshot), item.notes]);
      await recipeRepository.consumeOrderItemInTransaction(conn, organizationId, branchId, orderId, Number(result.insertId), item.menuItemId, item.quantity, item.variantId ?? null, item.modifierSnapshot ?? [], userId);
    }
    let tableLabel: string | null = null;
    if (orderType === 'DINE_IN') {
      const [tableRows] = await conn.execute<RowDataPacket[]>('SELECT table_number FROM dining_tables WHERE id = ? AND organization_id = ? AND branch_id = ?', [order.dining_table_id, organizationId, branchId]);
      tableLabel = tableRows.length ? String(tableRows[0].table_number) : `Table ${order.dining_table_id}`;
    }
    const [waiterRows] = order.waiter_id ? await conn.execute<RowDataPacket[]>('SELECT name FROM users WHERE id = ? AND organization_id = ?', [order.waiter_id, organizationId]) : [[] as RowDataPacket[], [] as any];
    const waiterName = Array.isArray(waiterRows) && waiterRows.length ? String((waiterRows as any)[0].name) : null;
    if (prepared.kotItems.length) await kitchenRepository.createKotWithItems(conn, organizationId, branchId, orderId, orderRoundId, String(order.order_number), orderType, tableLabel, waiterName, prepared.kotItems);
    await recalcOrder(conn, organizationId, branchId, orderId);
    if (pendingBillId != null) await refreshPendingBill(conn, organizationId, branchId, orderId, pendingBillId);
    if (orderStatus === 'READY' || (orderType === 'DINE_IN' && orderStatus === 'SERVED')) {
      await conn.execute(
        `UPDATE orders
         SET order_status = 'PREPARING', ready_at = NULL, served_at = NULL, served_by = NULL, updated_at = NOW()
         WHERE id = ? AND organization_id = ? AND branch_id = ?`,
        [orderId, organizationId, branchId]
      );
    }

    if (idempotencyKey && requestHash) {
      await conn.execute(
        `INSERT INTO order_amendment_requests
          (organization_id, branch_id, order_id, operation_type, idempotency_key, request_hash, created_by)
         VALUES (?, ?, ?, 'APPEND_ITEMS', ?, ?, ?)`,
        [organizationId, branchId, orderId, idempotencyKey, requestHash, userId]
      );
    }

    await conn.commit();
    const updated = await orderRepository.findById(orderId, organizationId, branchId);
    if (!updated) throw new NotFoundError('Order not found after adding items', 'ORDER_NOT_FOUND');
    realtimePublisher.publish({ type: 'order.items_added', organizationId, branchId, entityType: 'order', entityId: orderId, data: { orderId, diningTableId: updated.diningTableId, itemCount: items.length, orderStatus: updated.orderStatus } });
    const tickets = await kitchenRepository.findTicketsByOrder(orderId, organizationId, branchId); const latest = tickets[tickets.length - 1];
    if (latest) realtimePublisher.publish({ type: 'kot.created', organizationId, branchId, entityType: 'kot', entityId: latest.id, data: { orderId, ticketStatus: latest.ticketStatus, orderNumber: updated.orderNumber, diningTableId: updated.diningTableId } });
    realtimePublisher.publish({ type: 'inventory.stock_changed', organizationId, branchId, entityType: 'inventory_balance', entityId: orderId, data: { source: 'ORDER_ITEMS_ADDED', orderId } });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { await conn.rollback(); next(error); } finally { conn.release(); }
}

export async function moveOrderItems(req: Request, res: Response, next: NextFunction) {
  const conn = await getDatabasePool().getConnection();
  try {
    const { organizationId, branchId } = assertAuth(req); const sourceOrderId = parseOrderId(req);
    const targetOrderId = Number(req.body?.targetOrderId);
    const itemIds: number[] = Array.isArray(req.body?.itemIds)
      ? [...new Set<number>(req.body.itemIds.map((value: unknown) => Number(value)))]
      : [];
    if (!Number.isInteger(targetOrderId) || targetOrderId <= 0 || targetOrderId === sourceOrderId) throw new BadRequestError('Choose another occupied table order', 'INVALID_TARGET_ORDER');
    if (!itemIds.length || itemIds.some((id) => !Number.isInteger(id) || id <= 0)) throw new BadRequestError('Select at least one valid order item', 'INVALID_MOVE_ITEMS');
    await conn.beginTransaction();
    const [firstId, secondId] = sourceOrderId < targetOrderId ? [sourceOrderId, targetOrderId] : [targetOrderId, sourceOrderId];
    const first = await lockOrder(conn, organizationId, branchId, firstId); const second = await lockOrder(conn, organizationId, branchId, secondId);
    const source = Number(first.id) === sourceOrderId ? first : second; const target = Number(first.id) === targetOrderId ? first : second;
    if (source.dining_table_id != null && target.dining_table_id != null && Number(source.dining_table_id) === Number(target.dining_table_id)) {
      throw new BadRequestError('Choose an order from another table', 'MOVE_ITEMS_SAME_TABLE');
    }
    for (const order of [source, target]) {
      if (order.order_type !== 'DINE_IN' || order.dining_table_id == null) throw new BadRequestError('Move items only works between dine-in table orders', 'ORDER_NOT_TABLE_ASSOCIATED');
      if (!MOVEABLE_STATUSES.has(String(order.order_status))) throw new ConflictError('Move items is available only after kitchen work is ready/served', 'ORDER_ITEMS_NOT_MOVEABLE_YET');
      if (order.payment_status !== 'UNPAID') throw new ConflictError('Paid or partially paid orders cannot move items', 'ORDER_FINANCIAL_SETTLEMENT_EXISTS');
      if (Math.abs(Number(order.discount || 0)) > 0.0001 || Math.abs(Number(order.membership_discount || 0)) > 0.0001 || Math.abs(Number(order.manual_discount || 0)) > 0.0001) throw new ConflictError('Move items is currently blocked on discounted orders', 'ORDER_AMENDMENT_DISCOUNT_UNSUPPORTED');
      await assertTableAccess(req, Number(order.dining_table_id)); await assertNoBill(conn, organizationId, branchId, Number(order.id));
    }
    const placeholders = itemIds.map(() => '?').join(',');
    const [moving] = await conn.execute<RowDataPacket[]>(`SELECT oi.id, oi.is_complimentary FROM order_items oi JOIN order_rounds r ON r.id=oi.order_round_id WHERE oi.order_id = ? AND r.status='ACTIVE' AND oi.id IN (${placeholders}) FOR UPDATE`, [sourceOrderId, ...itemIds]);
    if (moving.length !== itemIds.length) throw new ConflictError('One or more selected items no longer belong to this order', 'ORDER_ITEMS_STALE');
    if (moving.some((row) => Boolean(row.is_complimentary))) throw new ConflictError('Complimentary items cannot currently be moved between orders', 'COMPLIMENTARY_MOVE_UNSUPPORTED');
    const [sourceCountRows] = await conn.execute<RowDataPacket[]>(`SELECT COUNT(*) item_count FROM order_items oi JOIN order_rounds r ON r.id=oi.order_round_id WHERE oi.order_id = ? AND r.status='ACTIVE' FOR UPDATE`, [sourceOrderId]);
    if (Number(sourceCountRows[0]?.item_count || 0) <= itemIds.length) throw new ConflictError('Move the whole order/table instead of moving every item', 'MOVE_ALL_ITEMS_USE_TRANSFER');
    const [targetRoundRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM order_rounds
        WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND status = 'ACTIVE'
        ORDER BY round_number DESC LIMIT 1 FOR UPDATE`,
      [targetOrderId, organizationId, branchId],
    );
    if (!targetRoundRows.length) throw new ConflictError('Destination order has no active round', 'ORDER_ROUND_NOT_FOUND');
    const targetRoundId = Number(targetRoundRows[0].id);
    await conn.execute(
      `UPDATE order_items
          SET origin_order_id = COALESCE(origin_order_id, order_id),
              order_id = ?, order_round_id = ?, updated_at = NOW()
        WHERE order_id = ? AND id IN (${placeholders})`,
      [targetOrderId, targetRoundId, sourceOrderId, ...itemIds],
    );
    await recalcOrder(conn, organizationId, branchId, sourceOrderId); await recalcOrder(conn, organizationId, branchId, targetOrderId);
    await conn.commit();
    const sourceUpdated = await orderRepository.findById(sourceOrderId, organizationId, branchId); const targetUpdated = await orderRepository.findById(targetOrderId, organizationId, branchId);
    realtimePublisher.publish({ type: 'order.items_moved', organizationId, branchId, entityType: 'order', entityId: sourceOrderId, data: { sourceOrderId, targetOrderId, itemIds, sourceTableId: source.dining_table_id, targetTableId: target.dining_table_id } });
    res.status(200).json({ success: true, data: { sourceOrder: sourceUpdated, targetOrder: targetUpdated } });
  } catch (error) { await conn.rollback(); next(error); } finally { conn.release(); }
}
