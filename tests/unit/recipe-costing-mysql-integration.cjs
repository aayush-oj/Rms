'use strict';
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

process.env.DATABASE_HOST = process.env.P45_DB_HOST || process.env.DATABASE_HOST || '127.0.0.1';
process.env.DATABASE_PORT = process.env.P45_DB_PORT || process.env.DATABASE_PORT || '3306';
process.env.DATABASE_NAME = process.env.P45_DB_NAME || process.env.DATABASE_NAME || 'restrox_test';
process.env.DATABASE_USER = process.env.P45_DB_USER || process.env.DATABASE_USER || 'rms';
process.env.DATABASE_PASSWORD = process.env.P45_DB_PASSWORD || process.env.DATABASE_PASSWORD || 'p43-ci-db-password';

const pool = mysql.createPool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  connectionLimit: 4,
  decimalNumbers: true,
});
const { InventoryRepository } = require('../../apps/api/src/server/modules/inventory/repository.ts');
const { RecipeRepository } = require('../../apps/api/src/server/modules/recipe/repository.ts');
const { closeDatabasePool } = require('../../apps/api/src/server/db/pool.ts');
const inventory = new InventoryRepository(() => pool);
const recipes = new RecipeRepository();
const suffix = String(process.pid).replace(/[^0-9]/g, '').slice(-6) || '456789';

async function tenant(name, handle) {
  const [org] = await pool.execute("INSERT INTO organizations (name, handle, status) VALUES (?, ?, 'ACTIVE')", [name, handle]);
  const orgId = Number(org.insertId);
  const [branch] = await pool.execute('INSERT INTO branches (organization_id, name, code, is_active) VALUES (?, ?, ?, TRUE)', [orgId, 'Main branch', 'P45-01']);
  const branchId = Number(branch.insertId);
  await pool.execute("INSERT INTO organization_entitlements (organization_id, access_status) VALUES (?, 'ACTIVE')", [orgId]);
  const [roles] = await pool.execute("SELECT id FROM roles WHERE organization_id IS NULL AND name = 'OWNER' LIMIT 1");
  assert.ok(roles.length, 'global OWNER role must exist after migrations');
  const [user] = await pool.execute(
    'INSERT INTO users (organization_id, default_branch_id, role_id, name, username, is_active) VALUES (?, ?, ?, ?, ?, TRUE)',
    [orgId, branchId, Number(roles[0].id), 'P45 Recipe Owner', handle + '-owner'],
  );
  const [category] = await pool.execute(
    'INSERT INTO menu_categories (organization_id, name, is_active) VALUES (?, ?, TRUE)',
    [orgId, name + ' Menu'],
  );
  const menuCategoryId = Number(category.insertId);
  const [menu] = await pool.execute(
    'INSERT INTO menu_items (organization_id, category_id, name, sku, entered_price, is_available) VALUES (?, ?, ?, ?, ?, TRUE)',
    [orgId, menuCategoryId, name + ' Dish', handle + '-dish', 10],
  );
  return { orgId, branchId, userId: Number(user.insertId), menuCategoryId, menuItemId: Number(menu.insertId) };
}

