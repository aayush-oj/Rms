'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { convertQuantity, recipeCostMetrics } = require('../../apps/api/src/server/modules/recipe/calculations.ts');
const { createRecipeSchema, createVersionSchema, ingredientSchema, listRecipesQuerySchema } = require('../../apps/api/src/server/modules/recipe/validation.ts');

const converted = convertQuantity(2, { id: 1, dimension: 'MASS', conversionFactor: 1000 }, { id: 2, dimension: 'MASS', conversionFactor: 1 });
assert.equal(converted, 2000, 'unit conversion must normalize ingredient quantities');
assert.throws(() => convertQuantity(1, { id: 1, dimension: 'MASS', conversionFactor: 1 }, { id: 2, dimension: 'VOLUME', conversionFactor: 1 }), /Incompatible unit dimensions/);
assert.throws(() => convertQuantity(-1, { id: 1, dimension: 'MASS', conversionFactor: 1 }, { id: 2, dimension: 'MASS', conversionFactor: 1 }), /finite non-negative/);

const metrics = recipeCostMetrics(12, 4, 10);
assert.deepEqual(metrics, {
  batchCost: 12,
  costPerPortion: 3,
  netSellingPrice: 10,
  foodCostPercent: 30,
  grossProfit: 7,
  grossMarginPercent: 70,
});
const noPrice = recipeCostMetrics(12, 4, 0);
assert.equal(noPrice.costPerPortion, 3);
assert.equal(noPrice.foodCostPercent, null, 'missing/zero selling price must not invent a food-cost percent');

assert.equal(createRecipeSchema.safeParse({ menuItemId: 1, name: 'Soup', yieldUnitId: 1 }).success, true);
assert.equal(createRecipeSchema.safeParse({ menuItemId: 0, name: 'Soup', yieldUnitId: 1 }).success, false);
assert.equal(createVersionSchema.safeParse({ yieldQuantity: 0, yieldUnitId: 1 }).success, false);
assert.equal(ingredientSchema.safeParse({ inventoryItemId: 1, locationId: 1, quantity: 0, unitId: 1 }).success, false);
assert.equal(listRecipesQuerySchema.safeParse({ status: 'ACTIVE', classification: 'FOOD' }).success, true);
assert.equal(listRecipesQuerySchema.safeParse({ status: 'UNKNOWN' }).success, false);

const routes = fs.readFileSync(path.join(root, 'apps/api/src/server/routes/index.ts'), 'utf8');
assert.match(routes, /apiV1Router\.use\('\/recipes',\s*recipeRouter\)/);
assert.match(routes, /apiV1Router\.use\('\/inventory\/recipes',\s*recipeRouter\)/);
const router = fs.readFileSync(path.join(root, 'apps/api/src/server/modules/recipe/router.ts'), 'utf8');
for (const permission of ['recipe:view', 'recipe:create', 'recipe:update', 'recipe:activate', 'recipe:archive', 'recipe:view_cost']) {
  assert.ok(router.includes(permission), `missing recipe permission boundary: ${permission}`);
}
const repository = fs.readFileSync(path.join(root, 'apps/api/src/server/modules/recipe/repository.ts'), 'utf8');
assert.match(repository, /r\.organization_id\s*=\s*\?/);
assert.match(repository, /r\.branch_id\s*=\s*\?/);
assert.match(repository, /Only draft recipe versions can be changed/);
assert.match(repository, /Only a draft version can be activated/);
assert.ok(repository.includes('UPDATE recipe_version_ingredients SET location_id=?,quantity=?,unit_id=?,updated_at=NOW() WHERE id=? AND recipe_version_id=? AND organization_id=? AND branch_id=?'), 'ingredient updates must remain tenant/branch scoped');
assert.ok(repository.includes('SELECT * FROM recipe_version_ingredients WHERE id=? AND recipe_version_id=? AND organization_id=? AND branch_id=? FOR UPDATE'), 'ingredient reads must remain tenant/branch scoped');
assert.ok(repository.includes("UPDATE recipe_versions SET status='ACTIVE',effective_from=COALESCE(effective_from,NOW()),activated_at=NOW() WHERE id=? AND recipe_id=? AND organization_id=? AND branch_id=?"), 'activation writes must remain tenant/branch scoped');
const boundary = fs.readFileSync(path.join(root, 'apps/api/src/server/modules/recipe/operationalBoundary.ts'), 'utf8');
assert.match(boundary, /stockRepository\.consumeOrderItemInTransaction/);
assert.match(boundary, /stockRepository\.reverseOrderInTransaction/);
const ui = fs.readFileSync(path.join(root, 'apps/web/public/recipes.html'), 'utf8');
assert.ok(ui.includes('<title>Recipes & Costing | RestroX</title>'));
assert.match(ui, /aria-live="polite"/);
assert.match(ui, /versions/);
assert.match(ui, /foodCostPercent/);

console.log('P45 recipe costing smoke PASS (unit conversion, cost formula, validation, permission gates, tenant scope, UI and POS stock boundary)');
