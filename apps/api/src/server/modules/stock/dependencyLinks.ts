import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { BadRequestError, NotFoundError } from '../../shared/errors';

export async function setMenuDependencies(
  menuItemId: number,
  organizationId: number,
  branchId: number,
  userId: number,
  dependencies: Array<{ stockItemId: number; quantityRequired: number }>,
): Promise<void> {
  const conn = await getDatabasePool().getConnection();
  try {
    await conn.beginTransaction();

    const [menuRows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM menu_items WHERE id=? AND organization_id=? FOR UPDATE',
      [menuItemId, organizationId],
    );
    if (!menuRows.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');

    const [existingRows] = await conn.execute<RowDataPacket[]>(
      `SELECT stock_item_id FROM stock_dependencies
        WHERE organization_id=? AND branch_id=? AND menu_item_id=? FOR UPDATE`,
      [organizationId, branchId, menuItemId],
    );
    const existingStockIds = new Set(existingRows.map((row) => Number(row.stock_item_id)));

    if (dependencies.length) {
      const requestedIds = dependencies.map((dependency) => dependency.stockItemId);
      const [stockRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, is_active FROM stock_items
          WHERE organization_id=? AND branch_id=? AND id IN (${requestedIds.map(() => '?').join(',')})
          FOR UPDATE`,
        [organizationId, branchId, ...requestedIds],
      );

      if (stockRows.length !== new Set(requestedIds).size) {
        throw new BadRequestError('One or more stock items are missing', 'INVALID_STOCK_DEPENDENCY');
      }

      const stockById = new Map(stockRows.map((row) => [Number(row.id), Boolean(row.is_active)]));
      const addsInactiveLink = requestedIds.some((id) => !stockById.get(id) && !existingStockIds.has(id));
      if (addsInactiveLink) {
        throw new BadRequestError('Inactive stock items cannot be linked to new menu items', 'STOCK_ITEM_INACTIVE');
      }
    }

    await conn.execute<ResultSetHeader>(
      `DELETE FROM stock_dependencies
        WHERE organization_id=? AND branch_id=? AND menu_item_id=?`,
      [organizationId, branchId, menuItemId],
    );

    for (const dependency of dependencies) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO stock_dependencies
          (organization_id,branch_id,menu_item_id,stock_item_id,quantity_required,created_by)
         VALUES(?,?,?,?,?,?)`,
        [organizationId, branchId, menuItemId, dependency.stockItemId, dependency.quantityRequired, userId],
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
