#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const master = JSON.parse(read('docs/analysis/master-plan.json'));
const coverage = JSON.parse(read('docs/analysis/phase-coverage-01-42.json'));
const referencePhases = JSON.parse(read('validation/reference/phases-01-42.json'));
const chain = JSON.parse(read('docs/phases/phase-01-42-chain.json'));
const routes = JSON.parse(read('validation/reference/routes.json'));
const api = JSON.parse(read('validation/reference/api-endpoints.json'));
const tables = JSON.parse(read('validation/reference/tables.json'));
const reportCatalog = JSON.parse(read('packages/contracts/src/financeReportCatalog.json'));
const inputManifest = JSON.parse(read('validation/reference/input-manifest.json'));
const phaseIds = master.phases.map(p => p.id);
assert.equal(master.phaseCount, 64, 'canonical plan must declare 64 phases');
assert.equal(master.phases.length, 64, 'canonical plan must contain 64 phase records');
assert.deepEqual(phaseIds, Array.from({length:64}, (_,i)=>'P'+String(i+1).padStart(2,'0')), 'phase IDs must be contiguous P01-P64');
assert.equal(coverage.length, 42, 'P01-P42 coverage register cardinality');
assert.deepEqual(coverage.map(p=>p.phase), phaseIds.slice(0,42), 'coverage must be contiguous P01-P42');
assert.equal(referencePhases.length, 42, 'phase reference cardinality');
assert.deepEqual(referencePhases.map(p=>p.id), phaseIds.slice(0,42), 'phase reference must match P01-P42 plan');
for (let i=1; i<=42; i++) {
  const id='P'+String(i).padStart(2,'0');
  assert.ok(exists('validation/phase-reports/'+id+'-reconstruction-report.json'), 'missing phase report '+id);
  const p=referencePhases[i-1];
  for (const key of ['name','objective','dependencies','testPlan','acceptanceCriteria','rollbackPlan','completionDefinition']) {
    assert.ok(typeof p[key]==='string' && p[key].trim(), id+' missing '+key);
  }
}
assert.ok(exists('docs/phases/phase-00-baseline-audit.md'), 'P00 baseline audit must exist');
assert.ok(exists('docs/phases/phase-43-global-reports.md'), 'P43 phase report must exist');
assert.equal(routes.length, 142, 'canonical route count');
assert.equal(api.length, 253, 'API contract count');
assert.equal(tables.length, 103, 'SQL entity count');
assert.equal(reportCatalog.length, 50, 'Finance Reports catalog count');
const sourceFiles=[];
(function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.tsx?$/.test(entry.name))sourceFiles.push(p);}})(path.join(root,'apps/api/src'));
assert.ok(sourceFiles.length>=285, 'recovered API source count unexpectedly low: '+sourceFiles.length);
const migrations=fs.readdirSync(path.join(root,'database/migrations')).filter(f=>/^\d{3}_.*\.ts$/.test(f)).sort();
assert.equal(migrations.length,64,'editable source-map migration count');
assert.ok(migrations.every((m,i)=>Number(m.slice(0,3))===i+1),'editable migrations must be contiguous 001-064');
const env=read('runtime/.env.example');
for(const key of ['JWT_SECRET','PLATFORM_JWT_SECRET']) {
  const match=env.match(new RegExp('^'+key+'=(.*)$','m'));
  assert.ok(match && /^replace-with-/.test(match[1]), key+' must be placeholder-only in env example');
}
const reportDoc=read('docs/phases/phase-43-global-reports.md');
assert.match(reportDoc,/Full P01–P43 regression verification twice: not run/,'P43 report must keep full regression status honest');
const ledger=read('docs/PHASE-LEDGER.md');
assert.match(ledger,/P43 status:\*\* In progress/,'P43 must not be marked complete before the regression gate');
const missingInputs=[];
const verifiedInputs=[];
for(const item of inputManifest) {
  const file=path.join('/mnt/data',item.name);
  if(!fs.existsSync(file)) { missingInputs.push(item.name); continue; }
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(hash,item.sha256,'input hash mismatch for '+item.name);
  verifiedInputs.push(item.name);
}
console.log(JSON.stringify({
  result:'STRUCTURAL AUDIT PASS; FULL REGRESSION NOT CERTIFIED',
  planPhases:master.phases.length,
  historicalPhaseRecords:coverage.length,
  phaseReportsPresent:42,
  canonicalRoutes:routes.length,
  apiContracts:api.length,
  sqlEntities:tables.length,
  financeReportCatalog:reportCatalog.length,
  recoveredApiSourceFiles:sourceFiles.length,
  sourceMapMigrations:migrations.length,
  suppliedEvidenceInputsVerified:verifiedInputs.length,
  suppliedEvidenceInputsMissing:missingInputs,
  historicalChainStatus:chain.status,
  p43Status:'IN_PROGRESS',
},null,2));
