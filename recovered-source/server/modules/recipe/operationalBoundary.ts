import { recipeRepository } from './repository';
import { stockRepository } from '../stock/repository';
import { RowDataPacket } from 'mysql2/promise';
import { BadRequestError } from '../../shared/errors';

let boundaryApplied = false;

/**
 * Recipe costing remains outside the active RMS product scope.
 *
 * Legacy order/create/append/cancel paths already call these hooks from inside
 * the authoritative POS transaction. Reuse that stable transaction boundary,
 * but route it to the simple count-based stock engine instead of recipes,
 * units or ingredient inventory.
 */
export function applyOperationalInventoryBoundary(): void {
  if (boundaryApplied) return;

  recipeRepository.consumeOrderItemInTransaction = async (
    conn,
    organizationId,
    branchId,
    orderId,
    orderItemId,
    menuItemId,
    saleQuantity,
    _variantId,
    _modifierSnapshot,
    performedBy,
  ) => {
    const [menuRows] = await conn.execute<RowDataPacket[]>(
      'SELECT is_combo FROM menu_items WHERE id = ? AND organization_id = ?',
      [menuItemId, organizationId],
    );
    const isCombo = Boolean(menuRows[0]?.is_combo);
    if (isCombo) {
      const [components] = await conn.execute<RowDataPacket[]>(
        `SELECT cc.component_menu_item_id, cc.quantity, mi.is_combo
           FROM menu_combo_components cc
           JOIN menu_items mi
             ON mi.id = cc.component_menu_item_id
            AND mi.organization_id = cc.organization_id
          WHERE cc.organization_id = ? AND cc.combo_menu_item_id = ?
          ORDER BY cc.display_order, cc.id`,
        [organizationId, menuItemId],
      );
      if (components.length < 2) {
        throw new BadRequestError('Combo needs at least two configured items', 'COMBO_COMPONENTS_REQUIRED');
      }
      if (components.some((component) => Boolean(component.is_combo))) {
        throw new BadRequestError('Nested combos are not supported', 'COMBO_COMPONENT_NESTED_COMBO');
      }
      for (const component of components) {
        await stockRepository.consumeOrderItemInTransaction(
          conn,
          organizationId,
          branchId,
          orderId,
          orderItemId,
          Number(component.component_menu_item_id),
          saleQuantity * Number(component.quantity),
          performedBy,
        );
      }
    } else {
      await stockRepository.consumeOrderItemInTransaction(
        conn,
        organizationId,
        branchId,
        orderId,
        orderItemId,
        menuItemId,
        saleQuantity,
        performedBy,
      );
    }
    // Legacy callers do not use recipe snapshots in the active product. Keep
    // the historical return shape so dormant code continues to type-check.
    return { consumed: false, ingredients: [] };
  };

  recipeRepository.reverseOrderConsumptionInTransaction = async (
    conn,
    organizationId,
    branchId,
    orderId,
    performedBy,
    reason,
  ) => {
    await stockRepository.reverseOrderInTransaction(
      conn,
      organizationId,
      branchId,
      orderId,
      performedBy,
      reason,
    );
    return 0;
  };

  recipeRepository.reverseOrderItemsConsumptionInTransaction = async (
    conn,
    organizationId,
    branchId,
    orderId,
    orderItemIds,
    performedBy,
    reason,
  ) => {
    await stockRepository.reverseOrderItemsInTransaction(
      conn,
      organizationId,
      branchId,
      orderId,
      orderItemIds,
      performedBy,
      reason,
    );
    return 0;
  };

  boundaryApplied = true;
}

export function operationalInventoryBoundaryApplied(): boolean {
  return boundaryApplied;
}
