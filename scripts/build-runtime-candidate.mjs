#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'runtime', 'dist');
const entry = path.join(root, 'apps', 'api', 'src', 'server.ts');
const ui = path.join(root, 'apps', 'web', 'public', 'inventory.html');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')} (exit ${result.status})`);
}

if (!fs.existsSync(entry)) throw new Error('Missing API entry point');
if (!fs.existsSync(ui)) throw new Error('Missing inventory workspace');

function restoreMissingServerSources() {
  const mapPath = path.join(dist, 'server.cjs.map');
  if (!fs.existsSync(mapPath)) throw new Error('Cannot safely rebuild without the preserved runtime source map');
  const sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  if (!Array.isArray(sourceMap.sources) || !Array.isArray(sourceMap.sourcesContent)) {
    throw new Error('Preserved runtime source map does not contain embedded source content');
  }
  const restored = [];
  for (let i = 0; i < sourceMap.sources.length; i += 1) {
    const source = String(sourceMap.sources[i] || '').replace(/\\\\/g, '/');
    const match = source.match(/(?:^|\\/)server\\/(.+\\.(?:ts|tsx))$/);
    const content = sourceMap.sourcesContent[i];
    if (!match || typeof content !== 'string') continue;
    const relative = path.posix.join('server', match[1]);
    const destination = path.join(root, 'apps', 'api', 'src', ...relative.split('/'));
    if (fs.existsSync(destination)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { encoding: 'utf8', flag: 'wx' });
    restored.push(path.relative(root, destination));
  }
  return restored;
}

fs.mkdirSync(dist, { recursive: true });
const restoredSources = restoreMissingServerSources();
console.log(`Restored ${restoredSources.length} missing API source files from the preserved bundle source map.`);
run(path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  '--sourcemap',
  `--outfile=${path.join(dist, 'server.cjs')}`,
  `--metafile=${path.join(dist, 'server.meta.json')}`,
  '--external:vite',
  '--external:bufferutil',
  '--external:utf-8-validate',
]);

const meta = JSON.parse(fs.readFileSync(path.join(dist, 'server.meta.json'), 'utf8'));
const inputs = Object.keys(meta.inputs);
if (!inputs.some((p) => /modules\/inventory\/router\.ts$/.test(p))) {
  throw new Error('Production bundle does not include the inventory router');
}
if (!inputs.some((p) => /routes\/index\.ts$/.test(p))) {
  throw new Error('Production bundle does not include the canonical API route registry');
}
const migrationNumbers = inputs
  .map((p) => p.match(/db\/migrations\/(\d{3})_[^/]+\.ts$/))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);
if (migrationNumbers.length !== 64 || migrationNumbers.some((n, i) => n !== i + 1)) {
  throw new Error(`Expected source migrations 001–064 exactly; found ${migrationNumbers.length}`);
}
const bundle = path.join(dist, 'server.cjs');
if (fs.statSync(bundle).size < 1_000_000) {
  throw new Error('Built production server is unexpectedly small');
}
fs.copyFileSync(ui, path.join(dist, 'inventory.html'));
console.log(JSON.stringify({
  entry: path.relative(root, entry),
  bundleBytes: fs.statSync(bundle).size,
  sourceMigrations: migrationNumbers.length,
  inventoryRouterIncluded: true,
  inventoryWorkspaceCopied: true,
}, null, 2));
