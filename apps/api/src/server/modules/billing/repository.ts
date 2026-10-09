import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { Bill, BillLine, BillSplitSummary, BillSplitMode, ItemSplitBillInput, Payment, OrderBillsResult } from './types';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { splitMoneyEvenly } from './splitting';

const EPSILON = 0.0001;
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

function splitSnapshot(value: number, count: number, index: number): number {
  const units = Math.round(value * 10000);
  const base = Math.floor(units / count);
  return (base + (index >= count - (units - base * count) ? 1 : 0)) / 10000;
}

function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }

async function snapshotReportingDimensions(conn: PoolConnection, organizationId: number, branchId: number, orderId: number): Promise<void> {
  await conn.execute(
    `UPDATE bill_lines bl
     JOIN bills b ON b.id = bl.bill_id
     LEFT JOIN menu_items mi ON mi.id = bl.menu_item_id
     LEFT JOIN menu_categories mc ON mc.id = mi.category_id
     LEFT JOIN departments d ON d.id = mi.department_id
     SET bl.item_classification_snapshot = COALESCE(bl.item_classification_snapshot, mi.item_classification, 'OTHER'),
         bl.category_id_snapshot = COALESCE(bl.category_id_snapshot, mi.category_id),
         bl.category_name_snapshot = COALESCE(bl.category_name_snapshot, mc.name),
         bl.department_id_snapshot = COALESCE(bl.department_id_snapshot, mi.department_id),
         bl.department_name_snapshot = COALESCE(bl.department_name_snapshot, d.name)
     WHERE b.organization_id = ? AND b.branch_id = ? AND b.order_id = ?
       AND (bl.item_classification_snapshot IS NULL OR bl.category_name_snapshot IS NULL OR bl.department_name_snapshot IS NULL)`,
    [organizationId, branchId, orderId]
  );
}

function mapBillLine(row: RowDataPacket): BillLine {
  return {
    id: Number(row.id), billId: Number(row.bill_id), orderItemId: row.order_item_id == null ? null : Number(row.order_item_id),
    menuItemId: row.menu_item_id == null ? null : Number(row.menu_item_id), itemNameSnapshot: String(row.item_name_snapshot),
    variantNameSnapshot: row.variant_name_snapshot == null ? null : String(row.variant_name_snapshot),
    modifierSnapshot: row.modifier_snapshot_json ? (typeof row.modifier_snapshot_json === 'string' ? JSON.parse(row.modifier_snapshot_json) : row.modifier_snapshot_json) : [],
    quantity: Number(row.quantity), unitPrice: Number(row.unit_price), lineSubtotal: Number(row.line_subtotal),
    discountAmount: Number(row.discount_amount), taxableAmount: Number(row.taxable_amount), taxAmount: Number(row.tax_amount),
    lineTotal: Number(row.line_total), notes: row.notes == null ? null : String(row.notes),
  };
}

function mapPayment(row: RowDataPacket): Payment {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), businessDayId: row.business_day_id == null ? null : Number(row.business_day_id), shiftId: row.shift_id == null ? null : Number(row.shift_id), registerId: row.register_id == null ? null : Number(row.register_id), billId: Number(row.bill_id),
    paymentMethodId: Number(row.payment_method_id), amount: Number(row.amount), tenderAmount: row.tender_amount == null ? null : Number(row.tender_amount),
    changeAmount: Number(row.change_amount), businessDate: String(row.business_date), status: row.status, externalReference: row.external_reference == null ? null : String(row.external_reference),
    notes: row.notes == null ? null : String(row.notes), idempotencyKey: String(row.idempotency_key), createdBy: Number(row.created_by), createdAt: iso(row.created_at),
    reversedAt: row.reversed_at == null ? null : iso(row.reversed_at), reversedBy: row.reversed_by == null ? null : Number(row.reversed_by), reversalReason: row.reversal_reason == null ? null : String(row.reversal_reason),
  };
}

async function mapBill(connOrPool: PoolConnection | ReturnType<typeof getDatabasePool>, row: RowDataPacket): Promise<Bill> {
  const [lines] = await connOrPool.execute<RowDataPacket[]>('SELECT * FROM bill_lines WHERE bill_id = ? AND organization_id = ? AND branch_id = ? ORDER BY id', [row.id, row.organization_id, row.branch_id]);
  let sourceItems: Bill['sourceItems'] = undefined;
  if (row.split_mode === 'EVEN') {
    const [items] = await connOrPool.execute<RowDataPacket[]>(
      `SELECT oi.id, oi.item_name_snapshot, oi.quantity, oi.unit_price, oi.line_total,
              oi.variant_name_snapshot, oi.modifier_snapshot_json, oi.notes
         FROM order_items oi
         JOIN order_rounds r ON r.id=oi.order_round_id
        WHERE oi.order_id=? AND r.status='ACTIVE'
        ORDER BY oi.id`, [row.order_id]
    );
    sourceItems = items.map((item) => ({
      id: Number(item.id), itemNameSnapshot: String(item.item_name_snapshot), quantity: Number(item.quantity), unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total), variantNameSnapshot: item.variant_name_snapshot == null ? null : String(item.variant_name_snapshot),
      modifierSnapshot: item.modifier_snapshot_json ? (typeof item.modifier_snapshot_json === 'string' ? JSON.parse(item.modifier_snapshot_json) : item.modifier_snapshot_json) : [],
      notes: item.notes == null ? null : String(item.notes),
    }));
  }
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), businessDayId: row.business_day_id == null ? null : Number(row.business_day_id), shiftId: row.shift_id == null ? null : Number(row.shift_id), registerId: row.register_id == null ? null : Number(row.register_id), orderId: Number(row.order_id), billNumber: String(row.bill_number),
    businessDate: String(row.business_date), status: row.status, currency: String(row.currency), subtotal: Number(row.subtotal), discountTotal: Number(row.discount_total),
    taxableAmount: Number(row.taxable_amount), taxTotal: Number(row.tax_total),
    vatRegisteredSnapshot: Boolean(row.vat_registered_snapshot),
    taxRegistrationNumberSnapshot: row.tax_registration_number_snapshot == null ? null : String(row.tax_registration_number_snapshot),
    vatRateSnapshot: Number(row.vat_rate_snapshot || 0), roundingMethodSnapshot: row.rounding_method_snapshot,
    roundingDelta: Number(row.rounding_delta),
    grandTotal: Number(row.grand_total), amountPaid: Number(row.amount_paid), balanceDue: Number(row.balance_due),
    splitBatchId: row.split_batch_id == null ? null : Number(row.split_batch_id), splitSequence: row.split_sequence == null ? null : Number(row.split_sequence),
    splitMode: row.split_mode == null ? null : row.split_mode, splitTotalCount: row.split_batch_id == null ? null : Number(row.split_total_count || 0), sourceItems,
    finalizedAt: row.finalized_at == null ? null : iso(row.finalized_at), finalizedBy: row.finalized_by == null ? null : Number(row.finalized_by),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), lines: lines.map(mapBillLine),
  };
}

