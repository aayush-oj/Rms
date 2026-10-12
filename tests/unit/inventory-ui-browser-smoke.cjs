#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const htmlPath = path.resolve(__dirname, '../../apps/web/public/inventory.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const fixtures = {
  units: [{ id: 1, name: 'Kilogram', symbol: 'kg', dimension: 'MASS', conversionFactor: 1 }],
  categories: [{ id: 2, name: 'Produce', code: 'PROD', isActive: true }],
  locations: [{ id: 3, name: 'Main store', code: 'MAIN', notes: '', isActive: true }],
  items: [{ id: 4, name: 'Rice', sku: 'RICE', categoryName: 'Produce', unitSymbol: 'kg', costPerUnit: 2, reorderPoint: 5, reorderQuantity: 10, isActive: true }],
  stock: [{ inventoryItemId: 4, locationId: 3, itemName: 'Rice', locationName: 'Main store', unitSymbol: 'kg', currentQuantity: 12, reorderPoint: 5, status: 'IN_STOCK' }],
  movements: [],
  counts: []
};
const requests = [];
const server = http.createServer((req, res) => {
  if (req.url === '/inventory.html' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/api/v1/inventory**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      let body = {};
      try { body = request.postDataJSON() || {}; } catch {}
      requests.push({ method: request.method(), path: url.pathname.replace('/api/v1/inventory', ''), body });
      let data = [];
      if (request.method() === 'GET') {
        if (url.pathname.endsWith('/units')) data = fixtures.units;
        else if (url.pathname.endsWith('/categories')) data = fixtures.categories;
        else if (url.pathname.endsWith('/locations')) data = fixtures.locations;
        else if (url.pathname.endsWith('/items')) data = fixtures.items;
        else if (url.pathname.endsWith('/stock')) data = fixtures.stock;
        else if (url.pathname.endsWith('/movements')) data = fixtures.movements;
        else if (url.pathname.endsWith('/counts')) data = fixtures.counts;
        else if (/\/counts\/\d+$/.test(url.pathname)) data = { id: 8, locationName: 'Main store', status: 'DRAFT', items: [{ id: 9, inventoryItemId: 4, itemName: 'Rice', systemQuantity: 12, countedQuantity: 12 }] };
      } else {
        if (url.pathname.endsWith('/items')) {
          data = { id: 5, name: body.name, sku: body.sku, unitSymbol: 'kg', costPerUnit: body.costPerUnit, reorderPoint: body.reorderPoint, isActive: true };
          fixtures.items.push(data);
        } else if (url.pathname.endsWith('/counts')) {
          data = { id: 8, locationId: body.locationId, status: 'DRAFT', items: body.itemIds.map(id => ({ inventoryItemId: id })) };
          fixtures.counts = [data];
        } else if (url.pathname.endsWith('/confirm')) data = { id: 8, status: 'CONFIRMED' };
        else if (url.pathname.endsWith('/opening-stock') || url.pathname.endsWith('/adjustments') || url.pathname.endsWith('/transfers')) data = { success: true };
        else data = { id: 10, ...body };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    });

    await page.goto(base + '/inventory.html', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Inventory', level: 1 }).waitFor();
    await page.getByRole('cell', { name: 'Rice', exact: true }).waitFor();
    assert.equal(await page.locator('#items-body tr').count(), 1, 'initial stock item should render');
    assert.equal(await page.locator('#stock-body tr').count(), 1, 'stock balance should render');
    assert.equal(await page.locator('#units-body tr').count(), 1, 'measuring unit should render');

    await page.getByRole('searchbox', { name: 'Search inventory items' }).fill('does-not-exist');
    assert.match(await page.locator('#items-body').innerText(), /No stock items match/);
    await page.getByRole('searchbox', { name: 'Search inventory items' }).fill('Rice');

    await page.getByLabel('Item name *').fill('Flour');
    await page.getByLabel('SKU').fill('FLOUR');
    await page.getByLabel('Measuring unit *').selectOption('1');
    await page.getByLabel('Category').selectOption('2');
    await page.getByRole('button', { name: 'Create item' }).click();
    await page.getByText('Saved successfully.').waitFor();
    const create = requests.find(r => r.method === 'POST' && r.path === '/items');
    assert.ok(create, 'create-item request should reach the authenticated inventory API path');
    assert.equal(create.body.name, 'Flour');
    assert.equal(create.body.unitId, 1);
    assert.equal(create.body.categoryId, 2);

    await page.getByRole('tab', { name: 'On-hand stock' }).click();
    await page.getByLabel('Item *').first().selectOption('4');
    await page.getByLabel('Location *').first().selectOption('3');
    await page.getByLabel('Quantity *').fill('3');
    await page.getByRole('button', { name: 'Record opening stock' }).click();
    await page.getByText('Saved successfully.').waitFor();
    assert.ok(requests.some(r => r.method === 'POST' && r.path === '/opening-stock'), 'opening stock must post to the inventory API');

    await page.getByRole('tab', { name: 'Stock counts' }).click();
    await page.getByLabel('Location *').selectOption('3');
    await page.getByLabel('Items to count *').selectOption(['4']);
    await page.getByRole('button', { name: 'Create draft count' }).click();
    await page.getByText('Saved successfully.').waitFor();
    const countCreate = requests.find(r => r.method === 'POST' && r.path === '/counts');
    assert.deepEqual(countCreate.body.itemIds, [4], 'stock count must submit all selected item IDs');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile layout must not overflow horizontally');
    assert.deepEqual(pageErrors, [], 'browser JavaScript errors: ' + pageErrors.join('; '));
    console.log('Inventory UI browser smoke PASS (rendering, search, item creation, opening stock, stock counts, mobile layout).');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
