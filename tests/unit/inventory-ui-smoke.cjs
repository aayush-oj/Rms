const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../apps/web/public/inventory.html'), 'utf8');
const required = [
  'role="tablist"', 'id="view-items"', 'id="view-stock"', 'id="view-movements"',
  'id="view-categories"', 'id="view-units"', 'id="view-locations"', 'id="view-counts"',
  "const api='/api/v1/inventory'", "credentials:'same-origin'", "fetch(api+path,{...options,credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json',...(options.headers||{})}})",
  "request('/items')", "request('/units')", "request('/categories')",
  "request('/locations')", "request('/stock')", "request('/movements')", "request('/counts')",
  "'/opening-stock'", "'/adjustments'", "'/transfers'", "'/units'",
  "'/counts/'+encodeURIComponent(b.dataset.count)+'/confirm'",
  'aria-live="polite"', 'const esc=s=>', 'function notice(message,error=false)',
  'data-count=', 'min="0.0001"', 'Counted quantities must be zero or greater.',
  "rows('units-body',state.units.map(x=>[label(x,'name'),label(x,'symbol'),label(x,'dimension'),num(x.conversionFactor??x.conversion_factor),x.isActive===false||x.is_active===0?'Inactive':'Active']),5)"
];
for (const fragment of required) assert.ok(html.includes(fragment), `inventory UI missing contract: ${fragment}`);
assert.ok(!html.includes('localStorage'), 'inventory UI must not persist tenant data in local storage');
assert.ok(!html.includes("label(x,'baseUnitSymbol','base_unit_symbol')"), 'inventory UI must not display unit metadata the API does not persist');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length > 0, 'inventory UI must have its client controller');
for (const [index, match] of scripts.entries()) new vm.Script(match[1], { filename: `inventory-inline-${index + 1}.js` });
console.log('Inventory UI smoke: navigation, API contracts, ledger actions, validation and safe rendering passed.');
