import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(join(root, 'standalone/Meridian.html'));
const destination = join(root, 'site');
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
await writeFile(join(destination, 'index.html'), html);
await writeFile(join(destination, '.nojekyll'), '');
let commit = 'working-copy';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
await writeFile(join(destination, 'build.json'), JSON.stringify({
  repository: 'SUaDtL/Meridian',
  commit,
  artifact: 'index.html',
  bytes: html.length,
  sha256: createHash('sha256').update(html).digest('hex'),
}, null, 2) + '\n');
console.log(`Pages artifact: ${destination}/index.html (${html.length.toLocaleString()} bytes)`);
