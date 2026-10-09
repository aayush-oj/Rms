import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import {
  MenuItemVariant, ModifierGroup, ModifierOption, MenuItemCustomizations,
  ModifierSelectionInput, ResolvedCustomization, VariantPriceMode,
} from './types';
import { addMoney, multiplyMoney } from '../../domain/pricing';

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapVariant(row: RowDataPacket): MenuItemVariant {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), menuItemId: Number(row.menu_item_id),
    name: row.name, price: Number(row.price), priceMode: row.price_mode as VariantPriceMode,
    displayOrder: Number(row.display_order), isActive: Boolean(row.is_active),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapGroup(row: RowDataPacket): ModifierGroup {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), name: row.name,
    selectionMode: row.selection_mode, minSelections: Number(row.min_selections), maxSelections: Number(row.max_selections),
    pricingStrategy: row.pricing_strategy, sharedPrice: Number(row.shared_price), displayOrder: Number(row.display_order),
    isActive: Boolean(row.is_active), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapOption(row: RowDataPacket): ModifierOption {
  return {
    id: Number(row.id), organizationId: Number(row.organization_id), modifierGroupId: Number(row.modifier_group_id),
    name: row.name, priceAdjustment: Number(row.price_adjustment), displayOrder: Number(row.display_order),
    allowRepeat: Boolean(row.allow_repeat), isActive: Boolean(row.is_active), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

export class MenuCustomizationRepository {
  private pool() { return getDatabasePool(); }

  async listGroups(organizationId: number): Promise<ModifierGroup[]> {
    const [groups] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_groups WHERE organization_id = ? ORDER BY display_order, name, id', [organizationId]);
    return groups.map(mapGroup);
  }

  async listForMenuItem(menuItemId: number, organizationId: number): Promise<MenuItemCustomizations> {
    const [variants] = await this.pool().execute<RowDataPacket[]>(
      `SELECT * FROM menu_item_variants WHERE menu_item_id = ? AND organization_id = ? ORDER BY display_order, id`,
      [menuItemId, organizationId]
    );
    const [groups] = await this.pool().execute<RowDataPacket[]>(
      `SELECT mg.* FROM modifier_groups mg
       INNER JOIN menu_item_modifier_groups mimg ON mimg.modifier_group_id = mg.id AND mimg.organization_id = mg.organization_id
       WHERE mimg.menu_item_id = ? AND mimg.organization_id = ?
       ORDER BY mimg.display_order, mg.display_order, mg.id`,
      [menuItemId, organizationId]
    );
    const mappedGroups = groups.map(mapGroup);
    for (const group of mappedGroups) {
      const [options] = await this.pool().execute<RowDataPacket[]>(
        `SELECT * FROM modifier_options WHERE modifier_group_id = ? AND organization_id = ? ORDER BY display_order, id`,
        [group.id, organizationId]
      );
      group.options = options.map(mapOption);
    }
    return { variants: variants.map(mapVariant), modifierGroups: mappedGroups };
  }

  async createVariant(data: Omit<MenuItemVariant, 'id'|'createdAt'|'updatedAt'|'organizationId'> & { organizationId: number }): Promise<MenuItemVariant> {
    const [item] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM menu_items WHERE id = ? AND organization_id = ?', [data.menuItemId, data.organizationId]);
    if (!item.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
    if (data.name.trim() === '') throw new BadRequestError('Variant name is required', 'VARIANT_NAME_REQUIRED');
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO menu_item_variants (organization_id, menu_item_id, name, price, price_mode, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.organizationId, data.menuItemId, data.name.trim(), data.price, data.priceMode, data.displayOrder, data.isActive]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM menu_item_variants WHERE id = ?', [result.insertId]);
      return mapVariant(rows[0]);
    } catch (err: any) {
      if (String(err?.code) === 'ER_DUP_ENTRY') throw new ConflictError('Variant already exists for this menu item', 'VARIANT_DUPLICATE');
      throw err;
    }
  }

  async updateVariant(id: number, organizationId: number, updates: Partial<Pick<MenuItemVariant, 'name'|'price'|'priceMode'|'displayOrder'|'isActive'>>): Promise<MenuItemVariant> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM menu_item_variants WHERE id = ? AND organization_id = ?', [id, organizationId]);
    if (!rows.length) throw new NotFoundError('Variant not found', 'VARIANT_NOT_FOUND');
    const existing = mapVariant(rows[0]);
    try {
      await this.pool().execute(
        `UPDATE menu_item_variants SET name = ?, price = ?, price_mode = ?, display_order = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?`,
        [updates.name?.trim() ?? existing.name, updates.price ?? existing.price, updates.priceMode ?? existing.priceMode, updates.displayOrder ?? existing.displayOrder, updates.isActive ?? existing.isActive, id, organizationId]
      );
      const [updated] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM menu_item_variants WHERE id = ? AND organization_id = ?', [id, organizationId]);
      return mapVariant(updated[0]);
    } catch (err: any) {
      if (String(err?.code) === 'ER_DUP_ENTRY') throw new ConflictError('Variant already exists for this menu item', 'VARIANT_DUPLICATE');
      throw err;
    }
  }

  async createGroup(data: Omit<ModifierGroup, 'id'|'createdAt'|'updatedAt'|'organizationId'|'options'> & { organizationId: number }): Promise<ModifierGroup> {
    if (data.minSelections > data.maxSelections) throw new BadRequestError('Minimum selections cannot exceed maximum selections', 'INVALID_SELECTION_LIMITS');
    if (data.maxSelections < 1) throw new BadRequestError('Maximum selections must be at least 1', 'INVALID_SELECTION_LIMITS');
    if (data.selectionMode === 'SINGLE' && data.maxSelections !== 1) throw new BadRequestError('Single-select groups must have maximum 1', 'INVALID_SELECTION_LIMITS');
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO modifier_groups (organization_id, name, selection_mode, min_selections, max_selections, pricing_strategy, shared_price, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.organizationId, data.name.trim(), data.selectionMode, data.minSelections, data.maxSelections, data.pricingStrategy, data.sharedPrice, data.displayOrder, data.isActive]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_groups WHERE id = ?', [result.insertId]);
      return mapGroup(rows[0]);
    } catch (err: any) {
      if (String(err?.code) === 'ER_DUP_ENTRY') throw new ConflictError('Modifier group already exists', 'MODIFIER_GROUP_DUPLICATE');
      throw err;
    }
  }

  async updateGroup(id: number, organizationId: number, updates: Partial<Pick<ModifierGroup, 'name'|'selectionMode'|'minSelections'|'maxSelections'|'pricingStrategy'|'sharedPrice'|'displayOrder'|'isActive'>>): Promise<ModifierGroup> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_groups WHERE id = ? AND organization_id = ?', [id, organizationId]);
    if (!rows.length) throw new NotFoundError('Modifier group not found', 'MODIFIER_GROUP_NOT_FOUND');
    const existing = mapGroup(rows[0]);
    const selectionMode = updates.selectionMode ?? existing.selectionMode;
    const min = updates.minSelections ?? existing.minSelections;
    const max = updates.maxSelections ?? existing.maxSelections;
    if (min > max || max < 1 || (selectionMode === 'SINGLE' && max !== 1)) throw new BadRequestError('Invalid modifier selection limits', 'INVALID_SELECTION_LIMITS');
    try {
      await this.pool().execute(
        `UPDATE modifier_groups SET name = ?, selection_mode = ?, min_selections = ?, max_selections = ?, pricing_strategy = ?, shared_price = ?, display_order = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?`,
        [updates.name?.trim() ?? existing.name, selectionMode, min, max, updates.pricingStrategy ?? existing.pricingStrategy, updates.sharedPrice ?? existing.sharedPrice, updates.displayOrder ?? existing.displayOrder, updates.isActive ?? existing.isActive, id, organizationId]
      );
      const [updated] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_groups WHERE id = ? AND organization_id = ?', [id, organizationId]);
      return mapGroup(updated[0]);
    } catch (err: any) {
      if (String(err?.code) === 'ER_DUP_ENTRY') throw new ConflictError('Modifier group already exists', 'MODIFIER_GROUP_DUPLICATE');
      throw err;
    }
  }

  async createOption(data: Omit<ModifierOption, 'id'|'createdAt'|'updatedAt'|'organizationId'> & { organizationId: number }): Promise<ModifierOption> {
    const [group] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM modifier_groups WHERE id = ? AND organization_id = ?', [data.modifierGroupId, data.organizationId]);
    if (!group.length) throw new NotFoundError('Modifier group not found', 'MODIFIER_GROUP_NOT_FOUND');
    try {
      const [result] = await this.pool().execute<ResultSetHeader>(
        `INSERT INTO modifier_options (organization_id, modifier_group_id, name, price_adjustment, display_order, allow_repeat, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.organizationId, data.modifierGroupId, data.name.trim(), data.priceAdjustment, data.displayOrder, data.allowRepeat, data.isActive]
      );
      const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_options WHERE id = ?', [result.insertId]);
      return mapOption(rows[0]);
    } catch (err: any) {
      if (String(err?.code) === 'ER_DUP_ENTRY') throw new ConflictError('Modifier option already exists in this group', 'MODIFIER_OPTION_DUPLICATE');
      throw err;
    }
  }

  async updateOption(id: number, organizationId: number, updates: Partial<Pick<ModifierOption, 'name'|'priceAdjustment'|'displayOrder'|'allowRepeat'|'isActive'>>): Promise<ModifierOption> {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_options WHERE id = ? AND organization_id = ?', [id, organizationId]);
    if (!rows.length) throw new NotFoundError('Modifier option not found', 'MODIFIER_OPTION_NOT_FOUND');
    const existing = mapOption(rows[0]);
    try {
      await this.pool().execute(
        `UPDATE modifier_options SET name = ?, price_adjustment = ?, display_order = ?, allow_repeat = ?, is_active = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?`,
        [updates.name?.trim() ?? existing.name, updates.priceAdjustment ?? existing.priceAdjustment, updates.displayOrder ?? existing.displayOrder, updates.allowRepeat ?? existing.allowRepeat, updates.isActive ?? existing.isActive, id, organizationId]
      );
      const [updated] = await this.pool().execute<RowDataPacket[]>('SELECT * FROM modifier_options WHERE id = ? AND organization_id = ?', [id, organizationId]);
      return mapOption(updated[0]);
    } catch (err: any) {
      if (String(err?.code) === 'ER_DUP_ENTRY') throw new ConflictError('Modifier option already exists in this group', 'MODIFIER_OPTION_DUPLICATE');
      throw err;
    }
  }

  async attachGroup(menuItemId: number, groupId: number, organizationId: number, displayOrder: number): Promise<void> {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [item] = await conn.execute<RowDataPacket[]>('SELECT id FROM menu_items WHERE id = ? AND organization_id = ? FOR UPDATE', [menuItemId, organizationId]);
      if (!item.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
      const [group] = await conn.execute<RowDataPacket[]>('SELECT id FROM modifier_groups WHERE id = ? AND organization_id = ? FOR UPDATE', [groupId, organizationId]);
      if (!group.length) throw new NotFoundError('Modifier group not found', 'MODIFIER_GROUP_NOT_FOUND');
      await conn.execute(
        `INSERT INTO menu_item_modifier_groups (organization_id, menu_item_id, modifier_group_id, display_order) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_order = VALUES(display_order)`,
        [organizationId, menuItemId, groupId, displayOrder]
      );
      await conn.commit();
    } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
  }

  async detachGroup(menuItemId: number, groupId: number, organizationId: number): Promise<void> {
    await this.pool().execute('DELETE FROM menu_item_modifier_groups WHERE organization_id = ? AND menu_item_id = ? AND modifier_group_id = ?', [organizationId, menuItemId, groupId]);
  }

  /** Resolve a menu item customization inside the same order transaction. */
  async resolveForOrder(
    conn: PoolConnection,
    menuItemId: number,
    organizationId: number,
    variantId: number | null,
    selections: ModifierSelectionInput[] | undefined
  ): Promise<ResolvedCustomization> {
    const [items] = await conn.execute<RowDataPacket[]>(
      `SELECT mi.id, mi.name, mi.entered_price, mi.price_entry_mode, mi.is_available FROM menu_items mi WHERE mi.id = ? AND mi.organization_id = ? FOR UPDATE`,
      [menuItemId, organizationId]
    );
    if (!items.length) throw new NotFoundError(`Menu item #${menuItemId} not found`, 'MENU_ITEM_NOT_FOUND');
    const menuItem = items[0];
    if (!menuItem.is_available) throw new BadRequestError(`Menu item "${menuItem.name}" is not available`, 'MENU_ITEM_UNAVAILABLE');

    const [variants] = await conn.execute<RowDataPacket[]>(
      `SELECT * FROM menu_item_variants WHERE menu_item_id = ? AND organization_id = ? AND is_active = TRUE ORDER BY display_order, id`,
      [menuItemId, organizationId]
    );
    if (variants.length > 0 && variantId == null) {
      throw new BadRequestError(`Variant selection is required for "${menuItem.name}"`, 'VARIANT_REQUIRED');
    }
    let chosenVariant: RowDataPacket | null = null;
    if (variantId != null) {
      const found = variants.find((row) => Number(row.id) === variantId);
      if (!found) throw new BadRequestError('Selected variant is invalid for this menu item', 'INVALID_VARIANT');
      chosenVariant = found;
    }

    const [groups] = await conn.execute<RowDataPacket[]>(
      `SELECT mg.* FROM modifier_groups mg
       INNER JOIN menu_item_modifier_groups mimg ON mimg.modifier_group_id = mg.id AND mimg.organization_id = mg.organization_id
       WHERE mimg.menu_item_id = ? AND mimg.organization_id = ? AND mg.is_active = TRUE
       ORDER BY mimg.display_order, mg.display_order, mg.id
       FOR UPDATE`,
      [menuItemId, organizationId]
    );
    const selectionsList = selections ?? [];
    const configuredGroupIds = new Set(groups.map((group) => Number(group.id)));
    const duplicateGroups = new Set<number>();
    for (const selection of selectionsList) {
      if (!configuredGroupIds.has(Number(selection.modifierGroupId))) {
        throw new BadRequestError('One or more modifier groups are invalid for this menu item', 'INVALID_MODIFIER_GROUP');
      }
      if (duplicateGroups.has(Number(selection.modifierGroupId))) {
        throw new BadRequestError('A modifier group may only be submitted once', 'DUPLICATE_MODIFIER_GROUP');
      }
      duplicateGroups.add(Number(selection.modifierGroupId));
    }
    const inputByGroup = new Map(selectionsList.map((selection) => [selection.modifierGroupId, selection]));
    const modifierSnapshot: ResolvedCustomization['modifierSnapshot'] = [];
    let modifierTotal = 0;

    for (const group of groups) {
      const selection = inputByGroup.get(Number(group.id));
      const optionInputs = selection?.options ?? [];
      const quantityCount = optionInputs.reduce((sum, option) => sum + Math.max(1, Number(option.quantity ?? 1)), 0);
      if (quantityCount < Number(group.min_selections)) {
        throw new BadRequestError(`Select at least ${group.min_selections} option(s) for ${group.name}`, 'MODIFIER_MIN_SELECTIONS');
      }
      if (quantityCount > Number(group.max_selections)) {
        throw new BadRequestError(`Select no more than ${group.max_selections} option(s) for ${group.name}`, 'MODIFIER_MAX_SELECTIONS');
      }
      if (group.selection_mode === 'SINGLE' && quantityCount > 1) {
        throw new BadRequestError(`${group.name} allows only one selection`, 'MODIFIER_SINGLE_SELECT');
      }
      const optionIds = optionInputs.map((o) => Number(o.optionId));
      const uniqueOptionIds = [...new Set(optionIds)];
      const optionCounts = new Map<number, number>();
      for (const optionId of optionIds) optionCounts.set(optionId, (optionCounts.get(optionId) ?? 0) + 1);
      if (uniqueOptionIds.length > 0) {
        const placeholders = uniqueOptionIds.map(() => '?').join(',');
        const [options] = await conn.execute<RowDataPacket[]>(
          `SELECT * FROM modifier_options WHERE organization_id = ? AND modifier_group_id = ? AND id IN (${placeholders}) AND is_active = TRUE FOR UPDATE`,
          [organizationId, Number(group.id), ...uniqueOptionIds]
        );
        if (options.length !== uniqueOptionIds.length) throw new BadRequestError(`One or more selections in ${group.name} are invalid`, 'INVALID_MODIFIER_OPTION');
        const optionMap = new Map(options.map((o) => [Number(o.id), o]));
        for (const input of optionInputs) {
          const option = optionMap.get(Number(input.optionId))!;
          const qty = Math.max(1, Number(input.quantity ?? 1));
          const submittedCount = optionCounts.get(Number(input.optionId)) ?? 0;
          if ((qty > 1 || submittedCount > 1) && !option.allow_repeat) {
            throw new BadRequestError(`${option.name} cannot be selected more than once`, 'MODIFIER_REPEAT_NOT_ALLOWED');
          }
          const unitPrice = group.pricing_strategy === 'NO_CHARGE' ? 0 : group.pricing_strategy === 'SHARED_PRICE' ? Number(group.shared_price) : Number(option.price_adjustment);
          const lineTotal = multiplyMoney(unitPrice, qty);
          modifierTotal = addMoney(modifierTotal, lineTotal);
          modifierSnapshot.push({ groupId: Number(group.id), groupName: group.name, optionId: Number(option.id), optionName: option.name, quantity: qty, unitPrice, lineTotal });
        }
      }
    }

    const enteredPrice = Number(menuItem.entered_price);
    const variantPrice = chosenVariant ? Number(chosenVariant.price) : null;
    const effectiveEnteredPrice = chosenVariant ? (chosenVariant.price_mode === 'ADDITIONAL' ? addMoney(enteredPrice, Number(chosenVariant.price)) : Number(chosenVariant.price)) : enteredPrice;
    return {
      variantId: chosenVariant ? Number(chosenVariant.id) : null,
      variantName: chosenVariant ? String(chosenVariant.name) : null,
      variantPrice,
      variantPriceMode: chosenVariant ? chosenVariant.price_mode as VariantPriceMode : null,
      enteredPrice: effectiveEnteredPrice,
      priceEntryMode: String(menuItem.price_entry_mode) as ResolvedCustomization['priceEntryMode'],
      modifierTotal,
      modifierSnapshot,
    };
  }
}

export const menuCustomizationRepository = new MenuCustomizationRepository();
