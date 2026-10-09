import { administrationRepository } from '../administration/repository';
import { identityRepository } from '../identity/repository';
import { managementRepository } from '../management/repository';
import { shiftRepository } from '../shift/repository';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { OrderStatus, CreateOrderInput, OrderWithItems, OrderListResult, ListOrdersParams } from './types';
import { orderRepository } from './repository';
import { menuCustomizationRepository } from '../menuCustomization/repository';
import { ModifierSelectionInput } from '../menuCustomization/types';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { applyMembershipBenefit } from '../management/membershipBenefits';
import { normalizeDiningTableIds, stageOrderTablesForCreateInTransaction } from '../tableOperations/orderTables';
import { addMoney, calculateMenuPrice, calculateOrderPricing, multiplyMoney, type RoundingMethod } from '../../domain/pricing';
import { buildComboKotItems } from './comboSupport';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['PREPARING', 'CANCELLED'], PREPARING: ['READY', 'CANCELLED'], READY: ['SERVED', 'CANCELLED'],
  SERVED: ['COMPLETED'], COMPLETED: [], CANCELLED: [], MERGED: [],
};

export interface KotItemData {
  menuItemId: number;
  itemNameSnapshot: string;
  variantNameSnapshot?: string | null;
  modifierSummary?: string | null;
  quantity: number;
  notes?: string;
  prepStationId: number | null;
  prepStationName: string | null;
  prepTimeMinutesSnapshot: number | null;
}

