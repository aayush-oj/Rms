#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const source = read('apps/api/src/server/server.ts');
const compiledServer = read('runtime/dist/server.cjs');
const page = read('runtime/dist/reports.html');
const publicPage = read('apps/web/public/reports.html');
const deployedRoutePage = read('runtime/dist/en/reports/index.html');
const publicRoutePage = read('apps/web/public/en/reports/index.html');
const catalog = JSON.parse(read('runtime/dist/reports-catalog.json'));
const publicCatalog = JSON.parse(read('apps/web/public/reports-catalog.json'));
const routes = JSON.parse(read('validation/reference/routes.json'));
assert.deepEqual(catalog, publicCatalog, 'runtime catalog must match source catalog');
assert.equal(page, publicPage, 'runtime page must match source page');
assert.equal(deployedRoutePage, page, 'production /en/reports directory index must match report hub');
assert.equal(publicRoutePage, publicPage, 'development /en/reports directory index must match report hub');
assert.match(source, /app\\.get\\(\\['\\/en\\/reports', '\\/en\\/reports\\/'\\]/, 'editable server source must explicitly register /en/reports');
assert.match(source, /path\\.join\\(distPath, 'reports\\.html'\\)/, 'editable production route must target the report page');
assert.match(source, /path\\.join\\(process\\.cwd\\(\\), 'runtime', 'dist', 'reports\\.html'\\)/, 'development route must target preserved report page');
assert.match(compiledServer, /express3\\.static\\(distPath\\)/, 'compiled production server must serve static files');
assert.ok(compiledServer.indexOf('express3.static(distPath)') < compiledServer.indexOf('app.get("*"'), 'static serving must precede compiled SPA fallback');
assert.ok(page.includes("fetch('/reports-catalog.json'"), 'page must load the deployed catalog');
assert.ok(page.includes('link.href = item.path'), 'links must be created through DOM APIs');
assert.ok(!page.includes('innerHTML'), 'catalog text must not be injected as HTML');
assert.equal(catalog.length, 4, 'expected four evidence-backed report destinations');
const known = new Set(routes.map((route) => route.path));
for (const item of catalog) {
  assert.ok(item.id && item.title && item.description && item.category, 'catalog items require complete display metadata');
  assert.ok(known.has(item.path), `destination is not in canonical route reference: ${item.path}`);
  assert.ok(item.path.startsWith('/en/'), `destination must use canonical locale path: ${item.path}`);
}
console.log(`P43 Global Reports static integration smoke PASS (${catalog.length} destinations; route aliases, runtime assets, and catalog consistent)`);
