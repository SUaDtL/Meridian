import type { RenderResult, StudioDocument } from '../types';
import { getTheme } from './themes';

const NS = 'http://www.w3.org/2000/svg';

function element<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function parseSvg(text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('Could not prepare the SVG export. Render the diagram again.');
  return doc.documentElement as unknown as SVGSVGElement;
}

function wrap(value: string, max: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > max) { lines.push(line); line = ''; }
    if (word.length > max) {
      if (line) { lines.push(line); line = ''; }
      for (let index = 0; index < word.length; index += max) lines.push(word.slice(index, index + max));
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export function buildExportSvg(result: RenderResult, doc: StudioDocument, opts: { transparent?: boolean; animated?: boolean; includeFrame?: boolean } = {}): string {
  const source = parseSvg(result.svg);
  const xml = source.ownerDocument;
  const settings = doc.settings;
  const theme = getTheme(settings.theme);
  const framed = opts.includeFrame !== false;
  source.querySelectorAll('[data-element-key], [data-node-key]').forEach((node) => {
    node.removeAttribute('tabindex'); node.removeAttribute('role'); node.removeAttribute('aria-label'); node.removeAttribute('aria-pressed');
    node.classList.remove('is-focused', 'is-dimmed', 'is-selected', 'focused', 'dimmed', 'selected', 'studio-selected', 'studio-dimmed');
    (node as SVGElement).style.removeProperty('cursor');
  });
  source.querySelectorAll('.studio-edge-dimmed').forEach((node) => node.classList.remove('studio-edge-dimmed'));
  if (!opts.animated) {
    source.querySelectorAll('[data-studio-motion], animate, animateMotion, animateTransform, set, .edge-step-dot, .edge-step-highlight').forEach((node) => node.remove());
    const staticStyle = element(xml, 'style');
    staticStyle.textContent = `#${source.id}, #${source.id} * { animation: none !important; transition: none !important; }`;
    source.append(staticStyle);
  }
  source.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  source.style.removeProperty('max-width');
  source.style.removeProperty('width');
  source.style.removeProperty('height');
  const pad = framed ? Math.max(0, Math.min(240, Number.isFinite(settings.padding) ? settings.padding : 48)) : 12;
  let width = Math.max(result.width + 2 * pad, framed && settings.showTitle ? 640 : 120);
  const titleLines = framed && settings.showTitle ? wrap(doc.title || 'Untitled diagram', Math.max(24, Math.floor((width - 2 * pad) / 16))) : [];
  const subtitleLines = framed && settings.showTitle && doc.subtitle ? wrap(doc.subtitle, Math.max(36, Math.floor((width - 2 * pad) / 8.5))) : [];
  const headingHeight = titleLines.length ? titleLines.length * 34 + subtitleLines.length * 23 + 30 : 0;
  const footerHeight = framed && settings.showBrand ? 30 : 0;
  let height = result.height + 2 * pad + headingHeight + footerHeight;
  if (framed && settings.frame !== 'auto') {
    const ratio = settings.frame === '16:9' ? 16 / 9 : settings.frame === '4:3' ? 4 / 3 : 1;
    if (width / height < ratio) width = height * ratio;
    else height = width / ratio;
  }
  width = Math.ceil(width); height = Math.ceil(height);
  const outer = element(xml, 'svg', { xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': `${source.id}-title`, 'aria-describedby': `${source.id}-description` });
  outer.setAttribute('data-meridian-export', 'true');
  const title = element(xml, 'title', { id: `${source.id}-title` }); title.textContent = doc.title || 'Untitled diagram';
  const description = element(xml, 'desc', { id: `${source.id}-description` }); description.textContent = doc.subtitle || `${result.diagramType} diagram created with Meridian.`;
  outer.append(title, description);
  const defs = element(xml, 'defs');
  outer.append(defs);
  if (!opts.transparent) {
    outer.append(element(xml, 'rect', { x: 0, y: 0, width, height, fill: theme.canvas }));
    if (framed && settings.background !== 'none') {
      const patternId = `${source.id}-export-pattern`;
      const pattern = element(xml, 'pattern', { id: patternId, width: 24, height: 24, patternUnits: 'userSpaceOnUse' });
      if (settings.background === 'dots') pattern.append(element(xml, 'circle', { cx: 1, cy: 1, r: 0.8, fill: theme.border, opacity: 0.26 }));
      else pattern.append(element(xml, 'path', { d: 'M 24 0 L 0 0 0 24', fill: 'none', stroke: theme.border, 'stroke-width': 0.7, opacity: 0.18 }));
      defs.append(pattern);
      outer.append(element(xml, 'rect', { width, height, fill: `url(#${patternId})` }));
    }
    if (framed && settings.ambient) {
      const ambientId = `${source.id}-ambient`;
      const gradient = element(xml, 'radialGradient', { id: ambientId, cx: '50%', cy: '35%', r: '65%' });
      gradient.append(element(xml, 'stop', { offset: '0%', 'stop-color': theme.accent, 'stop-opacity': theme.dark ? 0.07 : 0.04 }), element(xml, 'stop', { offset: '100%', 'stop-color': theme.accent, 'stop-opacity': 0 }));
      defs.append(gradient);
      outer.append(element(xml, 'rect', { width, height, fill: `url(#${ambientId})` }));
    }
  }
  const font = settings.font === 'mono' ? 'Consolas, "Liberation Mono", monospace' : 'Arial, Helvetica, sans-serif';
  if (titleLines.length) {
    titleLines.forEach((line, index) => {
      const node = element(xml, 'text', { x: pad, y: pad + 24 + index * 34, fill: theme.text, 'font-size': 28, 'font-weight': 600, 'font-family': font });
      node.textContent = line; outer.append(node);
    });
    subtitleLines.forEach((line, index) => {
      const node = element(xml, 'text', { x: pad, y: pad + titleLines.length * 34 + 18 + index * 23, fill: theme.muted, 'font-size': 15, 'font-family': font });
      node.textContent = line; outer.append(node);
    });
  }
  source.setAttribute('x', String(pad));
  source.setAttribute('y', String(pad + headingHeight));
  source.setAttribute('width', String(width - 2 * pad));
  source.setAttribute('height', String(height - 2 * pad - headingHeight - footerHeight));
  source.style.overflow = 'visible';
  outer.append(source);
  if (footerHeight) {
    const brand = element(xml, 'text', { x: width - pad, y: height - pad + 4, 'text-anchor': 'end', fill: theme.muted, 'font-size': 11, 'font-family': 'Arial, Helvetica, sans-serif', 'letter-spacing': 1.8 });
    brand.textContent = 'MERIDIAN / ARBITERFORGE'; outer.append(brand);
  }
  return new XMLSerializer().serializeToString(outer);
}

function filename(value: string, extension: string): string {
  const safe = value.replace(/\.(?:svg|png|html|mmd|json)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 120) || 'meridian-diagram';
  return `${safe}.${extension}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadSvg(svg: string, name: string): void {
  download(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml;charset=utf-8' }), filename(name, 'svg'));
}

export async function exportPng(svg: string, name: string, scale: number): Promise<{ width: number; height: number }> {
  const parsed = parseSvg(svg);
  const naturalWidth = parseFloat(parsed.getAttribute('width') ?? '');
  const naturalHeight = parseFloat(parsed.getAttribute('height') ?? '');
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) throw new Error('The diagram does not have valid export dimensions.');
  const wantedScale = Number.isFinite(scale) ? Math.max(1, Math.min(4, scale)) : 2;
  const actualScale = Math.min(wantedScale, 8192 / naturalWidth, 8192 / naturalHeight, Math.sqrt(32_000_000 / (naturalWidth * naturalHeight)));
  const width = Math.max(1, Math.floor(naturalWidth * actualScale));
  const height = Math.max(1, Math.floor(naturalHeight * actualScale));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The browser could not rasterize this SVG. Try SVG export or a simpler diagram.')); image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is not supported in this browser. Use SVG export instead.');
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      try { canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG export exceeded the browser memory limit. Try 1× scale.')), 'image/png'); }
      catch { reject(new Error('The browser blocked PNG export. Use a diagram without external resources.')); }
    });
    download(blob, filename(name, 'png'));
    return { width, height };
  } finally { URL.revokeObjectURL(url); }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

export function exportPresentation(svg: string, doc: StudioDocument): void {
  const theme = getTheme(doc.settings.theme);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title)} · Meridian</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:${theme.canvas};color:${theme.text};font-family:Arial,Helvetica,sans-serif}body{display:flex;flex-direction:column}main{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:24px}main>svg{display:block;max-width:100%;max-height:100%;width:auto;height:auto}body.actual main{align-items:flex-start;justify-content:flex-start}body.actual main>svg{max-width:none;max-height:none;flex-shrink:0}footer{display:flex;gap:10px;justify-content:center;align-items:center;padding:14px 20px;border-top:1px solid ${theme.border};background:${theme.canvasRaised}}button{font:inherit;font-size:14px;padding:9px 14px;border-radius:7px;border:1px solid ${theme.border};background:transparent;color:${theme.text};cursor:pointer}button:hover,button:focus-visible{border-color:${theme.accent};outline:none}button:focus-visible{outline:2px solid ${theme.accent};outline-offset:3px}.paused svg *{animation-play-state:paused!important}.quiet{font-size:12px;color:${theme.muted};margin-left:8px}@media(max-width:640px){main{padding:8px}footer{flex-wrap:wrap;gap:6px;padding:10px}.quiet{width:100%;text-align:center}}@media(prefers-reduced-motion:reduce){svg *{animation:none!important;transition:none!important}.meridian-motion{display:none!important}}@media print{footer{display:none}main{padding:0}body{height:auto}}
</style></head><body><main aria-label="Diagram presentation">${svg}</main><footer><button id="pause" type="button">Pause motion</button><button id="replay" type="button">Replay</button><button id="fit" type="button">Actual size</button><button id="fullscreen" type="button">Fullscreen</button><span class="quiet" id="status" role="status">Space to pause · R to replay · F for fullscreen</span></footer>
<script>
const body=document.body,root=document.querySelector('main>svg'),pause=document.getElementById('pause');
function togglePause(){body.classList.toggle('paused');const paused=body.classList.contains('paused');pause.textContent=paused?'Resume motion':'Pause motion';document.querySelectorAll('svg').forEach(s=>{if(paused&&s.pauseAnimations)s.pauseAnimations();else if(s.unpauseAnimations)s.unpauseAnimations()})}
function replay(){body.classList.remove('paused');pause.textContent='Pause motion';root.querySelectorAll('.meridian-motion').forEach(el=>{const animation=el.style.animation;el.style.animation='none';void el.getBoundingClientRect();el.style.animation=animation});document.querySelectorAll('svg').forEach(s=>{if(s.setCurrentTime)s.setCurrentTime(0);if(s.unpauseAnimations)s.unpauseAnimations()})}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{document.getElementById('status').textContent='Fullscreen is unavailable in this browser.'}}
pause.addEventListener('click',togglePause);document.getElementById('replay').addEventListener('click',replay);document.getElementById('fit').addEventListener('click',function(){body.classList.toggle('actual');this.textContent=body.classList.contains('actual')?'Fit to screen':'Actual size'});document.getElementById('fullscreen').addEventListener('click',fullscreen);document.addEventListener('keydown',event=>{if(event.target instanceof HTMLButtonElement)return;if(event.code==='Space'){event.preventDefault();togglePause()}if(event.key.toLowerCase()==='r')replay();if(event.key.toLowerCase()==='f')fullscreen()});
</script></body></html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), filename(doc.title, 'html'));
}