function assertOrderCanSplit(order: RowDataPacket): void {
  if (order.order_type !== 'DINE_IN' && order.order_type !== 'TAKEAWAY') throw new ConflictError('This order type cannot be split', 'ORDER_NOT_SPLITTABLE');
  if (order.order_status === 'CANCELLED' || order.order_status === 'COMPLETED' || order.order_status === 'MERGED') throw new ConflictError('Closed orders cannot be split', 'ORDER_NOT_SPLITTABLE');
  if (order.payment_status === 'PAID') throw new ConflictError('Settled orders cannot be split', 'ORDER_ALREADY_SETTLED');
  if (order.order_type === 'DINE_IN' && order.order_status !== 'SERVED') throw new ConflictError('Dine-in orders must be served before billing', 'ORDER_NOT_READY_FOR_BILLING');
  if (order.order_type === 'TAKEAWAY' && !['READY', 'SERVED'].includes(String(order.order_status))) throw new ConflictError('Takeaway orders must be ready before billing', 'ORDER_NOT_READY_FOR_BILLING');
}

function proportionalAllocation(total: number, consumed: number, requestedBase: number, remainingBase: number): number {
  const remaining = round4(total - consumed);
  if (Math.abs(remaining) <= EPSILON) return 0;
  if (remainingBase <= EPSILON || requestedBase >= remainingBase - EPSILON) return remaining;
  return round4(remaining * (requestedBase / remainingBase));
}

export class BillingRepository {
  pool() { return getDatabasePool(); }

