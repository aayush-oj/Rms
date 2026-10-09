#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const runtimeRoot = path.join(root, 'runtime');
const port = Number(process.env.P43_SMOKE_PORT || 4317);
const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_HOST: '127.0.0.1',
      DATABASE_PORT: '1',
      DATABASE_NAME: 'restrox_p43_smoke',
      DATABASE_USER: 'restrox_p43_smoke',
      DATABASE_PASSWORD: '',
      DATABASE_CONNECT_TIMEOUT_MS: '750',
      DATABASE_CONNECTION_LIMIT: '1',
      JWT_SECRET: 'restrox-p43-test-secret-not-for-production',
      PLATFORM_JWT_SECRET: 'restrox-p43-platform-test-secret-not-prod',
      ALLOWED_ORIGINS: base,
      LEGACY_STATE_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  let completed = false;
  try {
    let response;
    let lastError;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Runtime exited before becoming ready (code ${child.exitCode}).\n${logs}`);
      }
      try {
        response = await fetch(`${base}/en/reports`, { redirect: 'follow', signal: AbortSignal.timeout(1500) });
        if (response.status === 200) break;
        lastError = new Error(`Unexpected HTTP status ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await wait(250);
    }
    assert.ok(response && response.status === 200, `/en/reports did not return HTTP 200: ${lastError}\n${logs}`);
    const html = await response.text();
    assert.ok(html.includes('<title>Reports | RestroX</title>'), 'route must serve the Reports page');
    const trailingSlash = await fetch(`${base}/en/reports/`, { redirect: 'follow', signal: AbortSignal.timeout(3000) });
    assert.equal(trailingSlash.status, 200, '/en/reports/ must return HTTP 200');
    const catalogResponse = await fetch(`${base}/reports-catalog.json`, { signal: AbortSignal.timeout(3000) });
    assert.equal(catalogResponse.status, 200, 'report catalog must be served');
    const catalog = await catalogResponse.json();
    assert.equal(catalog.length, 4, 'expected four report destinations');
    console.log(`P43 runtime HTTP smoke PASS (port ${port}; /en/reports, /en/reports/, catalog ${catalog.length} items)`);
    completed = true;
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        wait(5000),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
  if (!completed) throw new Error('Runtime smoke did not complete');
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
