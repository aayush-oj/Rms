import { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { BadRequestError, ConflictError } from '../../shared/errors';

export interface ComboKotItem {
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

async function resolveStation(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  menuItem: RowDataPacket,
): Promise<{ id: number | null; name: string | null }> {
  if (menuItem.default_prep_station_id != null) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id, name FROM preparation_stations WHERE id = ? AND organization_id = ? AND branch_id = ? AND is_active = TRUE',
      [menuItem.default_prep_station_id, organizationId, branchId],
    );
    if (rows.length) return { id: Number(rows[0].id), name: String(rows[0].name) };
  }
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT ps.id, ps.name
       FROM menu_categories mc
       LEFT JOIN preparation_stations ps ON ps.id = mc.station_id
      WHERE mc.id = ? AND mc.organization_id = ?
        AND (ps.branch_id = ? OR ps.id IS NULL)
      LIMIT 1`,
    [menuItem.category_id, organizationId, branchId],
  );
  if (rows.length && rows[0].id != null) return { id: Number(rows[0].id), name: String(rows[0].name) };
  return { id: null, name: null };
}

export async function buildComboKotItems(
  conn: PoolConnection,
  organizationId: number,
  branchId: number,
  comboMenuItemId: number,
  comboName: string,
  orderQuantity: number,
  notes?: string | null,
): Promise<ComboKotItem[]> {
  const [components] = await conn.execute<RowDataPacket[]>(
    `SELECT cc.quantity AS component_quantity,
            mi.id, mi.name, mi.category_id, mi.default_prep_station_id,
            mi.prep_time_minutes, mi.is_available, mi.is_combo
       FROM menu_combo_components cc
       JOIN menu_items mi
         ON mi.id = cc.component_menu_item_id
        AND mi.organization_id = cc.organization_id
      WHERE cc.organization_id = ? AND cc.combo_menu_item_id = ?
      ORDER BY cc.display_order, cc.id
      FOR UPDATE`,
    [organizationId, comboMenuItemId],
  );
  if (components.length < 2) {
    throw new BadRequestError(`Combo "${comboName}" needs at least two configured items`, 'COMBO_COMPONENTS_REQUIRED');
  }

  const result: ComboKotItem[] = [];
  for (const component of components) {
    if (Boolean(component.is_combo)) {
      throw new BadRequestError('Nested combos are not supported', 'COMBO_COMPONENT_NESTED_COMBO');
    }
    if (!Boolean(component.is_available)) {
      throw new ConflictError(
        `${String(component.name)} is unavailable, so ${comboName} cannot be ordered`,
        'COMBO_COMPONENT_UNAVAILABLE',
        { comboMenuItemId, componentMenuItemId: Number(component.id) },
      );
    }
    const station = await resolveStation(conn, organizationId, branchId, component);
    result.push({
      menuItemId: Number(component.id),
      itemNameSnapshot: String(component.name),
      variantNameSnapshot: null,
      modifierSummary: `Combo: ${comboName}`,
      quantity: orderQuantity * Number(component.component_quantity),
      notes: notes || undefined,
      prepStationId: station.id,
      prepStationName: station.name,
      prepTimeMinutesSnapshot: component.prep_time_minutes == null ? null : Number(component.prep_time_minutes),
    });
  }
  return result;
}