  async findBillByOrder(orderId: number, organizationId: number, branchId: number, conn: PoolConnection | null = null): Promise<Bill | null> {
    const db = conn || this.pool();
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ? ORDER BY id ASC LIMIT 1', [orderId, organizationId, branchId]
    );
    return rows.length ? mapBill(db, rows[0]) : null;
  }

  async findBillsByOrder(orderId: number, organizationId: number, branchId: number, conn: PoolConnection | null = null): Promise<Bill[]> {
    const db = conn || this.pool();
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ? ORDER BY split_sequence IS NULL DESC, split_sequence ASC, id ASC', [orderId, organizationId, branchId]
    );
    return Promise.all(rows.map((row) => mapBill(db, row)));
  }

  async getOrderBills(orderId: number, organizationId: number, branchId: number): Promise<OrderBillsResult> {
    const [orders] = await this.pool().execute<RowDataPacket[]>(
      'SELECT id, order_number, order_type, order_status, payment_status, grand_total FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ?', [orderId, organizationId, branchId]
    );
    if (!orders.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const order = orders[0];
    const bills = await this.findBillsByOrder(orderId, organizationId, branchId);
    let split: BillSplitSummary | null = null;
    const [batchRows] = await this.pool().execute<RowDataPacket[]>(
      'SELECT b.*, COUNT(bill.id) AS bill_count, COALESCE(SUM(CASE WHEN bill.status <> \'CANCELLED\' THEN bill.grand_total ELSE 0 END),0) AS allocated_amount FROM bill_split_batches b LEFT JOIN bills bill ON bill.split_batch_id = b.id AND bill.organization_id = b.organization_id AND bill.branch_id = b.branch_id WHERE b.id = (SELECT split_batch_id FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND split_batch_id IS NOT NULL ORDER BY id LIMIT 1) GROUP BY b.id',
      [orderId, organizationId, branchId]
    );
    if (batchRows.length) {
      const b = batchRows[0];
      split = {
        id: Number(b.id), orderId: Number(b.order_id), splitMode: b.split_mode, status: b.status,
        sourceSubtotal: Number(b.source_subtotal), sourceDiscount: Number(b.source_discount), sourceTaxableAmount: Number(b.source_taxable_amount), sourceTax: Number(b.source_tax),
        sourceRoundingDelta: Number(b.source_rounding_delta), sourceGrandTotal: Number(b.source_grand_total),
        billCount: Number(b.bill_count || 0), allocatedAmount: Number(b.allocated_amount || 0), remainingAmount: Math.max(0, round4(Number(b.source_grand_total) - Number(b.allocated_amount || 0))),
      };
    }
    return { order: { id: Number(order.id), orderNumber: String(order.order_number), orderType: String(order.order_type), orderStatus: String(order.order_status), paymentStatus: String(order.payment_status), grandTotal: Number(order.grand_total) }, split, bills };
  }

  async findBillById(id: number, organizationId: number, branchId: number): Promise<Bill | null> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ?', [id, organizationId, branchId]);
    return rows.length ? mapBill(this.pool(), rows[0]) : null;
  }

  async createFinalizedBill(data: {
    organizationId: number; branchId: number; businessDayId: number; shiftId: number; registerId: number; orderId: number; billNumber: string; businessDate: string; currency: string;
    subtotal: number; discountTotal: number; taxableAmount: number; taxTotal: number; vatRegisteredSnapshot: boolean; taxRegistrationNumberSnapshot: string | null; vatRateSnapshot: number; roundingMethodSnapshot: Bill['roundingMethodSnapshot']; roundingDelta: number; grandTotal: number; finalizedBy: number;
    lines: Omit<BillLine, 'id' | 'billId'>[];
  }): Promise<Bill> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [shiftRows] = await conn.execute<RowDataPacket[]>('SELECT id, status, business_day_id, register_id FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [data.shiftId, data.organizationId, data.branchId]);
      if (!shiftRows.length || shiftRows[0].status !== 'OPEN' || Number(shiftRows[0].business_day_id) !== data.businessDayId || Number(shiftRows[0].register_id) !== data.registerId) throw new ConflictError('The cashier shift is not available for this bill', 'SHIFT_NOT_OPEN');
      const [orderRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [data.orderId, data.organizationId, data.branchId]);
      if (!orderRows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      assertOrderCanSplit(orderRows[0]);
      if (orderRows[0].payment_status !== 'UNPAID') throw new ConflictError('Only unpaid orders can receive a new bill', 'ORDER_NOT_BILLABLE');
      const [existing] = await conn.execute<RowDataPacket[]>('SELECT id FROM bills WHERE organization_id = ? AND branch_id = ? AND order_id = ? FOR UPDATE', [data.organizationId, data.branchId, data.orderId]);
      if (existing.length) throw new ConflictError('A bill already exists for this order; use the split-bill workflow', 'BILL_ALREADY_EXISTS');
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO bills (organization_id, branch_id, business_day_id, shift_id, register_id, order_id, bill_number, business_date, status, currency, subtotal, discount_total, taxable_amount, tax_total, vat_registered_snapshot, tax_registration_number_snapshot, vat_rate_snapshot, rounding_method_snapshot, rounding_delta, grand_total, amount_paid, balance_due, finalized_at, finalized_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), ?)`,
        [data.organizationId, data.branchId, data.businessDayId, data.shiftId, data.registerId, data.orderId, data.billNumber, data.businessDate, data.currency, data.subtotal, data.discountTotal, data.taxableAmount, data.taxTotal, data.vatRegisteredSnapshot, data.taxRegistrationNumberSnapshot, data.vatRateSnapshot, data.roundingMethodSnapshot, data.roundingDelta, data.grandTotal, data.grandTotal, data.finalizedBy]
      );
      const billId = Number(result.insertId);
      for (const line of data.lines) {
        await conn.execute(
          `INSERT INTO bill_lines (bill_id, organization_id, branch_id, order_item_id, menu_item_id, item_name_snapshot, variant_name_snapshot, modifier_snapshot_json, quantity, unit_price, line_subtotal, discount_amount, taxable_amount, tax_amount, line_total, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [billId, data.organizationId, data.branchId, line.orderItemId, line.menuItemId, line.itemNameSnapshot, line.variantNameSnapshot, JSON.stringify(line.modifierSnapshot), line.quantity, line.unitPrice, line.lineSubtotal, line.discountAmount, line.taxableAmount, line.taxAmount, line.lineTotal, line.notes]
        );
      }
      await snapshotReportingDimensions(conn, data.organizationId, data.branchId, data.orderId);
      await conn.commit();
      const created = await this.findBillById(billId, data.organizationId, data.branchId);
      if (!created) throw new NotFoundError('Bill not found after creation', 'BILL_NOT_FOUND');
      return created;
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async splitOrder(data: {
    organizationId: number; branchId: number; orderId: number; performedBy: number; mode: BillSplitMode; bills?: ItemSplitBillInput[]; billCount?: number;
    billPrefix: string; businessDate: string; businessDayId: number; shiftId: number; registerId: number;
    idempotency?: { key: string; hash: string };
  }): Promise<OrderBillsResult> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [shiftRows] = await conn.execute<RowDataPacket[]>('SELECT id, status, business_day_id, register_id FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [data.shiftId, data.organizationId, data.branchId]);
      if (!shiftRows.length || shiftRows[0].status !== 'OPEN' || Number(shiftRows[0].business_day_id) !== data.businessDayId || Number(shiftRows[0].register_id) !== data.registerId) throw new ConflictError('The cashier shift is not available for bill splitting', 'SHIFT_NOT_OPEN');
      const [orderRows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE`, [data.orderId, data.organizationId, data.branchId]
      );
      if (!orderRows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
      const order = orderRows[0];
      if (data.idempotency) {
        const replay = await this.findSplitReplay(data.organizationId, data.branchId, data.orderId, data.idempotency, conn);
        if (replay) { await conn.rollback(); return this.getOrderBills(data.orderId, data.organizationId, data.branchId); }
      }
      assertOrderCanSplit(order);

      const [itemRows] = await conn.execute<RowDataPacket[]>(
        `SELECT oi.*
           FROM order_items oi
           JOIN order_rounds r ON r.id=oi.order_round_id
          WHERE oi.order_id=? AND r.status='ACTIVE'
          ORDER BY oi.id FOR UPDATE`, [data.orderId]
      );
      if (!itemRows.length) throw new ConflictError('Order has no items', 'ORDER_HAS_NO_ITEMS');

      const [batchRows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM bill_split_batches WHERE order_id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE`, [data.orderId, data.organizationId, data.branchId]
      );
      let batch = batchRows[0] || null;
      if (batch && String(batch.split_mode) !== data.mode) throw new ConflictError(`Order already has an ${batch.split_mode} split`, 'ORDER_SPLIT_MODE_LOCKED');
      if (data.mode === 'EVEN' && batch) throw new ConflictError('An even split has already been created for this order', 'ORDER_ALREADY_SPLIT');

      const [existingBillRows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ? ORDER BY split_sequence ASC, id ASC FOR UPDATE`, [data.orderId, data.organizationId, data.branchId]
      );
      if (!batch && existingBillRows.length) throw new ConflictError('Order already has a bill; settled/finalized bills cannot be re-split', 'ORDER_BILL_EXISTS');
      if (batch && batch.status === 'COMPLETED') throw new ConflictError('This split batch is already fully allocated and cannot be modified', 'SPLIT_ALREADY_COMPLETED');
      if (batch && existingBillRows.some((bill) => bill.status !== 'FINALIZED')) throw new ConflictError('Split batch contains a non-finalized bill', 'SPLIT_BATCH_INVALID');

      if (!batch) {
        const [result] = await conn.execute<ResultSetHeader>(
          `INSERT INTO bill_split_batches (organization_id, branch_id, order_id, split_mode, status, source_currency, source_subtotal, source_discount, source_taxable_amount, source_tax, source_rounding_delta, source_grand_total, created_by)
           VALUES (?, ?, ?, ?, 'ACTIVE', 'NPR', ?, ?, ?, ?, ?, ?, ?)`,
          [data.organizationId, data.branchId, data.orderId, data.mode, order.subtotal, order.discount, order.taxable_amount, order.tax, order.rounding_delta || 0, order.grand_total, data.performedBy]
        );
        const [createdBatch] = await conn.execute<RowDataPacket[]>(`SELECT * FROM bill_split_batches WHERE id = ? FOR UPDATE`, [Number(result.insertId)]);
        batch = createdBatch[0];
      }

      const itemMap = new Map<number, RowDataPacket>(itemRows.map((row) => [Number(row.id), row]));
      const consumedByItem = new Map<number, number>();
      if (data.mode === 'ITEM') {
        if (!data.bills?.length) throw new ConflictError('At least two item-allocation bills are required', 'INVALID_SPLIT_REQUEST');
        const allocationByItem = new Map<number, number>();
        for (const bill of data.bills) {
          const seen = new Set<number>();
          for (const allocation of bill.allocations) {
            if (seen.has(allocation.orderItemId)) throw new ConflictError('An order item may appear only once within a sub-bill', 'DUPLICATE_ITEM_ALLOCATION');
            seen.add(allocation.orderItemId);
            if (allocation.quantity <= 0) throw new ConflictError('Allocation quantity must be positive', 'INVALID_ALLOCATION_QUANTITY');
            allocationByItem.set(allocation.orderItemId, round4((allocationByItem.get(allocation.orderItemId) || 0) + allocation.quantity));
          }
        }

        for (const [itemId, item] of itemMap) {
          const [rows] = await conn.execute<RowDataPacket[]>(
            `SELECT COALESCE(SUM(quantity),0) AS quantity, COALESCE(SUM(discount_amount),0) AS discount_amount, COALESCE(SUM(taxable_amount),0) AS taxable_amount, COALESCE(SUM(tax_amount),0) AS tax_amount, COALESCE(SUM(line_subtotal),0) AS line_subtotal, COALESCE(SUM(line_total),0) AS line_total
             FROM bill_lines WHERE organization_id = ? AND branch_id = ? AND order_item_id = ? AND bill_id IN (SELECT id FROM bills WHERE split_batch_id = ?)`,
            [data.organizationId, data.branchId, itemId, batch.id]
          );
          consumedByItem.set(itemId, Number(rows[0]?.quantity || 0));
        }

        for (const [itemId, requested] of allocationByItem) {
          const item = itemMap.get(itemId);
          if (!item) throw new NotFoundError(`Order item #${itemId} does not belong to this order`, 'ORDER_ITEM_NOT_FOUND');
          const remainingQty = round4(Number(item.quantity) - Number(consumedByItem.get(itemId) || 0));
          if (requested > remainingQty + EPSILON) throw new ConflictError(`Allocation exceeds remaining quantity for item #${itemId}`, 'ITEM_ALLOCATION_EXCEEDS_REMAINING', { orderItemId: itemId, remainingQuantity: remainingQty, requestedQuantity: requested });
        }

        let sequence = Number(existingBillRows.reduce((max, row) => Math.max(max, Number(row.split_sequence || 0)), 0));
        const billCountAfter = existingBillRows.length + data.bills.length;
        let newRawGrandTotal = 0;
        let newRoundingTotal = 0;
        for (let billIndex = 0; billIndex < data.bills.length; billIndex += 1) {
          const billInput = data.bills[billIndex];
          const allocationMap = new Map<number, number>();
          for (const allocation of billInput.allocations) allocationMap.set(allocation.orderItemId, round4((allocationMap.get(allocation.orderItemId) || 0) + allocation.quantity));
          sequence += 1;
          const components = { subtotal: 0, discount: 0, taxable: 0, tax: 0, rawGrand: 0 };
          const lines: Array<Omit<BillLine, 'id' | 'billId'>> = [];

          const sourceDiscountTotal = Number(batch.source_discount);
          const storedDiscountTotal = itemRows.reduce((s, i) => s + Number(i.discount_amount_snapshot || 0), 0);
          for (const [itemId, quantity] of allocationMap) {
            const item = itemMap.get(itemId)!;
            const alreadyQty = Number(consumedByItem.get(itemId) || 0);
            const remainingQty = Math.max(0, Number(item.quantity) - alreadyQty);
            const lineSubtotal = round4(Number(item.unit_price) * quantity);
            const fullDiscount = storedDiscountTotal > EPSILON ? Number(item.discount_amount_snapshot || 0) : (Number(item.line_subtotal) / Math.max(Number(order.subtotal), EPSILON)) * sourceDiscountTotal;
            const [priorRows] = await conn.execute<RowDataPacket[]>(
              `SELECT COALESCE(SUM(discount_amount),0) AS discount_amount, COALESCE(SUM(taxable_amount),0) AS taxable_amount, COALESCE(SUM(tax_amount),0) AS tax_amount, COALESCE(SUM(line_subtotal),0) AS line_subtotal, COALESCE(SUM(line_total),0) AS line_total
               FROM bill_lines WHERE order_item_id = ? AND bill_id IN (SELECT id FROM bills WHERE split_batch_id = ?)`, [itemId, batch.id]
            );
            const prior = priorRows[0];
            const discount = proportionalAllocation(fullDiscount, Number(prior.discount_amount || 0), Math.min(quantity, remainingQty), remainingQty || quantity);
            const taxable = proportionalAllocation(Number(item.taxable_amount || 0), Number(prior.taxable_amount || 0), Math.min(quantity, remainingQty), remainingQty || quantity);
            const tax = proportionalAllocation(Number(item.tax_amount || 0), Number(prior.tax_amount || 0), Math.min(quantity, remainingQty), remainingQty || quantity);
            const lineTotal = proportionalAllocation(Number(item.line_total || 0), Number(prior.line_total || 0), Math.min(quantity, remainingQty), remainingQty || quantity);
            components.subtotal = round4(components.subtotal + lineSubtotal); components.discount = round4(components.discount + discount);
            components.taxable = round4(components.taxable + taxable); components.tax = round4(components.tax + tax);
            components.rawGrand = round4(components.rawGrand + lineTotal);
            lines.push({ orderItemId: itemId, menuItemId: Number(item.menu_item_id), itemNameSnapshot: String(item.item_name_snapshot), variantNameSnapshot: item.variant_name_snapshot == null ? null : String(item.variant_name_snapshot), modifierSnapshot: item.modifier_snapshot_json ? (typeof item.modifier_snapshot_json === 'string' ? JSON.parse(item.modifier_snapshot_json) : item.modifier_snapshot_json) : [], quantity, unitPrice: Number(item.unit_price), lineSubtotal, discountAmount: discount, taxableAmount: taxable, taxAmount: tax, lineTotal, notes: item.notes == null ? null : String(item.notes) });
          }

          const sourceRawGrand = round4(Number(batch.source_grand_total) - Number(batch.source_rounding_delta));
          const existingRawGrand = existingBillRows.reduce((sum, b) => {
            const raw = Number(b.grand_total) - Number(b.rounding_delta);
            return sum + raw;
          }, 0) + newRawGrandTotal;
          const remainingRaw = Math.max(0, round4(sourceRawGrand - existingRawGrand - components.rawGrand));
          const sourceRounding = Number(batch.source_rounding_delta || 0);
          const existingRounding = existingBillRows.reduce((sum, b) => sum + Number(b.rounding_delta || 0), 0) + newRoundingTotal;
          const availableRounding = round4(sourceRounding - existingRounding);
          const rawBeforeCurrent = round4(sourceRawGrand - existingRawGrand);
          const rounding = availableRounding === 0
            ? 0
            : (remainingRaw <= EPSILON ? availableRounding : round4(availableRounding * (components.rawGrand / Math.max(rawBeforeCurrent, components.rawGrand))));
          const grandTotal = round4(components.rawGrand + rounding);

          const billNumber = `${String(order.order_number)}-${sequence}`;
          await conn.execute(
            `INSERT INTO bills (organization_id, branch_id, business_day_id, shift_id, register_id, order_id, bill_number, business_date, status, currency, subtotal, discount_total, taxable_amount, tax_total, vat_registered_snapshot, tax_registration_number_snapshot, vat_rate_snapshot, rounding_method_snapshot, rounding_delta, grand_total, amount_paid, balance_due, finalized_at, finalized_by, split_batch_id, split_sequence, split_mode, split_total_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED', 'NPR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), ?, ?, ?, 'ITEM', ?)`,
            [data.organizationId, data.branchId, data.businessDayId, data.shiftId, data.registerId, data.orderId, billNumber, data.businessDate, components.subtotal, components.discount, components.taxable, components.tax, order.vat_registered_snapshot, order.tax_registration_number_snapshot, order.vat_rate_snapshot, order.rounding_method_snapshot, rounding, grandTotal, grandTotal, data.performedBy, batch.id, sequence, billCountAfter]
          );
          const [idRows] = await conn.execute<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS id');
          const billId = Number(idRows[0].id);
          for (const line of lines) {
            await conn.execute(
              `INSERT INTO bill_lines (bill_id, organization_id, branch_id, order_item_id, menu_item_id, item_name_snapshot, variant_name_snapshot, modifier_snapshot_json, quantity, unit_price, line_subtotal, discount_amount, taxable_amount, tax_amount, line_total, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [billId, data.organizationId, data.branchId, line.orderItemId, line.menuItemId, line.itemNameSnapshot, line.variantNameSnapshot, JSON.stringify(line.modifierSnapshot), line.quantity, line.unitPrice, line.lineSubtotal, line.discountAmount, line.taxableAmount, line.taxAmount, line.lineTotal, line.notes]
            );
          }
          for (const [itemId, quantity] of allocationMap) consumedByItem.set(itemId, round4((consumedByItem.get(itemId) || 0) + quantity));
          newRawGrandTotal = round4(newRawGrandTotal + components.rawGrand);
          newRoundingTotal = round4(newRoundingTotal + rounding);
        }
      } else {
        const count = data.billCount || 0;
        if (count < 2) throw new ConflictError('Even split requires at least two bills', 'INVALID_SPLIT_COUNT');
        if (existingBillRows.length) throw new ConflictError('Order already has split bills', 'ORDER_ALREADY_SPLIT');
        const total = Number(order.grand_total);
        const evenGrandTotals = splitMoneyEvenly(total, count);
        const sourceSubtotal = Number(order.subtotal), sourceDiscount = Number(order.discount), sourceTaxable = Number(order.taxable_amount || 0), sourceTax = Number(order.tax);
        const splitComponent = (value: number, index: number) => splitSnapshot(value, count, index);
        for (let index = 0; index < count; index += 1) {
          const sequence = index + 1;
          const grandTotal = evenGrandTotals[index];
          const subtotal = splitComponent(sourceSubtotal, index);
          const discount = splitComponent(sourceDiscount, index);
          const taxable = splitComponent(sourceTaxable, index);
          const tax = splitComponent(sourceTax, index);
          const raw = splitComponent(Number(order.grand_total) - Number(order.rounding_delta || 0), index);
          const rounding = round4(grandTotal - raw);
          const billNumber = `${String(order.order_number)}-${sequence}`;
          await conn.execute(
            `INSERT INTO bills (organization_id, branch_id, business_day_id, shift_id, register_id, order_id, bill_number, business_date, status, currency, subtotal, discount_total, taxable_amount, tax_total, vat_registered_snapshot, tax_registration_number_snapshot, vat_rate_snapshot, rounding_method_snapshot, rounding_delta, grand_total, amount_paid, balance_due, finalized_at, finalized_by, split_batch_id, split_sequence, split_mode, split_total_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FINALIZED', 'NPR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW(), ?, ?, ?, 'EVEN', ?)`,
            [data.organizationId, data.branchId, data.businessDayId, data.shiftId, data.registerId, data.orderId, billNumber, data.businessDate, subtotal, discount, taxable, tax, order.vat_registered_snapshot, order.tax_registration_number_snapshot, order.vat_rate_snapshot, order.rounding_method_snapshot, rounding, grandTotal, grandTotal, data.performedBy, batch.id, sequence, count]
          );
          const [ids] = await conn.execute<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS id');
          for (const item of itemRows) {
            const share = (value: unknown) => splitSnapshot(Number(value ?? 0), count, index);
            const lineSubtotal = share(item.line_subtotal), lineDiscount = share(item.discount_amount_snapshot);
            const lineTax = share(item.tax_amount);
            await conn.execute(
              `INSERT INTO bill_lines (bill_id, organization_id, branch_id, order_item_id, menu_item_id, item_name_snapshot, variant_name_snapshot, modifier_snapshot_json, quantity, unit_price, line_subtotal, discount_amount, taxable_amount, tax_amount, line_total, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [ids[0].id, data.organizationId, data.branchId, item.id, item.menu_item_id, item.item_name_snapshot,
                item.variant_name_snapshot ?? null, typeof item.modifier_snapshot_json === 'string' ? item.modifier_snapshot_json : JSON.stringify(item.modifier_snapshot_json ?? []),
                share(item.quantity), item.unit_price, lineSubtotal, lineDiscount, share(item.taxable_amount), lineTax,
                share(item.line_total), item.notes ?? null]
            );
          }
        }
      }

      const [createdBills] = await conn.execute<RowDataPacket[]>(`SELECT * FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ? AND split_batch_id = ? ORDER BY split_sequence ASC, id ASC`, [data.orderId, data.organizationId, data.branchId, batch.id]);
      await conn.execute('UPDATE bills SET split_total_count = ? WHERE split_batch_id = ? AND organization_id = ? AND branch_id = ?', [createdBills.length, batch.id, data.organizationId, data.branchId]);
      const allocated = createdBills.reduce((s, b) => s + Number(b.grand_total), 0);
      const allItemQuantitiesAllocated = data.mode === 'EVEN' || [...itemMap.values()].every((item) => Number(consumedByItem.get(Number(item.id)) || 0) >= Number(item.quantity) - EPSILON);
      const allocatedComplete = Math.abs(allocated - Number(batch.source_grand_total)) <= EPSILON && allItemQuantitiesAllocated;
      await conn.execute('UPDATE bill_split_batches SET status = ?, updated_at = NOW() WHERE id = ?', [allocatedComplete ? 'COMPLETED' : 'ACTIVE', batch.id]);
      await this.recalculateOrderPaymentStatus(conn, data.orderId, data.organizationId, data.branchId);
      await snapshotReportingDimensions(conn, data.organizationId, data.branchId, data.orderId);
      if (data.idempotency) await conn.execute(
        'INSERT INTO bill_split_requests (organization_id, branch_id, idempotency_key, request_hash, order_id) VALUES (?, ?, ?, ?, ?)',
        [data.organizationId, data.branchId, data.idempotency.key, data.idempotency.hash, data.orderId]
      );
      await conn.commit();
      return await this.getOrderBills(data.orderId, data.organizationId, data.branchId);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async findSplitReplay(organizationId: number, branchId: number, orderId: number, request: { key: string; hash: string }, conn?: PoolConnection): Promise<boolean> {
    const [rows] = await (conn || this.pool()).execute<RowDataPacket[]>(
      `SELECT order_id, request_hash FROM bill_split_requests WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ?${conn ? ' FOR UPDATE' : ''}`,
      [organizationId, branchId, request.key]
    );
    if (!rows.length) return false;
    if (Number(rows[0].order_id) !== orderId || rows[0].request_hash !== request.hash) throw new ConflictError('Idempotency key was already used for a different split', 'IDEMPOTENCY_KEY_CONFLICT');
    return true;
  }

  async recalculateOrderPaymentStatus(conn: PoolConnection, orderId: number, organizationId: number, branchId: number): Promise<void> {
    const [orderRows] = await conn.execute<RowDataPacket[]>('SELECT grand_total FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [orderId, organizationId, branchId]);
    if (!orderRows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const orderTotal = Number(orderRows[0].grand_total);
    const [billRows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN grand_total ELSE 0 END),0) AS billed_total,
              COALESCE(SUM(CASE WHEN status = 'FINALIZED' THEN amount_paid ELSE 0 END),0) AS paid_total
       FROM bills WHERE order_id = ? AND organization_id = ? AND branch_id = ?`, [orderId, organizationId, branchId]
    );
    const billed = Number(billRows[0].billed_total || 0), paid = Number(billRows[0].paid_total || 0);
    const status = paid <= EPSILON ? 'UNPAID' : (paid + EPSILON >= orderTotal && billed + EPSILON >= orderTotal ? 'PAID' : 'PARTIALLY_PAID');
    await conn.execute('UPDATE orders SET payment_status = ? WHERE id = ? AND organization_id = ? AND branch_id = ?', [status, orderId, organizationId, branchId]);
  }

  async findPaymentByIdempotency(key: string, organizationId: number, branchId: number, conn: PoolConnection | null = null): Promise<Payment | null> {
    const db = conn || this.pool();
    const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1', [organizationId, branchId, key]);
    return rows.length ? mapPayment(rows[0]) : null;
  }

  async listPayments(billId: number, organizationId: number, branchId: number): Promise<Payment[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM payments WHERE bill_id = ? AND organization_id = ? AND branch_id = ? ORDER BY id', [billId, organizationId, branchId]);
    return rows.map(mapPayment);
  }

  async findPaymentReplay(organizationId: number, branchId: number, key: string, hash: string): Promise<Payment | null> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1', [organizationId, branchId, key]);
    if (!rows.length || rows[0].request_hash == null) return null;
    if (String(rows[0].request_hash) !== hash) throw new ConflictError('Idempotency key was already used for a different payment', 'IDEMPOTENCY_KEY_CONFLICT');
    return mapPayment(rows[0]);
  }

  async recordPayment(data: {
    organizationId: number; branchId: number; businessDayId: number; shiftId: number; registerId: number; billId: number; paymentMethodId: number; amount: number; tenderAmount?: number; changeAmount: number;
    businessDate: string; externalReference?: string; notes?: string; idempotencyKey: string; requestHash: string; createdBy: number;
  }): Promise<Payment> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      if (!data.shiftId) throw new ConflictError('An active cashier shift is required for payment', 'ACTIVE_SHIFT_REQUIRED');
      const [shiftRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, status, business_day_id, register_id FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE`,
        [data.shiftId, data.organizationId, data.branchId]
      );
      if (!shiftRows.length || shiftRows[0].status !== 'OPEN') throw new ConflictError('The cashier shift is not open', 'SHIFT_NOT_OPEN');
      if (Number(shiftRows[0].business_day_id) !== data.businessDayId || Number(shiftRows[0].register_id) !== data.registerId) throw new ConflictError('Payment operational context does not match the active shift', 'SHIFT_CONTEXT_MISMATCH');
      const [billRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [data.billId, data.organizationId, data.branchId]);
      if (!billRows.length) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
      const bill = billRows[0];
      if (bill.status !== 'FINALIZED') throw new ConflictError('Payment requires a finalized bill', 'BILL_NOT_PAYABLE');

      const [orderRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [bill.order_id, data.organizationId, data.branchId]);
      if (!orderRows.length) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');

      const [existingRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE', [data.organizationId, data.branchId, data.idempotencyKey]);
      if (existingRows.length) {
        const existing = mapPayment(existingRows[0]);
        const storedHash = existingRows[0].request_hash == null ? null : String(existingRows[0].request_hash);
        if ((storedHash && storedHash !== data.requestHash) || (!storedHash && (existing.billId !== data.billId || Math.abs(existing.amount - data.amount) > EPSILON || existing.paymentMethodId !== data.paymentMethodId))) {
          throw new ConflictError('Idempotency key was already used for a different payment', 'IDEMPOTENCY_KEY_CONFLICT');
        }
        await conn.rollback();
        return existing;
      }

        if (['CANCELLED', 'COMPLETED', 'MERGED'].includes(String(orderRows[0].order_status))) throw new ConflictError('Payments cannot be recorded for a closed order', 'ORDER_NOT_PAYABLE');
        const remaining = Number(bill.grand_total) - Number(bill.amount_paid);
      if (data.amount <= 0) throw new ConflictError('Payment amount must be greater than zero', 'INVALID_PAYMENT_AMOUNT');
      if (data.amount > remaining + EPSILON) throw new ConflictError('Payment exceeds remaining balance', 'PAYMENT_EXCEEDS_BALANCE');

      const [methodRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM payment_methods WHERE id = ? AND organization_id = ? AND (branch_id IS NULL OR branch_id = ?) AND is_active = TRUE', [data.paymentMethodId, data.organizationId, data.branchId]);
      if (!methodRows.length) throw new NotFoundError('Payment method not found or inactive', 'PAYMENT_METHOD_NOT_FOUND');
      const method = methodRows[0];
      if (Boolean(method.requires_reference) && !data.externalReference) throw new ConflictError('A payment reference is required for this payment method', 'PAYMENT_REFERENCE_REQUIRED');
      if (String(method.type) === 'CASH' && data.tenderAmount != null && data.tenderAmount < data.amount) throw new ConflictError('Cash received cannot be less than the applied payment amount', 'INVALID_CASH_TENDER');

      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO payments (organization_id, branch_id, business_day_id, shift_id, register_id, bill_id, payment_method_id, amount, tender_amount, change_amount, business_date, status, external_reference, notes, idempotency_key, request_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CAPTURED', ?, ?, ?, ?, ?)`,
        [data.organizationId, data.branchId, data.businessDayId, data.shiftId, data.registerId, data.billId, data.paymentMethodId, data.amount, data.tenderAmount ?? null, data.changeAmount, data.businessDate, data.externalReference ?? null, data.notes ?? null, data.idempotencyKey, data.requestHash, data.createdBy]
      );
      const paymentId = Number(result.insertId);
      const newPaid = Number(bill.amount_paid) + data.amount;
      const balance = Math.max(0, round4(Number(bill.grand_total) - newPaid));
      await conn.execute('UPDATE bills SET amount_paid = ?, balance_due = ?, updated_at = NOW() WHERE id = ? AND organization_id = ? AND branch_id = ?', [newPaid, balance, data.billId, data.organizationId, data.branchId]);
      await this.recalculateOrderPaymentStatus(conn, Number(bill.order_id), data.organizationId, data.branchId);
      await conn.commit();
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ?', [paymentId, data.organizationId, data.branchId]);
      return mapPayment(rows[0]);
    } catch (err: any) {
      await conn.rollback();
      if (err?.errno === 1062 && data.idempotencyKey) {
        const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM payments WHERE organization_id = ? AND branch_id = ? AND idempotency_key = ? LIMIT 1', [data.organizationId, data.branchId, data.idempotencyKey]);
        if (rows.length) {
          const storedHash = rows[0].request_hash == null ? null : String(rows[0].request_hash);
          if (storedHash && storedHash !== data.requestHash) throw new ConflictError('Idempotency key was already used for a different payment', 'IDEMPOTENCY_KEY_CONFLICT');
          return mapPayment(rows[0]);
        }
      }
      throw err;
    } finally { conn.release(); }
  }

  async reversePayment(id: number, organizationId: number, branchId: number, reversedBy: number, reason: string): Promise<Payment> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [context] = await conn.execute<RowDataPacket[]>('SELECT shift_id, bill_id FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ?', [id, organizationId, branchId]);
      if (!context.length) throw new NotFoundError('Payment not found', 'PAYMENT_NOT_FOUND');
      const [shifts] = await conn.execute<RowDataPacket[]>('SELECT status FROM shifts WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [context[0].shift_id, organizationId, branchId]);
      if (!shifts.length || shifts[0].status !== 'OPEN') throw new ConflictError('Payments from a closed shift cannot be reversed', 'SHIFT_NOT_OPEN');
      // Match recording's shift -> bill -> payment lock order.
      await conn.execute('SELECT id FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [context[0].bill_id, organizationId, branchId]);
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [id, organizationId, branchId]);
      if (!rows.length) throw new NotFoundError('Payment not found', 'PAYMENT_NOT_FOUND');
      const payment = rows[0];
      if (payment.status === 'REVERSED') throw new ConflictError('Payment is already reversed', 'PAYMENT_ALREADY_REVERSED');
      const [billRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM bills WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [payment.bill_id, organizationId, branchId]);
      if (!billRows.length) throw new NotFoundError('Bill not found', 'BILL_NOT_FOUND');
      const bill = billRows[0];
      const [orders] = await conn.execute<RowDataPacket[]>('SELECT order_status FROM orders WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE', [bill.order_id, organizationId, branchId]);
      if (!orders.length || ['COMPLETED', 'CANCELLED', 'MERGED'].includes(String(orders[0].order_status))) throw new ConflictError('Payments on closed orders cannot be reversed', 'ORDER_NOT_PAYABLE');
      const newPaid = Math.max(0, Number(bill.amount_paid) - Number(payment.amount));
      const balance = Math.max(0, round4(Number(bill.grand_total) - newPaid));
      await conn.execute('UPDATE payments SET status = \'REVERSED\', reversed_at = NOW(), reversed_by = ?, reversal_reason = ? WHERE id = ? AND organization_id = ? AND branch_id = ?', [reversedBy, reason, id, organizationId, branchId]);
      await conn.execute('UPDATE bills SET amount_paid = ?, balance_due = ? WHERE id = ? AND organization_id = ? AND branch_id = ?', [newPaid, balance, bill.id, organizationId, branchId]);
      await this.recalculateOrderPaymentStatus(conn, Number(bill.order_id), organizationId, branchId);
      await conn.commit();
      const [updated] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM payments WHERE id = ? AND organization_id = ? AND branch_id = ?', [id, organizationId, branchId]);
      return mapPayment(updated[0]);
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }
}

export const billingRepository = new BillingRepository();