export class OrderService {
  private async prepareItems(
    conn: PoolConnection,
    organizationId: number,
    branchId: number,
    input: CreateOrderInput,
    businessDate: string
  ) {
    const [taxRows] = await conn.execute<any[]>(
      `SELECT is_vat_registered, tax_registration_number, vat_rate, rounding_method
       FROM branch_tax_configs
       WHERE organization_id = ? AND branch_id = ?
       FOR UPDATE`,
      [organizationId, branchId]
    );
    const taxConfig = taxRows[0];
    const vatProfile = {
      isVatRegistered: Boolean(taxConfig?.is_vat_registered),
      vatRate: Number(taxConfig?.vat_rate || 0),
      roundingMethod: String(taxConfig?.rounding_method ?? 'HALF_EVEN') as RoundingMethod,
    };

    const resolvedItems: any[] = [];
    const kotItems: KotItemData[] = [];

    for (const inputItem of input.items) {
      const customization = await menuCustomizationRepository.resolveForOrder(
        conn,
        inputItem.menuItemId,
        organizationId,
        inputItem.variantId ?? null,
        inputItem.modifiers as ModifierSelectionInput[] | undefined
      );

      const [menuRows] = await conn.execute<any[]>(
        'SELECT id, name, category_id, default_prep_station_id, prep_time_minutes, is_combo FROM menu_items WHERE id = ? AND organization_id = ? FOR UPDATE',
        [inputItem.menuItemId, organizationId]
      );
      const menuItem = menuRows[0];
      if (!menuItem) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');

      let prepStationId: number | null = null;
      let prepStationName: string | null = null;
      if (menuItem.default_prep_station_id != null) {
        const [stationRows] = await conn.execute<any[]>(
          'SELECT id, name FROM preparation_stations WHERE id = ? AND organization_id = ? AND branch_id = ? AND is_active = TRUE',
          [menuItem.default_prep_station_id, organizationId, branchId]
        );
        if (stationRows.length) { prepStationId = Number(stationRows[0].id); prepStationName = String(stationRows[0].name); }
      }
      if (prepStationId == null) {
        const [stationRows] = await conn.execute<any[]>(
          `SELECT ps.id, ps.name FROM menu_categories mc LEFT JOIN preparation_stations ps ON ps.id = mc.station_id
           WHERE mc.id = ? AND mc.organization_id = ? AND (ps.branch_id = ? OR ps.id IS NULL) LIMIT 1`,
          [menuItem.category_id, organizationId, branchId]
        );
        if (stationRows.length && stationRows[0].id != null) { prepStationId = Number(stationRows[0].id); prepStationName = String(stationRows[0].name); }
      }

      const enteredUnitPrice = addMoney(customization.enteredPrice, customization.modifierTotal);
      const menuPricing = calculateMenuPrice(enteredUnitPrice, customization.priceEntryMode, vatProfile);
      const unitPrice = menuPricing.customerPrice;
      if (inputItem.expectedUnitPrice !== undefined && Math.abs(unitPrice - Number(inputItem.expectedUnitPrice)) > 0.0001) {
        throw new ConflictError(`Price changed for ${String(menuItem.name)} while this order was offline`, 'OFFLINE_PRICE_CHANGED', { menuItemId: inputItem.menuItemId, expectedUnitPrice: inputItem.expectedUnitPrice, currentUnitPrice: unitPrice });
      }
      const lineSubtotal = multiplyMoney(unitPrice, inputItem.quantity);
      resolvedItems.push({
        menuItemId: Number(menuItem.id), itemNameSnapshot: String(menuItem.name), unitPrice, enteredUnitPrice,
        priceEntryMode: customization.priceEntryMode, quantity: inputItem.quantity, lineSubtotal, lineTotal: lineSubtotal,
        notes: inputItem.notes,
        variantId: customization.variantId,
        variantNameSnapshot: customization.variantName,
        baseUnitPriceSnapshot: customization.enteredPrice,
        modifierTotal: customization.modifierTotal,
        modifierSnapshot: customization.modifierSnapshot,
        taxRateSnapshot: vatProfile.isVatRegistered ? vatProfile.vatRate : 0,
        taxableAmount: 0,
        taxAmount: 0,
      });

      const modifierSummary = customization.modifierSnapshot.map((m) => `${m.optionName}${m.quantity > 1 ? ` ×${m.quantity}` : ''}`).join(', ');
      if (Boolean(menuItem.is_combo)) {
        kotItems.push(...await buildComboKotItems(
          conn,
          organizationId,
          branchId,
          Number(menuItem.id),
          String(menuItem.name),
          inputItem.quantity,
          inputItem.notes,
        ));
      } else {
        kotItems.push({
          menuItemId: Number(menuItem.id), itemNameSnapshot: String(menuItem.name), variantNameSnapshot: customization.variantName,
          modifierSummary: modifierSummary || null, quantity: inputItem.quantity, notes: inputItem.notes,
          prepStationId, prepStationName, prepTimeMinutesSnapshot: menuItem.prep_time_minutes == null ? null : Number(menuItem.prep_time_minutes),
        });
      }
    }

    const subtotal = resolvedItems.reduce((sum, item) => sum + item.lineSubtotal, 0);
    let membershipBenefit: { membershipId: number; membershipNumberSnapshot: string; membershipTierSnapshot: string; membershipDiscount: number } | null = null;
    let manualDiscount = Math.min(Math.max(Number(input.discount ?? 0), 0), subtotal);
    let appliedDiscount = manualDiscount;

    if (input.membershipId != null) {
      if (input.customerId == null) throw new BadRequestError('Select a customer before applying a membership', 'MEMBERSHIP_REQUIRES_CUSTOMER');
      const [membershipRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, customer_id, membership_number, tier, start_date, end_date, benefit_discount_rate, status
         FROM memberships WHERE id = ? AND organization_id = ? FOR UPDATE`,
        [input.membershipId, organizationId]
      );
      if (!membershipRows.length) throw new NotFoundError('Membership not found in this organization', 'MEMBERSHIP_NOT_FOUND');
      const row = membershipRows[0];
      const applied = applyMembershipBenefit({
        id: Number(row.id), customerId: Number(row.customer_id), membershipNumber: String(row.membership_number), tier: String(row.tier),
        startDate: row.start_date instanceof Date ? row.start_date.toISOString().slice(0, 10) : String(row.start_date),
        endDate: row.end_date == null ? null : (row.end_date instanceof Date ? row.end_date.toISOString().slice(0, 10) : String(row.end_date)),
        benefitDiscountRate: Number(row.benefit_discount_rate), status: row.status,
      }, input.customerId, businessDate, subtotal, Number(input.discount ?? 0));
      membershipBenefit = {
        membershipId: applied.membershipId,
        membershipNumberSnapshot: applied.membershipNumberSnapshot,
        membershipTierSnapshot: applied.membershipTierSnapshot,
        membershipDiscount: applied.membershipDiscount,
      };
      manualDiscount = applied.manualDiscount;
      appliedDiscount = applied.totalDiscount;
    }
    const pricing = calculateOrderPricing(
      resolvedItems.map((item, index) => ({ key: index, customerPrice: item.lineSubtotal })),
      appliedDiscount,
      vatProfile,
    );
    for (const line of pricing.lines) {
      const item = resolvedItems[Number(line.key)];
      item.lineSubtotal = line.lineSubtotal;
      item.discountAllocation = line.discountAmount;
      item.taxableAmount = line.taxableAmount;
      item.taxAmount = line.vatAmount;
      item.lineTotal = line.lineTotal;
    }

    return {
      resolvedItems,
      kotItems,
      totals: { subtotal: pricing.subtotal, discount: pricing.discount, membershipDiscount: membershipBenefit?.membershipDiscount ?? 0, manualDiscount, taxableAmount: pricing.taxableAmount, tax: pricing.vatAmount, roundingDelta: pricing.roundingDelta, grandTotal: pricing.grandTotal },
      membershipBenefit,
      vatSnapshot: {
        isVatRegistered: vatProfile.isVatRegistered,
        taxRegistrationNumber: taxConfig?.tax_registration_number == null ? null : String(taxConfig.tax_registration_number),
        vatRate: vatProfile.isVatRegistered ? vatProfile.vatRate : 0,
        roundingMethod: vatProfile.roundingMethod,
      },
    };
  }

  async createOrder(organizationId: number, branchId: number, createdBy: number, input: CreateOrderInput, actorPermissions: string[], idempotency?: { key: string; hash: string }): Promise<{ order: OrderWithItems; replayed: boolean }> {
    const branch = await identityRepository.findBranchById(organizationId, branchId);
    if (!branch || !branch.isActive) throw new NotFoundError('Branch not found or inactive', 'BRANCH_NOT_FOUND');

    // Keep table ownership locks deterministic. The repository takes the primary
    // table lock before the staged multi-table lock set, so using the lowest table
    // id as the internal primary guarantees every concurrent create acquires the
    // physical table rows in the same ascending order.
    const requestedTableIds = input.orderType === 'DINE_IN'
      ? normalizeDiningTableIds(input.diningTableId, input.diningTableIds).sort((a, b) => a - b)
      : [];
    const primaryTableId = input.orderType === 'DINE_IN' ? (requestedTableIds[0] ?? null) : null;
    if (input.orderType === 'DINE_IN' && primaryTableId == null) {
      throw new BadRequestError('Dine-in orders require a dining table', 'DINING_TABLE_REQUIRED');
    }
    if (input.orderType === 'TAKEAWAY' && requestedTableIds.length) {
      throw new BadRequestError('Takeaway orders cannot be assigned to dining tables', 'INVALID_TABLE_FOR_ORDER_TYPE');
    }

    let tableLabel: string | null = null;
    const labels: string[] = [];
    for (const tableId of requestedTableIds) {
      const table = await administrationRepository.findTableById(tableId, organizationId);
      if (!table || table.branchId !== branchId) throw new NotFoundError(`Dining table #${tableId} was not found in this branch`, 'DINING_TABLE_NOT_FOUND');
      if (!table.isActive) throw new BadRequestError(`Dining table ${table.tableNumber ?? table.id} is not active`, 'TABLE_INACTIVE');
      if (!(await managementRepository.canAccessTable(organizationId, createdBy, branchId, tableId, actorPermissions))) {
        throw new ForbiddenError('You do not have access to one or more selected tables', 'TABLE_ACCESS_FORBIDDEN');
      }
      labels.push(table.tableNumber ?? `Table ${table.id}`);
    }
    if (labels.length) tableLabel = labels.length === 1 ? labels[0] : `${labels[0]} +${labels.length - 1}`;

    const normalizedInput: CreateOrderInput = {
      ...input,
      diningTableId: primaryTableId,
      diningTableIds: requestedTableIds.length ? requestedTableIds : undefined,
    };

    if (normalizedInput.customerId != null) {
      const [customerRows] = await getDatabasePool().execute<RowDataPacket[]>('SELECT id FROM customers WHERE id = ? AND organization_id = ? AND is_active = 1', [normalizedInput.customerId, organizationId]);
      if (!customerRows.length) throw new NotFoundError('Customer not found in this organization', 'CUSTOMER_NOT_FOUND');
    }

    let waiterName: string | null = null;
    if (normalizedInput.waiterId && normalizedInput.waiterId !== createdBy && !actorPermissions.some(permission => ['admin:all','admin:tables:manage','admin:access:manage','pos:tables:allocate'].includes(permission))) {
      throw new ForbiddenError('You cannot assign this order to another waiter', 'WAITER_ASSIGNMENT_FORBIDDEN');
    }
    if (normalizedInput.waiterId) {
      const waiter = await identityRepository.findUserById(organizationId, normalizedInput.waiterId);
      if (!waiter) throw new NotFoundError('Waiter not found', 'WAITER_NOT_FOUND');
      if (!waiter.isActive) throw new BadRequestError('Waiter is inactive', 'WAITER_INACTIVE');
      const allowedBranches = await identityRepository.getUserAllowedBranchIds(normalizedInput.waiterId, organizationId);
      if (!allowedBranches.includes(branchId)) throw new BadRequestError('Waiter does not have access to this branch', 'WAITER_NO_BRANCH_ACCESS');
      waiterName = waiter.name;
    }

    const businessDay = await shiftRepository.getCurrentBusinessDay(organizationId, branchId);
    if (!businessDay) throw new ConflictError('Open the business day before creating orders', 'BUSINESS_DAY_REQUIRED');
    const currentShift = await shiftRepository.currentShiftForUser(organizationId, branchId, createdBy);

    return orderRepository.createPrepared(
      organizationId, branchId, createdBy, normalizedInput, branch.billPrefix, tableLabel, waiterName,
      async (conn) => {
        if (normalizedInput.orderType === 'DINE_IN' && normalizedInput.diningTableId != null) {
          await stageOrderTablesForCreateInTransaction(conn, {
            organizationId,
            branchId,
            primaryTableId: normalizedInput.diningTableId,
            tableIds: normalizedInput.diningTableIds ?? [normalizedInput.diningTableId],
            performedBy: createdBy,
          });
        }
        return this.prepareItems(conn, organizationId, branchId, normalizedInput, businessDay.businessDate);
      },
      { businessDayId: businessDay.id, shiftId: currentShift?.id ?? null, registerId: currentShift?.registerId ?? null },
      idempotency
    );
  }

  async calculateTotals(items: { lineTotal: number }[], discount: number, branchId: number, organizationId: number) {
    const taxConfig = await administrationRepository.getBranchTaxConfig(organizationId, branchId);
    return calculateOrderPricing(
      items.map((item, index) => ({ key: index, customerPrice: item.lineTotal })),
      discount,
      {
        isVatRegistered: Boolean(taxConfig?.isVatRegistered),
        vatRate: taxConfig?.vatRate ?? 0,
        roundingMethod: taxConfig?.roundingMethod ?? 'HALF_EVEN',
      },
    );
  }

  async serveOrder(id: number, organizationId: number, branchId: number, userId: number): Promise<OrderWithItems> {
    const order = await orderRepository.findById(id, organizationId, branchId);
    if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    this.validateStatusTransition(order.orderStatus, 'SERVED');
    if (order.orderType !== 'DINE_IN') throw new BadRequestError('Only dine-in orders require a served action', 'ORDER_NOT_SERVABLE');
    await orderRepository.serve(id, organizationId, branchId, userId);
    const updated = await orderRepository.findById(id, organizationId, branchId);
    if (!updated) throw new NotFoundError('Order not found after serving', 'ORDER_NOT_FOUND');
    return updated;
  }

  async completeOrder(id: number, organizationId: number, branchId: number, userId: number): Promise<OrderWithItems> {
    const order = await orderRepository.findById(id, organizationId, branchId);
    if (!order) throw new NotFoundError('Order not found', 'ORDER_NOT_FOUND');
    const takeawayReadyCompletion = order.orderType === 'TAKEAWAY' && order.orderStatus === 'READY';
    if (!takeawayReadyCompletion) this.validateStatusTransition(order.orderStatus, 'COMPLETED');
    if (order.paymentStatus !== 'PAID') throw new BadRequestError('Order cannot be completed until its bill is fully paid', 'ORDER_NOT_FINANCIALLY_SETTLED');
    await orderRepository.complete(id, organizationId, branchId, userId);
    const updated = await orderRepository.findById(id, organizationId, branchId);
    if (!updated) throw new NotFoundError('Order not found after completion', 'ORDER_NOT_FOUND');
    return updated;
  }

  validateStatusTransition(currentStatus: OrderStatus, newStatus: OrderStatus): void {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) throw new BadRequestError(`Cannot transition from ${currentStatus} to ${newStatus}`, 'INVALID_STATUS_TRANSITION', { currentStatus, newStatus, allowedTransitions: allowed ?? [] });
  }
}

export const orderService = new OrderService();
