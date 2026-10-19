'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'apps/api/src/server/db/migrations');
const mirrorDir = path.join(root, 'database/migrations');
const checksumPath = path.join(mirrorDir, 'checksums.ts');
const registryPath = path.join(mirrorDir, 'index.ts');
const FIRST = 1;
const LAST = 70;

function numberedFiles(dir) {
  return fs.readdirSync(dir)
    .filter(name => /^\d{3}_.+\.ts$/.test(name))
    .sort((a, b) => a.localeCompare(b));
}

function gitBlobSha(content) {
  const body = Buffer.from(content, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(body).digest('hex');
}

function expectedNames() {
  return Array.from({ length: LAST - FIRST + 1 }, (_, i) => {
    const n = String(i + FIRST).padStart(3, '0');
    return n;
  });
}

function migrationNumber(file) {
  return Number(file.slice(0, 3));
}

const appFiles = numberedFiles(appDir);
const mirrorFiles = numberedFiles(mirrorDir);
const expectedNumbers = expectedNames();
const appNumbers = appFiles.map(migrationNumber);
const mirrorNumbers = mirrorFiles.map(migrationNumber);

assert.equal(appFiles.length, LAST, `API migration source must contain exactly ${LAST} numbered migrations`);
assert.equal(mirrorFiles.length, LAST, `database/ migration mirror must contain exactly ${LAST} numbered migrations`);
assert.deepEqual(appNumbers, expectedNumbers, 'API migration sequence must be contiguous from 001 through 070');
assert.deepEqual(mirrorNumbers, expectedNumbers, 'database migration sequence must be contiguous from 001 through 070');

const checksumsSource = fs.readFileSync(checksumPath, 'utf8');
const registrySource = fs.readFileSync(registryPath, 'utf8');
const checksumEntries = new Map(
  Array.from(checksumsSource.matchAll(/'([0-9]{3}_[a-z0-9_]+)'\s*:\s*'([a-f0-9]{40})'/g), m => [m[1], m[2]])
);
assert.equal(checksumEntries.size, LAST, `checksum manifest must have exactly ${LAST} unique entries`);

for (const file of appFiles) {
  const appSource = fs.readFileSync(path.join(appDir, file), 'utf8');
  const mirrorSource = fs.readFileSync(path.join(mirrorDir, file), 'utf8');
  assert.equal(mirrorSource, appSource, `database migration mirror differs from API source: ${file}`);

  const stem = file.replace(/\.ts$/, '');
  const expectedBlob = gitBlobSha(appSource);
  assert.equal(checksumEntries.get(stem), expectedBlob, `checksum mismatch for ${file}`);

  const exported = appSource.match(/export const (migration[A-Za-z0-9]+)\s*:/);
  assert.ok(exported, `migration definition export missing in ${file}`);
  assert.ok(
    registrySource.includes(`from './${stem}'`) && registrySource.includes(`migrationRunner.registerMigration(${exported[1]})`),
    `migration must be imported and registered in database/migrations/index.ts: ${file}`
  );
  assert.ok(registrySource.includes(`export * from './${stem}'`), `migration must be exported from registry: ${file}`);
  assert.match(appSource, new RegExp(`name:\\s*['"]${stem}['"]`), `migration name must match filename: ${file}`);
}

console.log(`Database migration audit PASS: ${LAST} contiguous migrations, byte-identical mirror, ${LAST} source checksums, and all registry imports/exports/registrations verified.`);
