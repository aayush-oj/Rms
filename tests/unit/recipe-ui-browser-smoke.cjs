'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'apps/web/public/recipes.html'), 'utf8');
const ingredient = { id: 1, inventoryItemId: 7, inventoryItemName: 'Flour', locationId: 2, locationName: 'Kitchen', quantity: 0.5, unitId: 3, unitSymbol: 'kg', inventoryUnitId: 3, inventoryUnitSymbol: 'kg', normalizedQuantity: 0.5, currentUnitCost: 4, currentLineCost: 2 };
let createdRecipe = null;
let recipe = { id: 1, organizationId: 1, branchId: 1, menuItemId: 10, menuItemName: 'Bread', categoryName: 'Bakery', itemClassification: 'FOOD', sellingPrice: 8, name: 'Bread recipe', description: null, status: 'DRAFT', activeVersionId: null, activeVersionNumber: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', costing: null, versions: [{ id: 11, versionNumber: 1, status: 'DRAFT', yieldQuantity: 1, yieldUnitId: 1, yieldUnitSymbol: 'portion', effectiveFrom: null, notes: null, createdAt: '2026-01-01T00:00:00.000Z', activatedAt: null, ingredients: [] }] };
const server = http.createServer((req, res) => {
  if (req.url === '/recipes.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
  res.writeHead(404); res.end('not found');
});
const send = (route, data, status=200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.route('**/api/v1/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.pathname === '/api/v1/menu/items' && method === 'GET') return send(route, [{ id: 10, name: 'Bread', categoryName: 'Bakery' }, { id: 20, name: 'Soup', categoryName: 'Kitchen' }]);
    if (url.pathname === '/api/v1/inventory/items' && method === 'GET') return send(route, [{ id: 7, name: 'Flour', unitId: 3, unitSymbol: 'kg', isActive: true }]);
    if (url.pathname === '/api/v1/inventory/locations' && method === 'GET') return send(route, [{ id: 2, name: 'Kitchen', isActive: true }]);
    if (url.pathname === '/api/v1/inventory/units' && method === 'GET') return send(route, [{ id: 1, name: 'Portion', symbol: 'portion', dimension: 'COUNT' }, { id: 3, name: 'Kilogram', symbol: 'kg', dimension: 'MASS' }]);
    if (url.pathname === '/api/v1/recipes' && method === 'GET') return send(route, [recipe, ...(createdRecipe ? [createdRecipe] : [])]);
    if (url.pathname === '/api/v1/recipes/1' && method === 'GET') return send(route, recipe);
    if (url.pathname === '/api/v1/recipes/2' && method === 'GET' && createdRecipe) return send(route, createdRecipe);
    if (url.pathname === '/api/v1/recipes' && method === 'POST') {
      const body = req.postDataJSON();
      createdRecipe = { ...recipe, id: 2, status: 'DRAFT', name: body.name, menuItemId: body.menuItemId, menuItemName: 'Soup', costing: null, versions: [{ ...recipe.versions[0], id: 22, status: 'DRAFT', ingredients: [] }] };
      return send(route, createdRecipe, 201);
    }
    if (url.pathname === '/api/v1/recipes/1/versions/11/ingredients' && method === 'POST') {
      const body = req.postDataJSON();
      recipe.versions[0].ingredients.push({ ...ingredient, inventoryItemId: body.inventoryItemId, locationId: body.locationId, quantity: body.quantity, unitId: body.unitId });
      return send(route, recipe.versions[0], 201);
    }
    if (url.pathname === '/api/v1/recipes/1/versions/11/activate' && method === 'POST') {
      recipe = { ...recipe, status: 'ACTIVE', activeVersionId: 11, activeVersionNumber: 1, costing: { batchCost: 2, costPerPortion: 2, netSellingPrice: 8, foodCostPercent: 25, grossProfit: 6, grossMarginPercent: 75 }, versions: [{ ...recipe.versions[0], status: 'ACTIVE', ingredients: recipe.versions[0].ingredients }] };
      return send(route, recipe);
    }
    return send(route, { message: 'Unexpected test API request: ' + method + ' ' + url.pathname }, 500);
  });
  try {
    await page.goto('http://127.0.0.1:' + address.port + '/recipes.html');
    await page.getByLabel('Search recipes').fill('does-not-match');
    await page.getByText('No matching recipes.').waitFor();
    await page.getByLabel('Search recipes').fill('bread');
    const recipeButton = page.getByRole('button', { name: /Bread recipe/ });
    await recipeButton.focus();
    await recipeButton.press('Enter');
    await page.getByLabel('Inventory item').selectOption('7');
    assert.equal(await page.locator('#ingredient-unit option[value="1"]').count(), 0, 'ingredient unit options must exclude incompatible count units');
    await page.getByLabel('Stock location').selectOption('2');
    await page.getByLabel('Quantity', { exact: true }).fill('0.5');
    await page.getByLabel('Recipe unit').selectOption('3');
    await page.getByRole('button', { name: 'Add ingredient' }).click();
    await page.getByText('Flour', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Activate' }).click();
    await page.getByText('25.00%', { exact: true }).waitFor();
    await page.getByLabel('Menu item').selectOption('20');
    await page.getByLabel('Recipe name').fill('Soup recipe');
    await page.getByLabel('Yield unit').selectOption('1');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.getByText('Draft recipe created. Add ingredients before activating.').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false, 'recipe workspace must not overflow a narrow viewport');
    assert.deepEqual(pageErrors, [], 'recipe workspace must not raise JavaScript errors');
    console.log('P45 recipe browser smoke PASS (list, ingredient edit, activation, draft creation, keyboard navigation, search filtering, mobile layout, no page errors)');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