async function main() {
  try {
    const [health] = await pool.query('SELECT 1 AS ok');
    assert.equal(Number(health[0].ok), 1, 'MySQL must be reachable');
    const a = await tenant('P45 Recipe A', 'p45a' + suffix);
    const b = await tenant('P45 Recipe B', 'p45b' + suffix);
    const [branches] = await pool.execute(
      'INSERT INTO branches (organization_id, name, code, is_active) VALUES (?, ?, ?, TRUE)',
      [a.orgId, 'Secondary branch', 'P45-02'],
    );
    const otherBranchId = Number(branches.insertId);
    const otherBranchLocation = await inventory.createLocation(a.orgId, otherBranchId, { name: 'P45 Other Branch Kitchen', code: 'P45-OTHER-KITCHEN', isActive: true });

    const [units] = await pool.execute(
      "SELECT id, symbol, dimension, conversion_factor FROM units_of_measure WHERE organization_id IS NULL AND is_active = TRUE AND symbol IN ('kg','g')",
    );
    const kg = units.find(u => String(u.symbol) === 'kg');
    const gram = units.find(u => String(u.symbol) === 'g');
    const [countUnits] = await pool.execute(
      "SELECT id FROM units_of_measure WHERE organization_id IS NULL AND is_active = TRUE AND dimension = 'COUNT' ORDER BY id LIMIT 1",
    );
    assert.ok(kg && gram && countUnits.length, 'global kg, g and count units must exist');
    assert.equal(String(kg.dimension), 'MASS');
    assert.equal(String(gram.dimension), 'MASS');
    const kgId = Number(kg.id);
    const gramId = Number(gram.id);
    const countUnitId = Number(countUnits[0].id);

    const inventoryCategory = await inventory.createCategory(a.orgId, a.branchId, { name: 'P45 Ingredients', code: 'P45-ING', isActive: true });
    const location = await inventory.createLocation(a.orgId, a.branchId, { name: 'P45 Kitchen', code: 'P45-KITCHEN', isActive: true });
    const item = await inventory.createItem(a.orgId, a.branchId, {
      name: 'P45 Flour', sku: 'P45-FLOUR-' + suffix, categoryId: inventoryCategory.id,
      unitId: kgId, costPerUnit: 4, reorderPoint: 0, reorderQuantity: 0, isActive: true,
    });
    const recipe = await recipes.create(a.orgId, a.branchId, a.userId, {
      menuItemId: a.menuItemId, name: 'P45 Test Recipe', yieldQuantity: 1, yieldUnitId: countUnitId,
    });
    const version = recipe.versions.find(v => v.status === 'DRAFT');
    assert.ok(version, 'creating a recipe must create a draft version');
    await assert.rejects(
      recipes.create(a.orgId, a.branchId, a.userId, { menuItemId: b.menuItemId, name: 'Cross Tenant Recipe', yieldQuantity: 1, yieldUnitId: countUnitId }),
      error => error && error.errorCode === 'INVALID_RECIPE_MENU_ITEM',
      'recipe creation must reject a menu item owned by another tenant',
    );
    await assert.rejects(
      recipes.create(a.orgId, a.branchId, a.userId, { menuItemId: a.menuItemId, name: 'Invalid Yield Unit', yieldQuantity: 1, yieldUnitId: kgId }),
      error => error && error.errorCode === 'INVALID_RECIPE_YIELD_UNIT',
      'recipe yields must use a count-compatible unit',
    );
    await assert.rejects(
      recipes.addIngredient(a.orgId, a.branchId, recipe.id, version.id, { inventoryItemId: item.id, locationId: otherBranchLocation.id, quantity: 100, unitId: gramId }),
      error => error && error.errorCode === 'INVALID_RECIPE_LOCATION',
      'recipe ingredients must reject locations from another branch',
    );
    await assert.rejects(
      recipes.addIngredient(a.orgId, a.branchId, recipe.id, version.id, { inventoryItemId: item.id, locationId: location.id, quantity: 100, unitId: countUnitId }),
      error => error && error.errorCode === 'INCOMPATIBLE_RECIPE_UNIT',
      'recipe ingredients must reject incompatible unit dimensions',
    );
    const withIngredient = await recipes.addIngredient(a.orgId, a.branchId, recipe.id, version.id, {
      inventoryItemId: item.id, locationId: location.id, quantity: 500, unitId: gramId,
    });
    assert.equal(withIngredient.id, version.id, 'adding an ingredient must return the updated recipe version');
    const ingredient = withIngredient.ingredients[0];
    assert.equal(Number(ingredient.normalizedQuantity), 0.5, '500 g must normalize to 0.5 kg');
    assert.equal(Number(ingredient.currentLineCost), 2, '0.5 kg at 4 per kg must cost 2');
    const active = await recipes.activateVersion(a.orgId, a.branchId, recipe.id, version.id);
    assert.equal(active.status, 'ACTIVE');
    assert.equal(Number(active.costing.batchCost), 2);
    assert.equal(Number(active.costing.costPerPortion), 2);
    assert.equal(Number(active.costing.foodCostPercent), 20, 'cost ratio must use net selling price');
    await assert.rejects(
      recipes.addIngredient(a.orgId, a.branchId, recipe.id, version.id, { inventoryItemId: item.id, locationId: location.id, quantity: 100, unitId: gramId }),
      error => error && error.errorCode === 'RECIPE_VERSION_IMMUTABLE',
      'active versions must be immutable',
    );
    await assert.rejects(
      recipes.get(b.orgId, b.branchId, recipe.id),
      error => error && error.errorCode === 'RECIPE_NOT_FOUND',
      'cross-tenant recipe lookup must be isolated',
    );
    await assert.rejects(
      recipes.get(a.orgId, otherBranchId, recipe.id),
      error => error && error.errorCode === 'RECIPE_NOT_FOUND',
      'cross-branch recipe lookup must be isolated',
    );
    assert.equal((await recipes.list(b.orgId, b.branchId)).length, 0, 'recipe list must remain tenant-scoped');
    await assert.rejects(
      recipes.create(a.orgId, a.branchId, a.userId, { menuItemId: a.menuItemId, name: 'Duplicate', yieldQuantity: 1, yieldUnitId: countUnitId }),
      error => error && error.errorCode === 'RECIPE_ALREADY_EXISTS',
      'one recipe per menu item/branch must be enforced',
    );
    const secondMenu = await pool.execute(
      'INSERT INTO menu_items (organization_id, category_id, name, sku, entered_price, is_available) VALUES (?, ?, ?, ?, ?, TRUE)',
      [a.orgId, a.menuCategoryId, 'P45 Empty Dish', 'P45-EMPTY-' + suffix, 5],
    );
    const emptyRecipe = await recipes.create(a.orgId, a.branchId, a.userId, { menuItemId: Number(secondMenu[0].insertId), name: 'P45 Empty Recipe', yieldQuantity: 1, yieldUnitId: countUnitId });
    const emptyVersion = emptyRecipe.versions.find(v => v.status === 'DRAFT');
    await assert.rejects(
      recipes.activateVersion(a.orgId, a.branchId, emptyRecipe.id, emptyVersion.id),
      error => error && error.errorCode === 'RECIPE_HAS_NO_INGREDIENTS',
      'activation must reject recipes without ingredients',
    );
    const direct = await recipes.setDirectStockLink(a.orgId, a.branchId, a.menuItemId, {
      inventoryItemId: item.id, locationId: location.id, quantityPerSale: 1, unitId: kgId, isActive: true,
    });
    assert.equal(Number(direct.inventoryItemId), item.id, 'direct-stock links must retain scoped inventory identifiers');
    assert.equal(Number((await recipes.getDirectStockLink(a.orgId, a.branchId, a.menuItemId)).quantityPerSale), 1);
    console.log('P45 MySQL recipe integration PASS (create/version/ingredient/activation/costing, unit conversion, immutability, direct-stock link, and tenant/branch isolation)');
  } finally {
    await pool.end();
    await closeDatabasePool();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
