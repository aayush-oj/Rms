import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ConflictError, NotFoundError } from '../../shared/errors';

const EPSILON = 0.0001;

type MergeBillRow = RowDataPacket & {
  id: number;
  order_id: number;
  business_day_id?: number | null;
  status: string;
  split_batch_id: number | null;
  amount_paid: number;
  credit_total?: number;
};

export interface MergeBillingState {
  sourceBill: MergeBillRow | null;
  destinationBill: MergeBillRow | null;
  historicalBillIds: number[];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

export async function lockAndValidateMergeBillingInTransaction(
  conn: PoolConnection,
  data: {
    organizationId: number;
    branchId: number;
    sourceOrderId: number;
    destinationOrderId: number;
    combinedOrderStatus: string;
  },
): Promise<MergeBillingState> {
  const [bills] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM bills
      WHERE organization_id = ? AND branch_id = ? AND order_id IN (?, ?)
      ORDER BY id FOR UPDATE`,
    [data.organizationId, data.branchId, data.sourceOrderId, data.destinationOrderId],
  );

  const allBills = bills as MergeBillRow[];
  if (allBills.some((bill) => String(bill.status) === 'CANCELLED')) {
    throw new ConflictError(
      'Orders with cancelled bill history cannot be merged safely.',
      'MERGE_BILL_HISTORY_EXISTS',
    );
  }

  const sourceBills = allBills.filter((bill) => Number(bill.order_id) === data.sourceOrderId);
  const destinationBills = allBills.filter((bill) => Number(bill.order_id) === data.destinationOrderId);

  if (sourceBills.length > 1 || destinationBills.length > 1 || allBills.some((bill) => bill.split_batch_id != null)) {
    throw new ConflictError(
      'Split bills cannot be merged.',
      'MERGE_SPLIT_BILL_EXISTS',
    );
  }

  const [splitBatches] = await conn.execute<RowDataPacket[]>(
    `SELECT id, order_id, status FROM bill_split_batches
      WHERE organization_id = ? AND branch_id = ? AND order_id IN (?, ?)
      FOR UPDATE`,
    [data.organizationId, data.branchId, data.sourceOrderId, data.destinationOrderId],
  );
  if (splitBatches.length) {
    throw new ConflictError(
      'Orders with split-bill history cannot be merged.',
      'MERGE_SPLIT_BILL_EXISTS',
    );
  }

  if (allBills.length) {
    const [orders] = await conn.execute<RowDataPacket[]>(
      `SELECT id, business_day_id, settlement_status FROM orders
        WHERE organization_id = ? AND branch_id = ? AND id IN (?, ?)
        ORDER BY id FOR UPDATE`,
      [data.organizationId, data.branchId, data.sourceOrderId, data.destinationOrderId],
    );
    if (orders.some((order) => String(order.settlement_status || 'OPEN') !== 'OPEN')) {
      throw new ConflictError(
        'Orders with financial settlement history cannot be merged.',
        'MERGE_FINANCIAL_SETTLEMENT_EXISTS',
      );
    }

    const sourceOrder = orders.find((order) => Number(order.id) === data.sourceOrderId);
    const destinationOrder = orders.find((order) => Number(order.id) === data.destinationOrderId);
    const sourceOrderDay = sourceOrder?.business_day_id == null ? null : Number(sourceOrder.business_day_id);
    const destinationOrderDay = destinationOrder?.business_day_id == null ? null : Number(destinationOrder.business_day_id);
    if (sourceOrderDay !== destinationOrderDay) {
      throw new ConflictError(
        'Billed orders from different business days cannot be merged.',
        'MERGE_BUSINESS_DAY_MISMATCH',
      );
    }

    for (const bill of allBills) {
      const orderDay = Number(bill.order_id) === data.sourceOrderId ? sourceOrderDay : destinationOrderDay;
      const billDay = bill.business_day_id == null ? null : Number(bill.business_day_id);
      if (billDay != null && orderDay != null && billDay !== orderDay) {
        throw new ConflictError(
          'Bill and order business-day context do not match, so Merge is blocked.',
          'MERGE_BUSINESS_DAY_MISMATCH',
        );
      }
    }

    const ids = allBills.map((bill) => Number(bill.id));
    const [payments] = await conn.execute<RowDataPacket[]>(
      `SELECT id, bill_id, status FROM payments
        WHERE organization_id = ? AND branch_id = ? AND bill_id IN (${placeholders(ids.length)})
        ORDER BY id FOR UPDATE`,
      [data.organizationId, data.branchId, ...ids],
    );
    if (payments.length) {
      throw new ConflictError(
        'Orders with payment history cannot be merged, even if a payment was later reversed.',
        'MERGE_PAYMENT_HISTORY_EXISTS',
      );
    }

    const [receivables] = await conn.execute<RowDataPacket[]>(
      `SELECT id, bill_id, status FROM customer_receivables
        WHERE organization_id = ? AND branch_id = ? AND bill_id IN (${placeholders(ids.length)})
        ORDER BY id FOR UPDATE`,
      [data.organizationId, data.branchId, ...ids],
    );
    if (receivables.length) {
      throw new ConflictError(
        'Orders with customer-credit history cannot be merged.',
        'MERGE_CREDIT_HISTORY_EXISTS',
      );
    }
  }

  if (allBills.some((bill) => Number(bill.amount_paid || 0) > EPSILON || Number(bill.credit_total || 0) > EPSILON)) {
    throw new ConflictError(
      'Orders with payments or customer credit cannot be merged.',
      'MERGE_FINANCIAL_SETTLEMENT_EXISTS',
    );
  }

  const invalidStatus = allBills.find((bill) => String(bill.status) !== 'FINALIZED');
  if (invalidStatus) {
    throw new ConflictError('This bill state cannot be merged safely.', 'MERGE_BILL_STATE_UNSUPPORTED');
  }

  if (allBills.length > 0 && data.combinedOrderStatus !== 'SERVED') {
    throw new ConflictError(
      'An unpaid bill can only be merged after both dining orders are served.',
      'MERGE_BILLED_ORDER_NOT_SERVED',
    );
  }

  return {
    sourceBill: sourceBills[0] ?? null,
    destinationBill: destinationBills[0] ?? null,
    historicalBillIds: allBills.map((bill) => Number(bill.id)),
  };
}

async function rebuildFinalizedBillSnapshotInTransaction(
  conn: PoolConnection,
  data: {
    organizationId: number;
    branchId: number;
    billId: number;
    orderId: number;
    performedBy: number;
  },
): Promise<void> {
  const [orders] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM orders
      WHERE id = ? AND organization_id = ? AND branch_id = ? FOR UPDATE`,
    [data.orderId, data.organizationId, data.branchId],
  );
  if (!orders.length) throw new NotFoundError('Order not found while rebuilding bill', 'ORDER_NOT_FOUND');
  const order = orders[0];

