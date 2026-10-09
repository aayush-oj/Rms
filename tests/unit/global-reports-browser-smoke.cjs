#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const runtimeRoot = path.join(root, 'runtime');
const port = Number(process.env.P43_BROWSER_PORT || 4319);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_HOST: process.env.P43_DB_HOST || '127.0.0.1',
      DATABASE_PORT: process.env.P43_DB_PORT || '3306',
      DATABASE_NAME: process.env.P43_DB_NAME || 'restrox_test',
      DATABASE_USER: process.env.P43_DB_USER || 'rms',
      DATABASE_PASSWORD: process.env.P43_DB_PASSWORD || 'p43-ci-db-password',
      DATABASE_CONNECT_TIMEOUT_MS: '5000',
      DATABASE_CONNECTION_LIMIT: '2',
      JWT_SECRET: 'restrox-p43-test-secret-not-for-production',
      PLATFORM_JWT_SECRET: 'restrox-p43-platform-test-secret-not-prod',
      ALLOWED_ORIGINS: base,
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'false',
      LEGACY_STATE_ENABLED: 'false',
      SUPPORT_CONTACT_EMAIL: 'ci@example.test',
      SUPPORT_CONTACT_WEBSITE: '',
      SUPPORT_CONTACT_PHONE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  let browser;
  try {
    let ready = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Runtime exited (code ${child.exitCode}).\n${logs}`);
      try {
        const response = await fetch(`${base}/en/reports`, { redirect: 'follow', signal: AbortSignal.timeout(1500) });
        if (response.status === 200) { ready = true; break; }
      } catch {}
      await wait(250);
    }
    assert.ok(ready, `Runtime did not serve /en/reports.\n${logs}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/en/reports`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Reports', level: 1 }).waitFor();
    assert.equal(await page.locator('.card').count(), 4, 'all four report cards should render');
    const search = page.getByRole('searchbox', { name: 'Find a report' });
    await search.fill('finance');
    assert.equal(await page.locator('.card').count(), 2, 'finance search should filter to two cards');
    await search.fill('no-matching-report');
    assert.equal(await page.locator('.card').count(), 0, 'non-matching search should hide cards');
    await page.getByText('No report categories match your search.').waitFor();
    await search.fill('');
    await search.focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'A', 'Tab from search should focus a report link');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'keyboard focus indicator should be visible');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile viewport must not overflow horizontally');
    const axePath = path.join(path.dirname(require.resolve('axe-core')), 'axe.min.js');
    await page.addScriptTag({ path: axePath });
    const accessibility = await page.evaluate(async () => {
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      return result.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.length }));
    });
    assert.deepEqual(accessibility, [], `axe accessibility violations: ${JSON.stringify(accessibility)}`);
    await page.route('**/reports-catalog.json', route => route.abort());
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('The report directory could not be loaded. Please use the application navigation or contact your administrator.').waitFor();
    assert.deepEqual(pageErrors, [], `browser JavaScript errors: ${pageErrors.join('; ')}`);
    console.log('P43 browser/accessibility smoke PASS (search, keyboard focus, mobile layout, axe WCAG 2.1 AA, no page errors)');
  } finally {
    if (browser) await browser.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
