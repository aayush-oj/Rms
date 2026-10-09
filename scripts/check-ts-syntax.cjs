#!/usr/bin/env node
const {execFileSync} = require('node:child_process');
const fs=require('node:fs'); const path=require('node:path');
const root=path.resolve(__dirname,'..');
function walk(d, out=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','runtime'].includes(e.name)) continue; const p=path.join(d,e.name); if(e.isDirectory()) walk(p,out); else if(p.endsWith('.ts')||p.endsWith('.tsx')) out.push(p);} return out;}
const files=walk(path.join(root,'apps'));
let bad=[]; for(const f of files){ try{execFileSync(process.execPath,['--experimental-strip-types','--check',f],{stdio:'ignore'});}catch(e){bad.push(f);} }
if(bad.length){console.error('TypeScript syntax failures:',bad.length); for(const x of bad.slice(0,20)) console.error(x); process.exit(1);} console.log(`TS syntax PASS (${files.length} files)`);