  const [items] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM order_items WHERE order_id = ? ORDER BY id FOR UPDATE`,
    [data.orderId],
  );
  if (!items.length) throw new ConflictError('Merged order has no billable items', 'ORDER_HAS_NO_ITEMS');

  const taxableAmount = Number(order.taxable_amount || 0);
  const discountType = String(order.billing_discount_type || (Number(order.manual_discount || 0) > 0 ? 'AMOUNT' : 'NONE'));
  const discountValue = Number(order.billing_discount_value ?? (discountType === 'AMOUNT' ? order.manual_discount || 0 : 0));
  const discountReason = discountValue > EPSILON ? 'Combined during order merge' : null;

  await conn.execute(
    `UPDATE bills
        SET order_id = ?,
            status = 'FINALIZED',
            subtotal = ?,
            discount_total = ?,
            discount_type = ?,
            discount_value = ?,
            discount_reason = ?,
            taxable_amount = ?,
            tax_total = ?,
            vat_registered_snapshot = ?,
            tax_registration_number_snapshot = ?,
            vat_rate_snapshot = ?,
            rounding_method_snapshot = ?,
            rounding_delta = ?,
            grand_total = ?,
            amount_paid = 0,
            credit_total = 0,
            balance_due = ?,
            split_batch_id = NULL,
            split_sequence = NULL,
            split_mode = NULL,
            split_total_count = NULL,
            finalized_at = COALESCE(finalized_at, NOW()),
            finalized_by = COALESCE(finalized_by, ?),
            cancelled_at = NULL,
            cancelled_by = NULL,
            cancellation_reason = NULL,
            updated_at = NOW()
      WHERE id = ? AND organization_id = ? AND branch_id = ?`,
    [
      data.orderId,
      Number(order.subtotal || 0),
      Number(order.discount || 0),
      discountType,
      discountValue,
      discountReason,
      taxableAmount,
      Number(order.tax || 0),
      Boolean(order.vat_registered_snapshot),
      order.tax_registration_number_snapshot ?? null,
      Number(order.vat_rate_snapshot || 0),
      String(order.rounding_method_snapshot || 'HALF_EVEN'),
      Number(order.rounding_delta || 0),
      Number(order.grand_total || 0),
      Number(order.grand_total || 0),
      data.performedBy,
      data.billId,
      data.organizationId,
      data.branchId,
    ],
  );

  await conn.execute(
    `DELETE FROM bill_lines WHERE bill_id = ? AND organization_id = ? AND branch_id = ?`,
    [data.billId, data.organizationId, data.branchId],
  );

  for (const item of items) {
    const lineSubtotal = Number(item.line_subtotal || 0);
    const discountAmount = Number(item.discount_amount_snapshot || 0);
    const taxable = Number(item.taxable_amount || 0);
    const taxAmount = Number(item.tax_amount || 0);
    const lineTotal = Number(item.line_total || 0);

    await conn.execute(
      `INSERT INTO bill_lines
        (bill_id, organization_id, branch_id, order_item_id, menu_item_id, item_name_snapshot,
         variant_name_snapshot, modifier_snapshot_json, quantity, unit_price, line_subtotal,
         discount_amount, taxable_amount, tax_amount, line_total, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.billId,
        data.organizationId,
        data.branchId,
        item.id,
        item.menu_item_id,
        item.item_name_snapshot,
        item.variant_name_snapshot ?? null,
        typeof item.modifier_snapshot_json === 'string'
          ? item.modifier_snapshot_json
          : JSON.stringify(item.modifier_snapshot_json ?? []),
        Number(item.quantity),
        Number(item.unit_price),
        lineSubtotal,
        discountAmount,
        taxable,
        taxAmount,
        lineTotal,
        item.notes ?? null,
      ],
    );
  }

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
     WHERE b.organization_id = ? AND b.branch_id = ? AND b.id = ?`,
    [data.organizationId, data.branchId, data.billId],
  );
}

export async function reconcileMergeBillingInTransaction(
  conn: PoolConnection,
  data: {
    organizationId: number;
    branchId: number;
    sourceOrderId: number;
    destinationOrderId: number;
    performedBy: number;
    state: MergeBillingState;
  },
): Promise<{ canonicalBillId: number | null; cancelledBillId: number | null }> {
  const sourceBill = data.state.sourceBill;
  const destinationBill = data.state.destinationBill;
  if (!sourceBill && !destinationBill) {
    return { canonicalBillId: null, cancelledBillId: null };
  }

  const canonical = destinationBill ?? sourceBill!;
  let cancelledBillId: number | null = null;

  if (sourceBill && destinationBill && Number(sourceBill.id) !== Number(destinationBill.id)) {
    cancelledBillId = Number(sourceBill.id);
    await conn.execute(
      `UPDATE bills
          SET status = 'CANCELLED',
              balance_due = 0,
              cancelled_at = NOW(),
              cancelled_by = ?,
              cancellation_reason = 'Merged into another unpaid order',
              updated_at = NOW()
        WHERE id = ? AND organization_id = ? AND branch_id = ?`,
      [data.performedBy, sourceBill.id, data.organizationId, data.branchId],
    );
  }

  await rebuildFinalizedBillSnapshotInTransaction(conn, {
    organizationId: data.organizationId,
    branchId: data.branchId,
    billId: Number(canonical.id),
    orderId: data.destinationOrderId,
    performedBy: data.performedBy,
  });

  return { canonicalBillId: Number(canonical.id), cancelledBillId };
}
