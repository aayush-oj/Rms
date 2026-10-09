import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabasePool } from '../../db/pool';
import { inventoryRepository } from '../inventory/repository';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors';
import { convertQuantity, recipeCostMetrics, round6 } from './calculations';
import { ConsumptionIngredientSnapshot, RecipeView, RecipeVersionView } from './types';
import { calculateMenuPrice, type PriceEntryMode, type RoundingMethod } from '../../domain/pricing';

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);
const nullableIso = (value: unknown): string | null => value == null ? null : iso(value);

interface UnitRow { id: number; symbol: string; dimension: string; conversionFactor: number; }

export class RecipeRepository {
  private pool() { return getDatabasePool(); }

  private async assertBranch(conn: PoolConnection, organizationId: number, branchId: number) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM branches WHERE id = ? AND organization_id = ? AND is_active = TRUE',
      [branchId, organizationId]
    );
    if (!rows.length) throw new BadRequestError('Active branch is invalid for this organization', 'INVALID_RECIPE_BRANCH');
  }

  private async unit(conn: PoolConnection, organizationId: number, unitId: number): Promise<UnitRow> {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, symbol, dimension, conversion_factor
       FROM units_of_measure
       WHERE id = ? AND is_active = TRUE AND (organization_id IS NULL OR organization_id = ?)`,
      [unitId, organizationId]
    );
    if (!rows.length) throw new BadRequestError('Invalid or inactive unit of measure', 'INVALID_RECIPE_UNIT');
    return { id: Number(rows[0].id), symbol: String(rows[0].symbol), dimension: String(rows[0].dimension), conversionFactor: Number(rows[0].conversion_factor) };
  }

  private async assertYieldUnit(conn: PoolConnection, organizationId: number, unitId: number) {
    const unit = await this.unit(conn, organizationId, unitId);
    if (unit.dimension !== 'COUNT') throw new BadRequestError('Recipe yield must use a count/portion-compatible unit', 'INVALID_RECIPE_YIELD_UNIT');
    return unit;
  }

  private async validateIngredient(
    conn: PoolConnection,
    organizationId: number,
    branchId: number,
    inventoryItemId: number,
    locationId: number,
    recipeUnitId: number
  ) {
    const [items] = await conn.execute<RowDataPacket[]>(
      `SELECT ii.id, ii.name, ii.unit_id, iu.symbol inventory_unit_symbol, iu.dimension inventory_dimension, iu.conversion_factor inventory_factor
       FROM inventory_items ii
       JOIN units_of_measure iu ON iu.id = ii.unit_id
       WHERE ii.id = ? AND ii.organization_id = ? AND ii.branch_id = ? AND ii.is_active = TRUE`,
      [inventoryItemId, organizationId, branchId]
    );
    if (!items.length) throw new BadRequestError('Ingredient inventory item is invalid for this branch', 'INVALID_RECIPE_INGREDIENT');
    const [locations] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM inventory_locations WHERE id = ? AND organization_id = ? AND branch_id = ? AND is_active = TRUE`,
      [locationId, organizationId, branchId]
    );
    if (!locations.length) throw new BadRequestError('Ingredient stock location is invalid for this branch', 'INVALID_RECIPE_LOCATION');
    const sourceUnit = await this.unit(conn, organizationId, recipeUnitId);
    if (sourceUnit.dimension !== String(items[0].inventory_dimension)) {
      throw new BadRequestError(
        `Unit ${sourceUnit.symbol} is incompatible with inventory unit ${items[0].inventory_unit_symbol}`,
        'INCOMPATIBLE_RECIPE_UNIT'
      );
    }
    return { item: items[0], sourceUnit };
  }

  private menuPricing(row: RowDataPacket) {
    return calculateMenuPrice(Number(row.entered_price || 0), String(row.price_entry_mode || 'VAT_INCLUDED') as PriceEntryMode, {
      isVatRegistered: Boolean(row.is_vat_registered),
      vatRate: Number(row.vat_rate || 0),
      roundingMethod: String(row.rounding_method || 'HALF_EVEN') as RoundingMethod,
    });
  }

  private netSellingPrice(row: RowDataPacket): number {
    return round6(this.menuPricing(row).priceBeforeVat);
  }

  async list(organizationId: number, branchId: number, filter: any = {}): Promise<RecipeView[]> {
    const clauses = ['r.organization_id = ?', 'r.branch_id = ?'];
    const params: any[] = [organizationId, branchId];
    if (filter.search) { clauses.push('(r.name LIKE ? OR mi.name LIKE ?)'); params.push(`%${filter.search}%`, `%${filter.search}%`); }
    if (filter.status) { clauses.push('r.status = ?'); params.push(filter.status); }
    if (filter.classification) { clauses.push('mi.item_classification = ?'); params.push(filter.classification); }
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT r.*, mi.name menu_item_name, mi.entered_price, mi.price_entry_mode, mi.item_classification,
              mc.name category_name, rv.version_number active_version_number, rv.yield_quantity,
              btc.is_vat_registered, btc.vat_rate, btc.rounding_method,
              COALESCE(SUM(
                CASE WHEN rvi.id IS NULL THEN 0 ELSE
                  rvi.quantity * ru.conversion_factor / iu.conversion_factor * ii.cost_per_unit
                END
              ),0) batch_cost
       FROM recipes r
       JOIN menu_items mi ON mi.id = r.menu_item_id AND mi.organization_id = r.organization_id
       LEFT JOIN menu_categories mc ON mc.id = mi.category_id AND mc.organization_id = r.organization_id
       LEFT JOIN recipe_versions rv ON rv.id = r.active_version_id
       LEFT JOIN recipe_version_ingredients rvi ON rvi.recipe_version_id = rv.id
       LEFT JOIN inventory_items ii ON ii.id = rvi.inventory_item_id
       LEFT JOIN units_of_measure ru ON ru.id = rvi.unit_id
       LEFT JOIN units_of_measure iu ON iu.id = ii.unit_id
       LEFT JOIN branch_tax_configs btc ON btc.organization_id = r.organization_id AND btc.branch_id = r.branch_id
       WHERE ${clauses.join(' AND ')}
       GROUP BY r.id, mi.id, mc.id, rv.id, btc.branch_id
       ORDER BY r.status = 'ACTIVE' DESC, mi.name`,
      params
    );
    return rows.map((row) => {
      const active = row.active_version_id != null && Number(row.yield_quantity) > 0;
      const metrics = active ? recipeCostMetrics(Number(row.batch_cost), Number(row.yield_quantity), this.netSellingPrice(row)) : null;
      return {
        id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id),
        menuItemId: Number(row.menu_item_id), menuItemName: String(row.menu_item_name),
        categoryName: row.category_name == null ? null : String(row.category_name),
        itemClassification: row.item_classification,
        sellingPrice: this.menuPricing(row).customerPrice, name: String(row.name), description: row.description == null ? null : String(row.description),
        status: row.status, activeVersionId: row.active_version_id == null ? null : Number(row.active_version_id),
        activeVersionNumber: row.active_version_number == null ? null : Number(row.active_version_number),
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), costing: metrics,
      } as RecipeView;
    });
  }

  async get(organizationId: number, branchId: number, id: number) {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT r.*, mi.name menu_item_name, mi.entered_price, mi.price_entry_mode, mi.item_classification, mc.name category_name,
              btc.is_vat_registered, btc.vat_rate, btc.rounding_method
       FROM recipes r
       JOIN menu_items mi ON mi.id=r.menu_item_id AND mi.organization_id=r.organization_id
       LEFT JOIN menu_categories mc ON mc.id=mi.category_id
       LEFT JOIN branch_tax_configs btc ON btc.organization_id=r.organization_id AND btc.branch_id=r.branch_id
       WHERE r.id=? AND r.organization_id=? AND r.branch_id=?`,
      [id, organizationId, branchId]
    );
    if (!rows.length) throw new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
    const row = rows[0];
    const versions = await this.versions(organizationId, branchId, id);
    const activeVersion = versions.find(v => v.id === Number(row.active_version_id));
    let costing = null;
    if (activeVersion) {
      const batchCost = activeVersion.ingredients.reduce((sum, i) => sum + i.currentLineCost, 0);
      costing = recipeCostMetrics(batchCost, activeVersion.yieldQuantity, this.netSellingPrice(row));
    }
    return {
      id: Number(row.id), organizationId: Number(row.organization_id), branchId: Number(row.branch_id), menuItemId: Number(row.menu_item_id),
      menuItemName: String(row.menu_item_name), categoryName: row.category_name == null ? null : String(row.category_name), itemClassification: row.item_classification,
      sellingPrice: this.menuPricing(row).customerPrice, name: String(row.name), description: row.description == null ? null : String(row.description), status: row.status,
      activeVersionId: row.active_version_id == null ? null : Number(row.active_version_id), activeVersionNumber: activeVersion?.versionNumber ?? null,
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), costing, versions,
    };
  }

  async create(organizationId: number, branchId: number, userId: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await this.assertBranch(conn, organizationId, branchId);
      const [menuRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, name FROM menu_items WHERE id=? AND organization_id=? FOR UPDATE`, [data.menuItemId, organizationId]
      );
      if (!menuRows.length) throw new BadRequestError('Menu item does not belong to this organization', 'INVALID_RECIPE_MENU_ITEM');
      await this.assertYieldUnit(conn, organizationId, data.yieldUnitId);
      const [recipeResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO recipes (organization_id,branch_id,menu_item_id,name,description,status,created_by)
         VALUES (?,?,?,?,?,'DRAFT',?)`,
        [organizationId, branchId, data.menuItemId, data.name, data.description ?? null, userId]
      );
      await conn.execute(
        `INSERT INTO recipe_versions (recipe_id,organization_id,branch_id,version_number,status,yield_quantity,yield_unit_id,created_by)
         VALUES (?,?,?,1,'DRAFT',?,?,?)`,
        [recipeResult.insertId, organizationId, branchId, data.yieldQuantity, data.yieldUnitId, userId]
      );
      await conn.commit();
      return this.get(organizationId, branchId, Number(recipeResult.insertId));
    } catch (error: any) {
      await conn.rollback();
      if (error?.errno === 1062) throw new ConflictError('This menu item already has a recipe for the active branch', 'RECIPE_ALREADY_EXISTS');
      throw error;
    } finally { conn.release(); }
  }

  async update(organizationId: number, branchId: number, id: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM recipes WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE', [id, organizationId, branchId]
      );
      if (!rows.length) throw new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
      const current = rows[0];
      await conn.execute(
        'UPDATE recipes SET name=?,description=?,updated_at=NOW() WHERE id=?',
        [data.name ?? current.name, data.description !== undefined ? data.description : current.description, id]
      );
      if (data.itemClassification) {
        await conn.execute(
          'UPDATE menu_items SET item_classification=?,updated_at=NOW() WHERE id=? AND organization_id=?',
          [data.itemClassification, current.menu_item_id, organizationId]
        );
      }
      await conn.commit();
      return this.get(organizationId, branchId, id);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async archive(organizationId: number, branchId: number, id: number) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT id FROM recipes WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE', [id, organizationId, branchId]);
      if (!rows.length) throw new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
      await conn.execute(`UPDATE recipe_versions SET status='ARCHIVED' WHERE recipe_id=? AND status='ACTIVE'`, [id]);
      await conn.execute(`UPDATE recipes SET status='ARCHIVED',active_version_id=NULL,updated_at=NOW() WHERE id=?`, [id]);
      await conn.commit();
      return this.get(organizationId, branchId, id);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async versions(organizationId: number, branchId: number, recipeId: number): Promise<RecipeVersionView[]> {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT rv.*, u.symbol yield_unit_symbol FROM recipe_versions rv
       JOIN units_of_measure u ON u.id=rv.yield_unit_id
       WHERE rv.recipe_id=? AND rv.organization_id=? AND rv.branch_id=? ORDER BY rv.version_number DESC`,
      [recipeId, organizationId, branchId]
    );
    const result: RecipeVersionView[] = [];
    for (const row of rows) {
      const [ingredients] = await this.pool().execute<RowDataPacket[]>(
        `SELECT rvi.*, ii.name inventory_item_name, ii.unit_id inventory_unit_id, ii.cost_per_unit,
                il.name location_name, ru.symbol unit_symbol, ru.dimension recipe_dimension, ru.conversion_factor recipe_factor,
                iu.symbol inventory_unit_symbol, iu.dimension inventory_dimension, iu.conversion_factor inventory_factor
         FROM recipe_version_ingredients rvi
         JOIN inventory_items ii ON ii.id=rvi.inventory_item_id AND ii.organization_id=rvi.organization_id AND ii.branch_id=rvi.branch_id
         JOIN inventory_locations il ON il.id=rvi.location_id AND il.organization_id=rvi.organization_id AND il.branch_id=rvi.branch_id
         JOIN units_of_measure ru ON ru.id=rvi.unit_id
         JOIN units_of_measure iu ON iu.id=ii.unit_id
         WHERE rvi.recipe_version_id=? AND rvi.organization_id=? AND rvi.branch_id=? ORDER BY ii.name`,
        [row.id, organizationId, branchId]
      );
      result.push({
        id: Number(row.id), versionNumber: Number(row.version_number), status: row.status, yieldQuantity: Number(row.yield_quantity),
        yieldUnitId: Number(row.yield_unit_id), yieldUnitSymbol: String(row.yield_unit_symbol), effectiveFrom: nullableIso(row.effective_from),
        notes: row.notes == null ? null : String(row.notes), createdAt: iso(row.created_at), activatedAt: nullableIso(row.activated_at),
        ingredients: ingredients.map((i) => {
          const normalized = convertQuantity(Number(i.quantity), { id: Number(i.unit_id), dimension: String(i.recipe_dimension), conversionFactor: Number(i.recipe_factor) }, { id: Number(i.inventory_unit_id), dimension: String(i.inventory_dimension), conversionFactor: Number(i.inventory_factor) });
          const lineCost = round6(normalized * Number(i.cost_per_unit));
          return { id: Number(i.id), inventoryItemId: Number(i.inventory_item_id), inventoryItemName: String(i.inventory_item_name), locationId: Number(i.location_id), locationName: String(i.location_name), quantity: Number(i.quantity), unitId: Number(i.unit_id), unitSymbol: String(i.unit_symbol), inventoryUnitId: Number(i.inventory_unit_id), inventoryUnitSymbol: String(i.inventory_unit_symbol), normalizedQuantity: normalized, currentUnitCost: Number(i.cost_per_unit), currentLineCost: lineCost };
        }),
      });
    }
    return result;
  }

  async createVersion(organizationId: number, branchId: number, recipeId: number, userId: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [recipeRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM recipes WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE', [recipeId, organizationId, branchId]);
      if (!recipeRows.length) throw new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
      if (recipeRows[0].status === 'ARCHIVED') throw new ConflictError('Archived recipes cannot receive new versions', 'RECIPE_ARCHIVED');
      await this.assertYieldUnit(conn, organizationId, data.yieldUnitId);
      const [numberRows] = await conn.execute<RowDataPacket[]>('SELECT COALESCE(MAX(version_number),0)+1 next_version FROM recipe_versions WHERE recipe_id=? FOR UPDATE', [recipeId]);
      const versionNumber = Number(numberRows[0].next_version);
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO recipe_versions(recipe_id,organization_id,branch_id,version_number,status,yield_quantity,yield_unit_id,effective_from,notes,created_by)
         VALUES(?,?,?,?,'DRAFT',?,?,?,?,?)`,
        [recipeId, organizationId, branchId, versionNumber, data.yieldQuantity, data.yieldUnitId, data.effectiveFrom ?? null, data.notes ?? null, userId]
      );
      // New versions start as a copy of the active version, which makes safe editing practical.
      if (recipeRows[0].active_version_id != null) {
        await conn.execute(
          `INSERT INTO recipe_version_ingredients(recipe_version_id,organization_id,branch_id,inventory_item_id,location_id,quantity,unit_id)
           SELECT ?,organization_id,branch_id,inventory_item_id,location_id,quantity,unit_id
           FROM recipe_version_ingredients WHERE recipe_version_id=?`,
          [result.insertId, recipeRows[0].active_version_id]
        );
      }
      await conn.commit();
      return (await this.versions(organizationId, branchId, recipeId)).find(v => v.id === Number(result.insertId));
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async updateVersion(organizationId: number, branchId: number, recipeId: number, versionId: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<RowDataPacket[]>(
        'SELECT * FROM recipe_versions WHERE id=? AND recipe_id=? AND organization_id=? AND branch_id=? FOR UPDATE',
        [versionId, recipeId, organizationId, branchId]
      );
      if (!rows.length) throw new NotFoundError('Recipe version not found', 'RECIPE_VERSION_NOT_FOUND');
      if (rows[0].status !== 'DRAFT') throw new ConflictError('Only draft recipe versions can be edited; create a new version instead', 'RECIPE_VERSION_IMMUTABLE');
      if (data.yieldUnitId !== undefined) await this.assertYieldUnit(conn, organizationId, data.yieldUnitId);
      await conn.execute(
        `UPDATE recipe_versions SET yield_quantity=?,yield_unit_id=?,effective_from=?,notes=? WHERE id=?`,
        [data.yieldQuantity ?? rows[0].yield_quantity, data.yieldUnitId ?? rows[0].yield_unit_id, data.effectiveFrom !== undefined ? data.effectiveFrom : rows[0].effective_from, data.notes !== undefined ? data.notes : rows[0].notes, versionId]
      );
      await conn.commit();
      return (await this.versions(organizationId, branchId, recipeId)).find(v => v.id === versionId);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  private async draftVersion(conn: PoolConnection, organizationId: number, branchId: number, recipeId: number, versionId: number) {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT rv.* FROM recipe_versions rv JOIN recipes r ON r.id=rv.recipe_id
       WHERE rv.id=? AND rv.recipe_id=? AND rv.organization_id=? AND rv.branch_id=? AND r.organization_id=? AND r.branch_id=? FOR UPDATE`,
      [versionId, recipeId, organizationId, branchId, organizationId, branchId]
    );
    if (!rows.length) throw new NotFoundError('Recipe version not found', 'RECIPE_VERSION_NOT_FOUND');
    if (rows[0].status !== 'DRAFT') throw new ConflictError('Only draft recipe versions can be changed', 'RECIPE_VERSION_IMMUTABLE');
    return rows[0];
  }

  async addIngredient(organizationId: number, branchId: number, recipeId: number, versionId: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await this.draftVersion(conn, organizationId, branchId, recipeId, versionId);
      await this.validateIngredient(conn, organizationId, branchId, data.inventoryItemId, data.locationId, data.unitId);
      await conn.execute(
        `INSERT INTO recipe_version_ingredients(recipe_version_id,organization_id,branch_id,inventory_item_id,location_id,quantity,unit_id)
         VALUES(?,?,?,?,?,?,?)`,
        [versionId, organizationId, branchId, data.inventoryItemId, data.locationId, data.quantity, data.unitId]
      );
      await conn.commit();
      return (await this.versions(organizationId, branchId, recipeId)).find(v => v.id === versionId);
    } catch (error: any) {
      await conn.rollback();
      if (error?.errno === 1062) throw new ConflictError('Ingredient already exists in this recipe version/location', 'DUPLICATE_RECIPE_INGREDIENT');
      throw error;
    } finally { conn.release(); }
  }

  async updateIngredient(organizationId: number, branchId: number, recipeId: number, versionId: number, ingredientId: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await this.draftVersion(conn, organizationId, branchId, recipeId, versionId);
      const [rows] = await conn.execute<RowDataPacket[]>('SELECT * FROM recipe_version_ingredients WHERE id=? AND recipe_version_id=? FOR UPDATE', [ingredientId, versionId]);
      if (!rows.length) throw new NotFoundError('Recipe ingredient not found', 'RECIPE_INGREDIENT_NOT_FOUND');
      const current = rows[0];
      const locationId = data.locationId ?? Number(current.location_id);
      const unitId = data.unitId ?? Number(current.unit_id);
      await this.validateIngredient(conn, organizationId, branchId, Number(current.inventory_item_id), locationId, unitId);
      await conn.execute('UPDATE recipe_version_ingredients SET location_id=?,quantity=?,unit_id=?,updated_at=NOW() WHERE id=?', [locationId, data.quantity ?? current.quantity, unitId, ingredientId]);
      await conn.commit();
      return (await this.versions(organizationId, branchId, recipeId)).find(v => v.id === versionId);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async deleteIngredient(organizationId: number, branchId: number, recipeId: number, versionId: number, ingredientId: number) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      await this.draftVersion(conn, organizationId, branchId, recipeId, versionId);
      const [result] = await conn.execute<ResultSetHeader>('DELETE FROM recipe_version_ingredients WHERE id=? AND recipe_version_id=? AND organization_id=? AND branch_id=?', [ingredientId, versionId, organizationId, branchId]);
      if (!result.affectedRows) throw new NotFoundError('Recipe ingredient not found', 'RECIPE_INGREDIENT_NOT_FOUND');
      await conn.commit();
      return { deleted: true };
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async activateVersion(organizationId: number, branchId: number, recipeId: number, versionId: number) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [recipeRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM recipes WHERE id=? AND organization_id=? AND branch_id=? FOR UPDATE', [recipeId, organizationId, branchId]);
      if (!recipeRows.length) throw new NotFoundError('Recipe not found', 'RECIPE_NOT_FOUND');
      if (recipeRows[0].status === 'ARCHIVED') throw new ConflictError('Archived recipes cannot be activated', 'RECIPE_ARCHIVED');
      const [versionRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM recipe_versions WHERE id=? AND recipe_id=? AND organization_id=? AND branch_id=? FOR UPDATE', [versionId, recipeId, organizationId, branchId]);
      if (!versionRows.length) throw new NotFoundError('Recipe version not found', 'RECIPE_VERSION_NOT_FOUND');
      if (versionRows[0].status !== 'DRAFT') throw new ConflictError('Only a draft version can be activated', 'RECIPE_VERSION_NOT_DRAFT');
      const [ingredientRows] = await conn.execute<RowDataPacket[]>('SELECT * FROM recipe_version_ingredients WHERE recipe_version_id=? FOR UPDATE', [versionId]);
      if (!ingredientRows.length) throw new BadRequestError('A recipe must contain at least one ingredient before activation', 'RECIPE_HAS_NO_INGREDIENTS');
      for (const ingredient of ingredientRows) {
        await this.validateIngredient(conn, organizationId, branchId, Number(ingredient.inventory_item_id), Number(ingredient.location_id), Number(ingredient.unit_id));
      }
      await conn.execute(`UPDATE recipe_versions SET status='ARCHIVED' WHERE recipe_id=? AND status='ACTIVE'`, [recipeId]);
      await conn.execute(`UPDATE recipe_versions SET status='ACTIVE',effective_from=COALESCE(effective_from,NOW()),activated_at=NOW() WHERE id=?`, [versionId]);
      await conn.execute(`UPDATE recipes SET status='ACTIVE',active_version_id=?,updated_at=NOW() WHERE id=?`, [versionId, recipeId]);
      await conn.commit();
      return this.get(organizationId, branchId, recipeId);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async cost(organizationId: number, branchId: number, recipeId: number, versionId?: number) {
    const recipe = await this.get(organizationId, branchId, recipeId);
    const selected = versionId
      ? recipe.versions.find((v: RecipeVersionView) => v.id === versionId)
      : recipe.versions.find((v: RecipeVersionView) => v.id === recipe.activeVersionId);
    if (!selected) throw new NotFoundError('Recipe version not found for costing', 'RECIPE_VERSION_NOT_FOUND');

    const [pricingRows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT mi.entered_price,
              mi.price_entry_mode,
              btc.is_vat_registered,
              btc.vat_rate,
              btc.rounding_method
       FROM recipes r
       JOIN menu_items mi ON mi.id = r.menu_item_id AND mi.organization_id = r.organization_id
       LEFT JOIN branch_tax_configs btc ON btc.organization_id = r.organization_id AND btc.branch_id = r.branch_id
       WHERE r.id = ? AND r.organization_id = ? AND r.branch_id = ?`,
      [recipeId, organizationId, branchId]
    );
    if (!pricingRows.length) throw new NotFoundError('Recipe pricing context not found', 'RECIPE_PRICING_CONTEXT_NOT_FOUND');

    const batchCost = selected.ingredients.reduce((sum: number, i: any) => sum + i.currentLineCost, 0);
    return {
      recipeId,
      versionId: selected.id,
      versionNumber: selected.versionNumber,
      ...recipeCostMetrics(batchCost, selected.yieldQuantity, this.netSellingPrice(pricingRows[0])),
      ingredients: selected.ingredients,
    };
  }

  async menuItemCosting(organizationId: number, branchId: number, menuItemId: number) {
    const [rows] = await this.pool().execute<RowDataPacket[]>('SELECT id FROM recipes WHERE organization_id=? AND branch_id=? AND menu_item_id=?', [organizationId, branchId, menuItemId]);
    if (!rows.length) return { menuItemId, recipe: null, costing: null, directStock: await this.getDirectStockLink(organizationId, branchId, menuItemId) };
    const recipe = await this.get(organizationId, branchId, Number(rows[0].id));
    return { menuItemId, recipe: { id: recipe.id, name: recipe.name, status: recipe.status, activeVersionId: recipe.activeVersionId }, costing: recipe.costing, directStock: await this.getDirectStockLink(organizationId, branchId, menuItemId) };
  }

  async getDirectStockLink(organizationId: number, branchId: number, menuItemId: number) {
    const [rows] = await this.pool().execute<RowDataPacket[]>(
      `SELECT msl.*,ii.name inventory_item_name,il.name location_name,u.symbol unit_symbol
       FROM menu_item_stock_links msl JOIN inventory_items ii ON ii.id=msl.inventory_item_id
       JOIN inventory_locations il ON il.id=msl.location_id JOIN units_of_measure u ON u.id=msl.unit_id
       WHERE msl.organization_id=? AND msl.branch_id=? AND msl.menu_item_id=?`, [organizationId, branchId, menuItemId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { menuItemId, inventoryItemId: Number(r.inventory_item_id), inventoryItemName: String(r.inventory_item_name), locationId: Number(r.location_id), locationName: String(r.location_name), quantityPerSale: Number(r.quantity_per_sale), unitId: Number(r.unit_id), unitSymbol: String(r.unit_symbol), isActive: Boolean(r.is_active) };
  }

  async setDirectStockLink(organizationId: number, branchId: number, menuItemId: number, data: any) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [menuRows] = await conn.execute<RowDataPacket[]>('SELECT id FROM menu_items WHERE id=? AND organization_id=?', [menuItemId, organizationId]);
      if (!menuRows.length) throw new NotFoundError('Menu item not found', 'MENU_ITEM_NOT_FOUND');
      await this.validateIngredient(conn, organizationId, branchId, data.inventoryItemId, data.locationId, data.unitId);
      await conn.execute(
        `INSERT INTO menu_item_stock_links(organization_id,branch_id,menu_item_id,inventory_item_id,location_id,quantity_per_sale,unit_id,is_active)
         VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE inventory_item_id=VALUES(inventory_item_id),location_id=VALUES(location_id),quantity_per_sale=VALUES(quantity_per_sale),unit_id=VALUES(unit_id),is_active=VALUES(is_active)`,
        [organizationId, branchId, menuItemId, data.inventoryItemId, data.locationId, data.quantityPerSale, data.unitId, data.isActive ? 1 : 0]
      );
      await conn.commit();
      return this.getDirectStockLink(organizationId, branchId, menuItemId);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async replaceModifierImpacts(organizationId: number, branchId: number, optionId: number, impacts: any[]) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [options] = await conn.execute<RowDataPacket[]>('SELECT id FROM modifier_options WHERE id=? AND organization_id=?', [optionId, organizationId]);
      if (!options.length) throw new NotFoundError('Modifier option not found', 'MODIFIER_OPTION_NOT_FOUND');
      await conn.execute('DELETE FROM modifier_option_ingredient_impacts WHERE organization_id=? AND branch_id=? AND modifier_option_id=?', [organizationId, branchId, optionId]);
      for (const impact of impacts) {
        await this.validateIngredient(conn, organizationId, branchId, impact.inventoryItemId, impact.locationId, impact.unitId);
        await conn.execute(`INSERT INTO modifier_option_ingredient_impacts(organization_id,branch_id,modifier_option_id,inventory_item_id,location_id,quantity_delta,unit_id) VALUES(?,?,?,?,?,?,?)`, [organizationId, branchId, optionId, impact.inventoryItemId, impact.locationId, impact.quantityDelta, impact.unitId]);
      }
      await conn.commit();
      return this.modifierImpacts(organizationId, branchId, optionId);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async modifierImpacts(organizationId: number, branchId: number, optionId: number) {
    const [rows] = await this.pool().execute<RowDataPacket[]>(`SELECT m.*,ii.name inventory_item_name,il.name location_name,u.symbol unit_symbol FROM modifier_option_ingredient_impacts m JOIN inventory_items ii ON ii.id=m.inventory_item_id JOIN inventory_locations il ON il.id=m.location_id JOIN units_of_measure u ON u.id=m.unit_id WHERE m.organization_id=? AND m.branch_id=? AND m.modifier_option_id=? ORDER BY ii.name`, [organizationId, branchId, optionId]);
    return rows.map(r => ({ id: Number(r.id), inventoryItemId: Number(r.inventory_item_id), inventoryItemName: String(r.inventory_item_name), locationId: Number(r.location_id), locationName: String(r.location_name), quantityDelta: Number(r.quantity_delta), unitId: Number(r.unit_id), unitSymbol: String(r.unit_symbol) }));
  }

  async replaceVariantImpacts(organizationId: number, branchId: number, variantId: number, impacts: any[]) {
    const conn = await this.pool().getConnection();
    try {
      await conn.beginTransaction();
      const [variants] = await conn.execute<RowDataPacket[]>('SELECT id FROM menu_item_variants WHERE id=? AND organization_id=?', [variantId, organizationId]);
      if (!variants.length) throw new NotFoundError('Variant not found', 'VARIANT_NOT_FOUND');
      await conn.execute('DELETE FROM variant_ingredient_impacts WHERE organization_id=? AND branch_id=? AND variant_id=?', [organizationId, branchId, variantId]);
      for (const impact of impacts) {
        await this.validateIngredient(conn, organizationId, branchId, impact.inventoryItemId, impact.locationId, impact.unitId);
        await conn.execute(`INSERT INTO variant_ingredient_impacts(organization_id,branch_id,variant_id,inventory_item_id,location_id,quantity_delta,unit_id) VALUES(?,?,?,?,?,?,?)`, [organizationId, branchId, variantId, impact.inventoryItemId, impact.locationId, impact.quantityDelta, impact.unitId]);
      }
      await conn.commit();
      return this.variantImpacts(organizationId, branchId, variantId);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }

  async variantImpacts(organizationId: number, branchId: number, variantId: number) {
    const [rows] = await this.pool().execute<RowDataPacket[]>(`SELECT v.*,ii.name inventory_item_name,il.name location_name,u.symbol unit_symbol FROM variant_ingredient_impacts v JOIN inventory_items ii ON ii.id=v.inventory_item_id JOIN inventory_locations il ON il.id=v.location_id JOIN units_of_measure u ON u.id=v.unit_id WHERE v.organization_id=? AND v.branch_id=? AND v.variant_id=? ORDER BY ii.name`, [organizationId, branchId, variantId]);
    return rows.map(r => ({ id: Number(r.id), inventoryItemId: Number(r.inventory_item_id), inventoryItemName: String(r.inventory_item_name), locationId: Number(r.location_id), locationName: String(r.location_name), quantityDelta: Number(r.quantity_delta), unitId: Number(r.unit_id), unitSymbol: String(r.unit_symbol) }));
  }

  private async normalizeImpact(conn: PoolConnection, organizationId: number, branchId: number, row: any, multiplier: number) {
    const validated = await this.validateIngredient(conn, organizationId, branchId, Number(row.inventory_item_id), Number(row.location_id), Number(row.unit_id));
    const inventoryUnit: UnitRow = { id: Number(validated.item.unit_id), symbol: String(validated.item.inventory_unit_symbol), dimension: String(validated.item.inventory_dimension), conversionFactor: Number(validated.item.inventory_factor) };
    const normalized = convertQuantity(Math.abs(Number(row.quantity_delta)) * multiplier, validated.sourceUnit, inventoryUnit);
    return { inventoryItemId: Number(row.inventory_item_id), locationId: Number(row.location_id), delta: Number(row.quantity_delta) < 0 ? -normalized : normalized };
  }

  /** Called inside the authoritative order/KOT transaction. */
  async consumeOrderItemInTransaction(
    conn: PoolConnection,
    organizationId: number,
    branchId: number,
    orderId: number,
    orderItemId: number,
    menuItemId: number,
    saleQuantity: number,
    variantId: number | null,
    modifierSnapshot: Array<{ optionId: number; quantity: number }>,
    performedBy: number
  ): Promise<{ consumed: boolean; ingredients: ConsumptionIngredientSnapshot[] }> {
    const [existing] = await conn.execute<RowDataPacket[]>('SELECT id,status FROM inventory_consumption_events WHERE order_item_id=? FOR UPDATE', [orderItemId]);
    if (existing.length) return { consumed: existing[0].status === 'CONSUMED', ingredients: [] };

    const [recipeRows] = await conn.execute<RowDataPacket[]>(
      `SELECT r.id recipe_id,r.active_version_id,rv.yield_quantity
       FROM recipes r JOIN recipe_versions rv ON rv.id=r.active_version_id AND rv.status='ACTIVE'
       WHERE r.organization_id=? AND r.branch_id=? AND r.menu_item_id=? AND r.status='ACTIVE' FOR UPDATE`,
      [organizationId, branchId, menuItemId]
    );

    let recipeId: number | null = null;
    let versionId: number | null = null;
    let mode: 'RECIPE' | 'DIRECT_STOCK' | null = null;
    const quantities = new Map<string, { inventoryItemId: number; locationId: number; quantity: number }>();

    const add = (inventoryItemId: number, locationId: number, quantity: number) => {
      const key = `${inventoryItemId}:${locationId}`;
      const prev = quantities.get(key);
      quantities.set(key, { inventoryItemId, locationId, quantity: round6((prev?.quantity ?? 0) + quantity) });
    };

    if (recipeRows.length) {
      mode = 'RECIPE'; recipeId = Number(recipeRows[0].recipe_id); versionId = Number(recipeRows[0].active_version_id);
      const yieldQuantity = Number(recipeRows[0].yield_quantity);
      const [ingredients] = await conn.execute<RowDataPacket[]>(
        `SELECT rvi.*,ii.unit_id inventory_unit_id,iu.dimension inventory_dimension,iu.conversion_factor inventory_factor,iu.symbol inventory_unit_symbol,
                ru.dimension recipe_dimension,ru.conversion_factor recipe_factor,ru.symbol recipe_unit_symbol
         FROM recipe_version_ingredients rvi JOIN inventory_items ii ON ii.id=rvi.inventory_item_id
         JOIN units_of_measure iu ON iu.id=ii.unit_id JOIN units_of_measure ru ON ru.id=rvi.unit_id
         WHERE rvi.recipe_version_id=? AND rvi.organization_id=? AND rvi.branch_id=? FOR UPDATE`,
        [versionId, organizationId, branchId]
      );
      if (!ingredients.length) throw new ConflictError('Active recipe has no ingredients', 'ACTIVE_RECIPE_INVALID');
      for (const ingredient of ingredients) {
        const normalizedBatch = convertQuantity(Number(ingredient.quantity), { id: Number(ingredient.unit_id), dimension: String(ingredient.recipe_dimension), conversionFactor: Number(ingredient.recipe_factor) }, { id: Number(ingredient.inventory_unit_id), dimension: String(ingredient.inventory_dimension), conversionFactor: Number(ingredient.inventory_factor) });
        add(Number(ingredient.inventory_item_id), Number(ingredient.location_id), round6(normalizedBatch / yieldQuantity * saleQuantity));
      }

      if (variantId != null) {
        const [impacts] = await conn.execute<RowDataPacket[]>('SELECT * FROM variant_ingredient_impacts WHERE organization_id=? AND branch_id=? AND variant_id=?', [organizationId, branchId, variantId]);
        for (const impact of impacts) {
          const normalized = await this.normalizeImpact(conn, organizationId, branchId, impact, saleQuantity);
          add(normalized.inventoryItemId, normalized.locationId, normalized.delta);
        }
      }
      for (const modifier of modifierSnapshot || []) {
        const [impacts] = await conn.execute<RowDataPacket[]>('SELECT * FROM modifier_option_ingredient_impacts WHERE organization_id=? AND branch_id=? AND modifier_option_id=?', [organizationId, branchId, modifier.optionId]);
        for (const impact of impacts) {
          const normalized = await this.normalizeImpact(conn, organizationId, branchId, impact, saleQuantity * Math.max(1, Number(modifier.quantity || 1)));
          add(normalized.inventoryItemId, normalized.locationId, normalized.delta);
        }
      }
    } else {
      const [links] = await conn.execute<RowDataPacket[]>(
        `SELECT msl.*,ii.unit_id inventory_unit_id,iu.dimension inventory_dimension,iu.conversion_factor inventory_factor,
                lu.dimension link_dimension,lu.conversion_factor link_factor
         FROM menu_item_stock_links msl JOIN inventory_items ii ON ii.id=msl.inventory_item_id
         JOIN units_of_measure iu ON iu.id=ii.unit_id JOIN units_of_measure lu ON lu.id=msl.unit_id
         WHERE msl.organization_id=? AND msl.branch_id=? AND msl.menu_item_id=? AND msl.is_active=TRUE FOR UPDATE`,
        [organizationId, branchId, menuItemId]
      );
      if (!links.length) return { consumed: false, ingredients: [] };
      mode = 'DIRECT_STOCK';
      const link = links[0];
      const normalized = convertQuantity(Number(link.quantity_per_sale) * saleQuantity, { id: Number(link.unit_id), dimension: String(link.link_dimension), conversionFactor: Number(link.link_factor) }, { id: Number(link.inventory_unit_id), dimension: String(link.inventory_dimension), conversionFactor: Number(link.inventory_factor) });
      add(Number(link.inventory_item_id), Number(link.location_id), normalized);
    }

    const snapshots: ConsumptionIngredientSnapshot[] = [];
    let totalCost = 0;
    for (const entry of quantities.values()) {
      if (entry.quantity < 0) throw new ConflictError('Modifier/variant impacts produce a negative ingredient requirement', 'INVALID_INGREDIENT_IMPACT_TOTAL');
      if (entry.quantity === 0) continue;
      const [details] = await conn.execute<RowDataPacket[]>(
        `SELECT ii.name,ii.unit_id,ii.cost_per_unit,u.symbol,il.name location_name
         FROM inventory_items ii JOIN units_of_measure u ON u.id=ii.unit_id JOIN inventory_locations il ON il.id=?
         WHERE ii.id=? AND ii.organization_id=? AND ii.branch_id=? FOR UPDATE`,
        [entry.locationId, entry.inventoryItemId, organizationId, branchId]
      );
      if (!details.length) throw new ConflictError('Consumption ingredient is no longer valid for this branch', 'CONSUMPTION_INGREDIENT_INVALID');
      const unitCost = Number(details[0].cost_per_unit);
      const lineCost = round6(entry.quantity * unitCost);
      await inventoryRepository.mutateStock(organizationId, branchId, entry.inventoryItemId, entry.locationId, -entry.quantity, 'SALE_CONSUMPTION', `Order item ${orderItemId} sent to production`, performedBy, 'ORDER_ITEM', orderItemId, conn);
      snapshots.push({ inventoryItemId: entry.inventoryItemId, inventoryItemName: String(details[0].name), locationId: entry.locationId, locationName: String(details[0].location_name), quantity: entry.quantity, unitId: Number(details[0].unit_id), unitSymbol: String(details[0].symbol), unitCost, totalCost: lineCost });
      totalCost = round6(totalCost + lineCost);
    }

    if (!mode || !snapshots.length) return { consumed: false, ingredients: [] };
    const perPortion = round6(totalCost / saleQuantity);
    await conn.execute(
      `INSERT INTO order_item_recipe_snapshots(order_item_id,organization_id,branch_id,order_id,recipe_id,recipe_version_id,consumption_mode,recipe_cost_per_portion,total_cost_snapshot,expected_ingredients_json)
       VALUES(?,?,?,?,?,?,?,?,?,CAST(? AS JSON))`,
      [orderItemId, organizationId, branchId, orderId, recipeId, versionId, mode, perPortion, totalCost, JSON.stringify(snapshots)]
    );
    await conn.execute(
      `INSERT INTO inventory_consumption_events(organization_id,branch_id,order_id,order_item_id,recipe_version_id,status,consumed_by)
       VALUES(?,?,?,?,?,'CONSUMED',?)`,
      [organizationId, branchId, orderId, orderItemId, versionId, performedBy]
    );
    return { consumed: true, ingredients: snapshots };
  }

  async reverseOrderItemsConsumptionInTransaction(
    conn: PoolConnection,
    organizationId: number,
    branchId: number,
    orderId: number,
    orderItemIds: number[],
    performedBy: number,
    reason: string,
  ) {
    const uniqueItemIds = [...new Set(orderItemIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (!uniqueItemIds.length) return 0;
    const placeholders = uniqueItemIds.map(() => '?').join(',');
    const [events] = await conn.execute<RowDataPacket[]>(
      `SELECT ice.*,s.expected_ingredients_json FROM inventory_consumption_events ice
       JOIN order_item_recipe_snapshots s ON s.order_item_id=ice.order_item_id
       WHERE ice.organization_id=? AND ice.branch_id=? AND ice.order_id=?
         AND ice.order_item_id IN (${placeholders})
       FOR UPDATE`,
      [organizationId, branchId, orderId, ...uniqueItemIds],
    );
    let reversed = 0;
    for (const event of events) {
      if (event.status === 'REVERSED') continue;
      const ingredients: ConsumptionIngredientSnapshot[] =
        typeof event.expected_ingredients_json === 'string'
          ? JSON.parse(event.expected_ingredients_json)
          : event.expected_ingredients_json;
      for (const ingredient of ingredients) {
        await inventoryRepository.mutateStock(
          organizationId,
          branchId,
          ingredient.inventoryItemId,
          ingredient.locationId,
          ingredient.quantity,
          'SALE_CONSUMPTION_REVERSAL',
          `Cancellation reversal for order item ${event.order_item_id}`,
          performedBy,
          'ORDER_ITEM_REVERSAL',
          Number(event.order_item_id),
          conn,
        );
      }
      await conn.execute(
        `UPDATE inventory_consumption_events
            SET status='REVERSED',reversed_by=?,reversed_at=NOW(),reversal_reason=?
          WHERE id=?`,
        [performedBy, reason, event.id],
      );
      reversed += 1;
    }
    return reversed;
  }

  async reverseOrderConsumptionInTransaction(conn: PoolConnection, organizationId: number, branchId: number, orderId: number, performedBy: number, reason: string) {
    const [events] = await conn.execute<RowDataPacket[]>(
      `SELECT ice.*,s.expected_ingredients_json FROM inventory_consumption_events ice
       JOIN order_item_recipe_snapshots s ON s.order_item_id=ice.order_item_id
       WHERE ice.organization_id=? AND ice.branch_id=? AND ice.order_id=? FOR UPDATE`,
      [organizationId, branchId, orderId]
    );
    let reversed = 0;
    for (const event of events) {
      if (event.status === 'REVERSED') continue;
      const ingredients: ConsumptionIngredientSnapshot[] = typeof event.expected_ingredients_json === 'string' ? JSON.parse(event.expected_ingredients_json) : event.expected_ingredients_json;
      for (const ingredient of ingredients) {
        await inventoryRepository.mutateStock(organizationId, branchId, ingredient.inventoryItemId, ingredient.locationId, ingredient.quantity, 'SALE_CONSUMPTION_REVERSAL', `Cancellation reversal for order item ${event.order_item_id}`, performedBy, 'ORDER_ITEM_REVERSAL', Number(event.order_item_id), conn);
      }
      await conn.execute(`UPDATE inventory_consumption_events SET status='REVERSED',reversed_by=?,reversed_at=NOW(),reversal_reason=? WHERE id=?`, [performedBy, reason, event.id]);
      reversed += 1;
    }
    return reversed;
  }
}

export const recipeRepository = new RecipeRepository();
