import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist');
const manifest = JSON.parse(await readFile(join(source, '.vite/manifest.json'), 'utf8'));
const destination = join(root, 'site');
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
await rm(join(destination, '.vite'), { recursive: true });
let html = await readFile(join(destination, 'index.html'), 'utf8');
const policyTag = /<meta\b(?=[^>]*http-equiv="Content-Security-Policy")[^>]*>/i;
if (!policyTag.test(html)) throw new Error('Missing production CSP.');
// Local script chunks are lazy-loaded; diagrams and projects still make no
// runtime fetches or connections. Inline application scripts remain forbidden.
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
html = html.replace(policyTag, `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
await writeFile(join(destination, 'index.html'), html);
await writeFile(join(destination, '.nojekyll'), '');

const assets = [];
async function inventory(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await inventory(join(directory, entry.name), path + '/');
    else if (entry.isFile()) {
      const bytes = await readFile(join(directory, entry.name));
      assets.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    } else throw new Error(`Unexpected non-file in Pages build: ${path}`);
  }
}
await inventory(destination);
const byPath = new Map(assets.map(asset => [asset.path, asset]));
const initial = new Set(['index.html', 'favicon.svg']);
const visited = new Set();
function entryAssets(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const chunk = manifest[name];
  if (!chunk) throw new Error(`Missing generated chunk: ${name}`);
  for (const path of [chunk.file, ...(chunk.css || []), ...(chunk.assets || [])]) {
    if (!byPath.has(path)) throw new Error(`Unpublished entry asset: ${path}`);
    initial.add(path);
  }
  for (const dependency of chunk.imports || []) entryAssets(dependency);
}
entryAssets('index.html');
for (const chunk of Object.values(manifest)) {
  for (const path of [chunk.file, ...(chunk.css || []), ...(chunk.assets || [])]) {
    if (!byPath.has(path)) throw new Error(`Unpublished lazy asset: ${path}`);
  }
  for (const dependency of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) {
    if (!manifest[dependency]) throw new Error(`Unresolved local module: ${dependency}`);
  }
}
let commit = 'working-copy';
let workingTreeDirty = true;
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  workingTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
} catch {}
const index = byPath.get('index.html');
const initialAssets = [...initial].sort();
const initialBytes = initialAssets.reduce((total, path) => total + byPath.get(path).bytes, 0);
const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
await writeFile(join(destination, 'build.json'), JSON.stringify({
  repository: 'SUaDtL/Meridian',
  commit,
  workingTreeDirty,
  format: 'split-v1',
  artifact: 'index.html',
  bytes: index.bytes,
  sha256: index.sha256,
  initialAssets,
  initialBytes,
  totalBytes,
  assets,
}, null, 2) + '\n');
console.log(`Pages artifact: ${destination}/index.html (${index.bytes.toLocaleString()} bytes)`);
console.log(`Initial assets: ${initialBytes.toLocaleString()} bytes; ${assets.length} local files, ${totalBytes.toLocaleString()} bytes total.`);
console.log('Every published asset is recorded with byte count and SHA-256 in build.json.');
