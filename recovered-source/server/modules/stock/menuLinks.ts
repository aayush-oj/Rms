import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, NotFoundError } from '../../shared/errors';

export interface StockMenuLink {
  menuItemId: number;
  menuItemName: string;
  isCombo: boolean;
  quantityRequired: number;
}

export async function menuLinksForStock(
  stockItemId: number,
  organizationId: number,
  branchId: number,
): Promise<StockMenuLink[]> {
  const pool = getDatabasePool();
  const [stockRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id FROM stock_items
      WHERE id=? AND organization_id=? AND branch_id=?`,
    [stockItemId, organizationId, branchId],
  );
  if (!stockRows.length) throw new NotFoundError('Stock item not found', 'STOCK_ITEM_NOT_FOUND');

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT d.menu_item_id, mi.name AS menu_item_name, mi.is_combo, d.quantity_required
       FROM stock_dependencies d
       JOIN menu_items mi ON mi.id=d.menu_item_id AND mi.organization_id=d.organization_id
      WHERE d.organization_id=? AND d.branch_id=? AND d.stock_item_id=?
      ORDER BY mi.name, mi.id`,
    [organizationId, branchId, stockItemId],
  );

  return rows.map((row) => ({
    menuItemId: Number(row.menu_item_id),
    menuItemName: String(row.menu_item_name),
    isCombo: Boolean(row.is_combo),
    quantityRequired: Number(row.quantity_required),
  }));
}

export async function setMenuLinksForStock(
  stockItemId: number,
  organizationId: number,
  branchId: number,
  userId: number,
  links: Array<{ menuItemId: number; quantityRequired: number }>,
): Promise<void> {
  const conn = await getDatabasePool().getConnection();
  try {
    await conn.beginTransaction();

    const [stockRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, is_active FROM stock_items
        WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE`,
      [stockItemId, organizationId, branchId],
    );
    if (!stockRows.length) throw new NotFoundError('Stock item not found', 'STOCK_ITEM_NOT_FOUND');

    const [existingRows] = await conn.execute<RowDataPacket[]>(
      `SELECT menu_item_id FROM stock_dependencies
        WHERE organization_id=? AND branch_id=? AND stock_item_id=? FOR UPDATE`,
      [organizationId, branchId, stockItemId],
    );
    const existingMenuIds = new Set(existingRows.map((row) => Number(row.menu_item_id)));

    if (!Boolean(stockRows[0].is_active)) {
      const addsNewLink = links.some((link) => !existingMenuIds.has(link.menuItemId));
      if (addsNewLink) {
        throw new BadRequestError('Inactive stock items cannot be linked to new menu items', 'STOCK_ITEM_INACTIVE');
      }
    }

    if (links.length) {
      const menuIds = links.map((link) => link.menuItemId);
      const [menuRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM menu_items
          WHERE organization_id=? AND id IN (${menuIds.map(() => '?').join(',')})
          FOR UPDATE`,
        [organizationId, ...menuIds],
      );
      if (menuRows.length !== new Set(menuIds).size) {
        throw new BadRequestError('One or more menu items are missing', 'INVALID_MENU_STOCK_LINK');
      }
    }

    await conn.execute<ResultSetHeader>(
      `DELETE FROM stock_dependencies
        WHERE organization_id=? AND branch_id=? AND stock_item_id=?`,
      [organizationId, branchId, stockItemId],
    );

    for (const link of links) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO stock_dependencies
          (organization_id,branch_id,menu_item_id,stock_item_id,quantity_required,created_by)
         VALUES(?,?,?,?,?,?)`,
        [organizationId, branchId, link.menuItemId, stockItemId, link.quantityRequired, userId],
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
