#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const { InventoryRepository } = require('../../apps/api/src/server/modules/inventory/repository.ts');

const config = {
  host: process.env.P44_DB_HOST || '127.0.0.1',
  port: Number(process.env.P44_DB_PORT || 3306),
  database: process.env.P44_DB_NAME || 'restrox_test',
  user: process.env.P44_DB_USER || 'rms',
  password: process.env.P44_DB_PASSWORD || 'p43-ci-db-password',
  connectionLimit: 4,
  decimalNumbers: true,
};
const pool = mysql.createPool(config);
const repo = new InventoryRepository(() => pool);
const suffix = String(process.pid).replace(/[^0-9]/g, '').slice(-6) || '123456';
const triggerName = 'p44_force_transfer_in_failure';

async function seedTenant(name, handle) {
  const [org] = await pool.execute(
    'INSERT INTO organizations (name, handle, status) VALUES (?, ?, \'ACTIVE\')',
    [name, handle],
  );
  const orgId = Number(org.insertId);
  const [branch] = await pool.execute(
    'INSERT INTO branches (organization_id, name, code, is_active) VALUES (?, ?, ?, TRUE)',
    [orgId, 'Main branch', 'P44-01'],
  );
  const branchId = Number(branch.insertId);
  await pool.execute(
    "INSERT INTO organization_entitlements (organization_id, access_status) VALUES (?, 'ACTIVE')",
    [orgId],
  );
  const [roles] = await pool.execute(
    "SELECT id FROM roles WHERE organization_id IS NULL AND name = 'OWNER' LIMIT 1",
  );
  assert.ok(roles.length, 'production startup must seed the global OWNER role');
  const [user] = await pool.execute(
    'INSERT INTO users (organization_id, default_branch_id, role_id, name, username, is_active) VALUES (?, ?, ?, ?, ?, TRUE)',
    [orgId, branchId, Number(roles[0].id), 'P44 Integration Owner', `${handle}-owner`],
  );
  return { orgId, branchId, userId: Number(user.insertId) };
}

