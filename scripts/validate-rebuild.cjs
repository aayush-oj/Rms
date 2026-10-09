#!/usr/bin/env node
const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto'); const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const must=(rel)=>{const p=path.join(root,rel); if(!fs.existsSync(p)) throw new Error(`Missing ${rel}`); return p;};
const plan=JSON.parse(fs.readFileSync(must('docs/analysis/master-plan.json'))); const routes=JSON.parse(fs.readFileSync(must('validation/reference/routes.json'))); const api=JSON.parse(fs.readFileSync(must('validation/reference/api-endpoints.json'))); const tables=JSON.parse(fs.readFileSync(must('validation/reference/tables.json'))); const phases=JSON.parse(fs.readFileSync(must('validation/reference/phases-01-42.json'))); const reports=JSON.parse(fs.readFileSync(must('packages/contracts/src/financeReportCatalog.json')));
if(plan.phaseCount!==64) throw new Error('master plan phaseCount changed'); if(plan.routeCount!==142) throw new Error('routeCount changed'); if(plan.apiEndpointCount!==253) throw new Error('apiEndpointCount changed'); if(plan.tableCount!==103) throw new Error('tableCount changed');
if(routes.length!==142||api.length!==253||tables.length!==103||phases.length!==42||reports.length!==50) throw new Error('artifact cardinality mismatch');
const recovered=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else if(p.endsWith('.ts')||p.endsWith('.tsx')) recovered.push(p);}})(path.join(root,'apps/api/src'));
if(recovered.length<285) throw new Error(`Recovered source count ${recovered.length}<285`);
const mig=fs.readdirSync(path.join(root,'database/migrations')).filter(x=>/^\d{3}_.*\.ts$/.test(x)).sort(); if(mig.length!==64||!mig.every((m,i)=>Number(m.slice(0,3))===i+1)) throw new Error('Source-map migrations 001-064 not contiguous');
for(let i=1;i<=42;i++){ must(`validation/phase-reports/P${String(i).padStart(2,'0')}-reconstruction-report.json`); }
const env=fs.readFileSync(must('runtime/.env.example'),'utf8'); for (const key of ['JWT_SECRET','PLATFORM_JWT_SECRET']) { const m=env.match(new RegExp('^'+key+'=(.*)$','m')); if(m && !/^replace-with-/.test(m[1])) throw new Error('Potential non-placeholder secret in env example'); }
const dist=must('runtime/dist/server.cjs'); if(fs.statSync(dist).size<1000000) throw new Error('Runtime server artifact unexpectedly small');
const inputManifest=JSON.parse(fs.readFileSync(must('validation/reference/input-manifest.json')));
for(const item of inputManifest){const b=fs.readFileSync(path.join('/mnt/data',item.name)); const h=crypto.createHash('sha256').update(b).digest('hex'); if(h!==item.sha256) throw new Error(`Input hash mismatch: ${item.name}`);}
console.log('RestroX rebuild 01-42 validation PASS');
console.log(JSON.stringify({phases:42,canonicalRoutes:142,apiMethods:253,sqlTables:103,recoveredApiSource:recovered.length,sourceMapMigrations:64,financeReports:50},null,2));
