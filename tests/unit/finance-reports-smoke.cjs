const fs=require('node:fs'); const path=require('node:path'); const root=path.resolve(__dirname,'../..');
const routes=JSON.parse(fs.readFileSync(path.join(root,'packages/contracts/src/financeReportCatalog.json')));
if(routes.length!==50) throw new Error(`expected 50 P42 routes, got ${routes.length}`);
const ids=new Set(), paths=new Set();
for(const r of routes){ if(ids.has(r.id)||paths.has(r.path)) throw new Error('duplicate report id/path'); ids.add(r.id); paths.add(r.path); if(r.path!='/en/finance/reports' && !r.path.startsWith('/en/finance/reports/')) throw new Error(r.path); if(r.queryLimit!==1000) throw new Error(r.path); if(!r.tenantScoped) throw new Error(r.path); }
const dynamic=routes.find(r=>r.slug==='sales-ledger/:accountId'); if(!dynamic||dynamic.dynamicParams[0]!=='accountId') throw new Error('dynamic sales-ledger contract missing');
console.log('P42 report route smoke PASS (50 routes)');
