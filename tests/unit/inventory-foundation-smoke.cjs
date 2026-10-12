#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const router = read('apps/api/src/server/modules/inventory/router.ts');
const controller = read('apps/api/src/server/modules/inventory/controller.ts');
const repository = read('apps/api/src/server/modules/inventory/repository.ts');
const validation = read('apps/api/src/server/modules/inventory/validation.ts');
const migration = read('apps/api/src/server/db/migrations/017_inventory_foundation.ts');
const legacyStockRouter = read('apps/api/src/server/modules/stock/router.ts');

assert.ok(router.includes("inventoryRouter.use(authenticate())"), 'inventory endpoints must require authentication');
for (const [route, permission] of [
  ["post('/items'", "'inventory:items:manage'"],
  ["post('/opening-stock'", "'inventory:opening:manage'"],
  ["post('/adjustments'", "'inventory:adjust'"],
  ["post('/transfers'", "'inventory:transfer'"],
  ["post('/counts/:id/confirm'", "'inventory:count'"],
]) {
  const line = router.split('\n').find((entry) => entry.includes(route));
  assert.ok(line && line.includes(permission), `${route} must enforce ${permission}`);
}
assert.ok(controller.includes('req.user.organizationId') && controller.includes('req.user.activeBranchId'), 'requests must derive tenant and branch from authenticated context');
assert.ok(controller.includes('MISSING_TENANT_CONTEXT') && controller.includes('MISSING_BRANCH_CONTEXT'), 'missing tenant/branch must fail closed');
for (const table of ['inventory_categories', 'inventory_locations', 'inventory_items', 'inventory_balances', 'inventory_movements']) {
  assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `migration 017 must define ${table}`);
}
for (const table of ['inventory_categories', 'inventory_locations', 'inventory_items']) {
  assert.ok(migration.includes(`organization_id BIGINT UNSIGNED NOT NULL`) && migration.includes(`branch_id BIGINT UNSIGNED NOT NULL`), `${table} schema must carry tenant and branch scope`);
}
assert.ok(repository.includes('WHERE id=? AND organization_id=? AND branch_id=?'), 'item and location lookups must be tenant/branch scoped');
assert.ok(repository.includes('WHERE organization_id=? AND branch_id=? AND inventory_item_id=? AND location_id=?'), 'balance mutations must scope the write itself to tenant and branch');
assert.ok(repository.includes('await conn.beginTransaction()'), 'inventory writes must use database transactions');
assert.ok(repository.includes('async openingStock('), 'opening stock operation must exist');
assert.ok(repository.includes('async transfer('), 'stock transfer operation must exist');
assert.ok(repository.includes('async confirmCount('), 'stock count confirmation must exist');
assert.ok(validation.includes("quantity: positive"), 'opening stock quantity must be strictly positive');
assert.ok(validation.includes("deltaQuantity: z.coerce.number()") && validation.includes("v !== 0"), 'adjustment delta must be finite and non-zero');
assert.ok(validation.includes("countedQuantity: nonNegative"), 'counted stock must be non-negative');
assert.ok(legacyStockRouter.includes("stockRouter.use(authenticate())"), 'legacy stock endpoints must remain authenticated');
assert.ok(legacyStockRouter.includes("requirePermission('inventory:items:manage')"), 'legacy stock writes must remain permission gated');

assert.ok(repository.includes("if(after<0) throw new ConflictError('Insufficient stock','INSUFFICIENT_STOCK')"), 'stock writes must reject negative resulting balances');
assert.ok(repository.includes("OPENING_STOCK_ALREADY_RECORDED"), 'opening stock must not be recorded twice');
assert.ok(repository.includes("OPENING_STOCK_NOT_INITIAL"), 'opening stock must precede other movements');
assert.ok(repository.includes("const locationIds=[Number(data.fromLocationId),Number(data.toLocationId)].sort((a,b)=>a-b)"), 'transfer must lock locations in deterministic order');
assert.ok(repository.includes("'TRANSFER_OUT'") && repository.includes("'TRANSFER_IN'"), 'transfer must record both sides of the stock movement');
assert.ok(repository.includes("Stock changed since this count was started; refresh and recount"), 'count confirmation must detect stale stock');
assert.ok(repository.includes("INCOMPLETE_STOCK_COUNT"), 'count confirmation must reject incomplete item submissions');
assert.ok(repository.includes("DUPLICATE_COUNT_ITEM"), 'count confirmation must reject duplicate item submissions');
assert.ok(repository.includes("COUNT_CORRECTION"), 'count variance must be written to the movement ledger');
assert.ok(repository.includes("inventory_balances SET current_quantity=?") && repository.includes("INSERT INTO inventory_movements"), 'balance mutation and movement ledger write must be paired in the same transaction');
assert.ok(repository.includes("if(incomingUnitCost<0 || !Number.isFinite(incomingUnitCost))"), 'incoming acquisition cost must be finite and non-negative');
assert.ok(repository.includes("async updateWeightedAverageCost("), 'purchase receipt cost updates must use the shared weighted-average implementation');

console.log('P44 inventory foundation contract PASS (auth, permissions, tenant/branch scope, schema, and stock-operation invariants)');