async function main() {
  let triggerCreated = false;
  try {
    const [health] = await pool.query('SELECT 1 AS ok');
    assert.equal(Number(health[0].ok), 1, 'MySQL must be reachable');

    const tenantA = await seedTenant('P44 Inventory Integration A', `p44a${suffix}`);
    const tenantB = await seedTenant('P44 Inventory Integration B', `p44b${suffix}`);
    const [units] = await pool.execute(
      "SELECT id FROM units_of_measure WHERE organization_id IS NULL AND symbol = 'kg' AND is_active = TRUE LIMIT 1",
    );
    assert.ok(units.length, 'migration 017 must seed the global kilogram unit');
    const unitId = Number(units[0].id);

    const category = await repo.createCategory(tenantA.orgId, tenantA.branchId, {
      name: 'P44 Ingredients', code: 'P44-ING', isActive: true,
    });
    const locationA = await repo.createLocation(tenantA.orgId, tenantA.branchId, {
      name: 'Main store', code: 'P44-MAIN', isActive: true,
    });
    const locationB = await repo.createLocation(tenantA.orgId, tenantA.branchId, {
      name: 'Prep store', code: 'P44-PREP', isActive: true,
    });
    const item = await repo.createItem(tenantA.orgId, tenantA.branchId, {
      name: 'P44 Rice', sku: `P44-RICE-${suffix}`, categoryId: category.id,
      unitId, costPerUnit: 2.5, reorderPoint: 1, reorderQuantity: 5,
      isActive: true, notes: 'MySQL integration fixture',
    });

    await repo.openingStock(tenantA.orgId, tenantA.branchId, {
      inventoryItemId: item.id, locationId: locationA.id, quantity: 10, reason: 'P44 opening',
    }, tenantA.userId);
    await repo.adjustment(tenantA.orgId, tenantA.branchId, {
      inventoryItemId: item.id, locationId: locationA.id, deltaQuantity: 2, reason: 'P44 adjustment',
    }, tenantA.userId);
    await repo.transfer(tenantA.orgId, tenantA.branchId, {
      inventoryItemId: item.id, fromLocationId: locationA.id, toLocationId: locationB.id,
      quantity: 3, reason: 'P44 transfer',
    }, tenantA.userId);

    let stock = await repo.getStockForItem(tenantA.orgId, tenantA.branchId, item.id);
    const qty = (locationId) => Number(stock.find((row) => row.locationId === locationId)?.currentQuantity ?? -1);
    assert.equal(qty(locationA.id), 9, 'opening, adjustment and transfer-out must reconcile source balance');
    assert.equal(qty(locationB.id), 3, 'transfer-in must reconcile destination balance');

    const count = await repo.createCount(tenantA.orgId, tenantA.branchId, locationA.id, [item.id], tenantA.userId, 'P44 count');
    assert.equal(count.items.length, 1, 'stock count detail must include its item');
    const confirmed = await repo.confirmCount(tenantA.orgId, tenantA.branchId, count.id, tenantA.userId, [
      { inventoryItemId: item.id, countedQuantity: 8 },
    ]);
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(Number(confirmed.items[0].varianceQuantity), -1, 'count variance must be recorded');
    stock = await repo.getStockForItem(tenantA.orgId, tenantA.branchId, item.id);
    assert.equal(qty(locationA.id), 8, 'count correction must reconcile the balance');

    const beforeMovements = await repo.movements(tenantA.orgId, tenantA.branchId, { inventoryItemId: item.id });
    assert.equal(beforeMovements.length, 5, 'opening, adjustment, transfer pair and count correction must append five ledger rows');

    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON inventory_movements FOR EACH ROW BEGIN IF NEW.movement_type = 'TRANSFER_IN' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'P44 forced rollback probe'; END IF; END`);
    triggerCreated = true;
    await assert.rejects(
      repo.transfer(tenantA.orgId, tenantA.branchId, {
        inventoryItemId: item.id, fromLocationId: locationA.id, toLocationId: locationB.id,
        quantity: 1, reason: 'P44 rollback probe',
      }, tenantA.userId),
      /P44 forced rollback probe/,
      'transfer-in failure must abort the whole transaction',
    );
    await pool.query(`DROP TRIGGER ${triggerName}`);
    triggerCreated = false;

    stock = await repo.getStockForItem(tenantA.orgId, tenantA.branchId, item.id);
    assert.equal(qty(locationA.id), 8, 'failed transfer must roll back source balance mutation');
    assert.equal(qty(locationB.id), 3, 'failed transfer must roll back destination balance mutation');
    assert.equal((await repo.movements(tenantA.orgId, tenantA.branchId, { inventoryItemId: item.id })).length, 5,
      'failed transfer must not leave a partial movement ledger entry');

    await assert.rejects(
      repo.adjustment(tenantA.orgId, tenantA.branchId, {
        inventoryItemId: item.id, locationId: locationA.id, deltaQuantity: -999, reason: 'P44 insufficient stock',
      }, tenantA.userId),
      (error) => error && error.errorCode === 'INSUFFICIENT_STOCK',
      'insufficient-stock adjustment must fail with a domain conflict',
    );
    assert.equal((await repo.movements(tenantA.orgId, tenantA.branchId, { inventoryItemId: item.id })).length, 5,
      'rejected adjustment must not append a movement');

    assert.equal(await repo.getItem(tenantB.orgId, tenantB.branchId, item.id), null,
      'cross-tenant item lookup must not return another tenant item');
    await assert.rejects(
      repo.getStockForItem(tenantB.orgId, tenantB.branchId, item.id),
      (error) => error && error.errorCode === 'INVENTORY_ITEM_NOT_FOUND',
      'cross-tenant stock lookup must return not-found',
    );
    assert.equal((await repo.listItems(tenantB.orgId, tenantB.branchId)).length, 0,
      'cross-tenant item listing must remain isolated');

    await assert.rejects(
      repo.createCount(tenantA.orgId, tenantA.branchId, locationA.id, [item.id, item.id], tenantA.userId),
      (error) => error && error.errorCode === 'DUPLICATE_COUNT_ITEM',
      'stock count creation must reject duplicate item IDs',
    );

    console.log('P44 MySQL repository integration PASS (opening stock, adjustment, transfer, count, ledger, rollback, insufficient stock, and tenant isolation)');
  } finally {
    if (triggerCreated) {
      try { await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`); } catch {}
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
