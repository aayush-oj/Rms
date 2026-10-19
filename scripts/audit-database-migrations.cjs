'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'apps/api/src/server/db/migrations');
const mirrorDir = path.join(root, 'database/migrations');
const appChecksumPath = path.join(appDir, 'checksums.ts');
const mirrorChecksumPath = path.join(mirrorDir, 'checksums.ts');
const appRegistryPath = path.join(appDir, 'index.ts');
const mirrorRegistryPath = path.join(mirrorDir, 'index.ts');
const FIRST = 1;
const LAST = 70;
// Preserve the established migration-ledger hashes for 065-070 until the deployed
// _schema_migrations history and original source provenance can be reconciled.
const LEGACY_CHECKSUM_PROVENANCE = Object.freeze({
  '065_printer_domain_model': '328bac28554ad514a1d8e11f555ef960c6be6997',
  '066_durable_print_jobs': '86734b408d033d275d45ccae450769ad5638c0c0',
  '067_print_agent_foundation': '1b508a4df9cd1481f526a0056a4dd74646a7741c',
  '068_printing_manual_permissions': 'ec6b18fd36cd32c20ce1703b67112a09b0105824',
  '069_print_agent_pairing_tokens': '38c430acf05e4094e6a9b7383a74555e32c9f053',
  '070_print_job_retry_failover': 'ae602ac185604d6284d8424a72e58d6cd2917b73',
});

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

function expectedNumbers() {
  return Array.from({ length: LAST - FIRST + 1 }, (_, i) => i + FIRST);
}

function migrationNumber(file) {
  return Number(file.slice(0, 3));
}

function checksumEntries(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return new Map(
    Array.from(source.matchAll(/'([0-9]{3}_[a-z0-9_]+)'\s*:\s*'([a-f0-9]{40})'/g), m => [m[1], m[2]])
  );
}

const appFiles = numberedFiles(appDir);
const mirrorFiles = numberedFiles(mirrorDir);
const expected = expectedNumbers();
assert.equal(appFiles.length, LAST, `API migration source must contain exactly ${LAST} numbered migrations`);
assert.equal(mirrorFiles.length, LAST, `database migration mirror must contain exactly ${LAST} numbered migrations`);
assert.deepEqual(appFiles.map(migrationNumber), expected, 'API migration sequence must be contiguous from 001 through 070');
assert.deepEqual(mirrorFiles.map(migrationNumber), expected, 'database migration sequence must be contiguous from 001 through 070');

const appChecksums = checksumEntries(appChecksumPath);
const mirrorChecksums = checksumEntries(mirrorChecksumPath);
assert.equal(appChecksums.size, LAST, `API checksum manifest must have exactly ${LAST} unique entries`);
assert.equal(mirrorChecksums.size, LAST, `database checksum manifest must have exactly ${LAST} unique entries`);
assert.deepEqual([...mirrorChecksums], [...appChecksums], 'API and database checksum manifests must match');
assert.deepEqual(Object.keys(LEGACY_CHECKSUM_PROVENANCE).map(stem => stem + '.ts'), appFiles.slice(-6), 'checksum provenance exception list must cover exactly migrations 065-070');

const appRegistry = fs.readFileSync(appRegistryPath, 'utf8');
const mirrorRegistry = fs.readFileSync(mirrorRegistryPath, 'utf8');

for (const file of appFiles) {
  const appSource = fs.readFileSync(path.join(appDir, file), 'utf8');
  const mirrorSource = fs.readFileSync(path.join(mirrorDir, file), 'utf8');
  assert.equal(mirrorSource, appSource, `database migration mirror differs from API source: ${file}`);

  const stem = file.replace(/\.ts$/, '');
  const expectedBlob = gitBlobSha(appSource);
  if (migrationNumber(file) <= 64) {
    assert.equal(appChecksums.get(stem), expectedBlob, `API checksum mismatch for ${file}`);
  } else {
    assert.equal(appChecksums.get(stem), LEGACY_CHECKSUM_PROVENANCE[stem], `unexpected legacy checksum for ${file}`);
    assert.notEqual(appChecksums.get(stem), expectedBlob, `remove provenance exception after reconciling source for ${file}`);
  }
  assert.equal(mirrorChecksums.get(stem), appChecksums.get(stem), `database checksum mismatch for ${file}`);

  const exported = appSource.match(/export const (migration[A-Za-z0-9]+)\s*:/);
  assert.ok(exported, `migration definition export missing in ${file}`);
  for (const [label, registry] of [['API', appRegistry], ['database mirror', mirrorRegistry]]) {
    assert.ok(
      registry.includes(`from './${stem}'`) &&
      registry.includes(`migrationRunner.registerMigration(${exported[1]})`),
      `${label} registry must import and register ${file}`
    );
    assert.ok(registry.includes(`export * from './${stem}'`), `${label} registry must export ${file}`);
  }
  assert.match(appSource, new RegExp(`name:\\s*['"]${stem}['"]`), `migration name must match filename: ${file}`);
}

console.log(`Database migration audit PASS: ${LAST} contiguous migrations, byte-identical source/mirror, both ${LAST}-entry manifests and registries verified. NOTE: migrations 065-070 retain six known legacy checksum/source-hash differences; do not deploy until reconciled with the deployed migration ledger.`);
