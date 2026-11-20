import { build } from 'vite';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'meridian-standalone-'));

function assetPath(url) {
  if (/^(?:[a-z]+:|\/\/)/i.test(url)) throw new Error(`Expected a local build asset, received ${url}`);
  const result = resolve(temporary, url.replace(/^\.\//, ''));
  if (!result.startsWith(temporary + sep)) throw new Error('Build asset escaped its output directory.');
  return result;
}

try {
  const result = await build({
    root,
    configFile: join(root, 'vite.standalone.config.ts'),
    build: { outDir: temporary, emptyOutDir: true },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output ?? []);
  const chunks = outputs.filter(item => item.type === 'chunk');
  // Rolldown can retain self-references in dynamicImports metadata after inlining.
  // Reject other chunks and any actual import() expression in the emitted code.
  if (chunks.length !== 1 || chunks[0].imports.length ||
      chunks[0].dynamicImports.some(name => name !== chunks[0].fileName) ||
      /\bimport\s*\(/.test(chunks[0].code)) {
    throw new Error('Standalone build requires one JavaScript chunk with no remaining module imports.');
  }
  const unexpectedAssets = outputs.filter(item => item.type === 'asset' && !/\.(?:css|html)$/.test(item.fileName));
  if (unexpectedAssets.length) {
    throw new Error(`Standalone build contains unembedded assets: ${unexpectedAssets.map(item => item.fileName).join(', ')}`);
  }

  let html = await readFile(join(temporary, 'index.html'), 'utf8');
  const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gi)];
  if (scriptTags.length !== 1) throw new Error('Expected exactly one generated application script.');
  const source = await readFile(assetPath(scriptTags[0][1]), 'utf8');
  // HTML terminates a script element before JavaScript string parsing. Escaping
  // a closing tag preserves JS string values while preventing early termination.
  const inlineScript = source.replace(/<\/script/gi, '<\\/script');
  const hash = createHash('sha256').update(inlineScript, 'utf8').digest('base64');
  html = html.replace(scriptTags[0][0], () => `<script type="module">${inlineScript}</script>`);

  const cssTags = [...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"[^>]*>/gi)];
  if (cssTags.length !== 1) throw new Error('Expected exactly one generated stylesheet.');
  const css = await readFile(assetPath(cssTags[0][1]), 'utf8');
  if (/@import\s+(?:url\(|["'])/i.test(css)) throw new Error('Standalone stylesheet contains an external import.');
  html = html.replace(cssTags[0][0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);

  const favicon = await readFile(join(root, 'public/favicon.svg'));
  html = html.replace(/<link\b(?=[^>]*\brel="icon")[^>]*>/i,
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${favicon.toString('base64')}" />`);

  // React and Mermaid generate style attributes and style elements at runtime.
  // Script execution is authorized only by this build's exact content hash.
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const policyTag = /<meta\b(?=[^>]*http-equiv="Content-Security-Policy")[^>]*>/i;
  if (!policyTag.test(html)) throw new Error('The source document is missing its CSP meta tag.');
  html = html.replace(policyTag, `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);

  // Preserve dependency attribution in the portable file without introducing
  // another executable script or exposing notice text to HTML parsing.
  const notices = await readFile(join(root, 'public/THIRD-PARTY-NOTICES.txt'), 'utf8');
  const escapedNotices = notices.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose === -1) throw new Error('The application document has no closing body element.');
  html = `${html.slice(0, bodyClose)}<pre id="third-party-notices" hidden aria-hidden="true">${escapedNotices}</pre>\n${html.slice(bodyClose)}`;

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > 10 * 1024 * 1024) throw new Error(`Standalone HTML is too large: ${bytes.toLocaleString()} bytes.`);
  const directory = join(root, 'standalone');
  await mkdir(directory, { recursive: true });
  const destination = join(directory, 'Meridian.html');
  await writeFile(destination, html, 'utf8');
  console.log(`Standalone application: ${destination}`);
  console.log(`${(bytes / 1024 / 1024).toFixed(2)} MiB; one embedded module, one stylesheet, no external application assets.`);
  console.log('Dependency attribution is retained in the hidden third-party-notices text element.');
  console.log(`Inline script CSP: sha256-${hash}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
