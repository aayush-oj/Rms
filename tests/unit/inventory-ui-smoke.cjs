const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../apps/web/public/inventory.html'), 'utf8');
const required = [
  'role="tablist"', 'id="view-items"', 'id="view-stock"', 'id="view-movements"',
  'id="view-categories"', 'id="view-units"', 'id="view-locations"', 'id="view-counts"',
  "const api='/api/v1/inventory'", "credentials:'same-origin'",
  "request('/items?activeOnly=false')", "request('/units')", "request('/categories')",
  "request('/locations')", "request('/stock')", "request('/movements')", "request('/counts')",
  "'/opening-stock'", "'/adjustments'", "'/transfers'", "'/units'",
  "'/counts/'+encodeURIComponent(b.dataset.count)+'/confirm'",
  'aria-live="polite"', 'function esc(s)', 'function notice(message,error=false)',
  'data-count=', 'min="0.0001"', 'Counted quantities must be zero or greater.'
];
for (const fragment of required) assert.ok(html.includes(fragment), `inventory UI missing contract: ${fragment}`);
assert.ok(!html.includes('localStorage'), 'inventory UI must not persist tenant data in local storage');
const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)];
assert.ok(scripts.length > 0, 'inventory UI must have its client controller');
for (const [index, match] of scripts.entries()) new vm.Script(match[1], { filename: `inventory-inline-${index + 1}.js` });
console.log('Inventory UI smoke: navigation, API contracts, ledger actions, validation and safe rendering passed.');
