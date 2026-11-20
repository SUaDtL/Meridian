import type { RenderResult, StudioDocument } from '../types';
import { getTheme } from './themes';
import { createStoryboardRuntime, validateStoryboard } from './storyboard';
import { downloadBlob, safeFilename } from './download';

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

let textMeasure: CanvasRenderingContext2D | null | undefined;
function wrapHeading(value: string, characters: number, width: number, font: string): string[] {
  const lines = wrap(value, characters);
  textMeasure ??= document.createElement('canvas').getContext('2d');
  if (!textMeasure) return lines;
  textMeasure.font = font;
  const measured: string[] = [];
  for (const line of lines) {
    let remaining = line;
    while (remaining && textMeasure.measureText(remaining).width > width) {
      let low = 1, high = remaining.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (textMeasure.measureText(remaining.slice(0, middle)).width <= width) low = middle;
        else high = middle - 1;
      }
      const space = remaining.lastIndexOf(' ', low);
      const end = space > 0 ? space : low;
      measured.push(remaining.slice(0, end).trimEnd());
      remaining = remaining.slice(end).trimStart();
    }
    if (remaining) measured.push(remaining);
  }
  return measured;
}

export interface ExportFrameOptions { transparent?: boolean; animated?: boolean; includeFrame?: boolean }
export interface ExportFrame { svg: string; width: number; height: number }

/** Build framing and dimensions together so the stage never reparses the result. */
export function buildExportFrame(result: RenderResult, doc: StudioDocument, opts: ExportFrameOptions = {}): ExportFrame {
  const source = parseSvg(result.svg);
  const xml = source.ownerDocument;
  const settings = doc.settings;
  const theme = getTheme(settings.theme);
  const framed = opts.includeFrame !== false;
  source.querySelectorAll('[data-node-key], [data-element-key]').forEach((node) => {
    node.removeAttribute('tabindex'); node.removeAttribute('role'); node.removeAttribute('aria-label'); node.removeAttribute('aria-pressed');
    node.classList.remove('is-focused', 'is-dimmed', 'is-selected', 'focused', 'dimmed', 'selected', 'studio-selected', 'studio-dimmed');
    // Selection is represented by classes. Inline opacity belongs to a saved
    // design override (for example muted emphasis) and must survive exports.
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
  const font = settings.font === 'mono' ? 'Consolas, "Liberation Mono", monospace' : 'Arial, Helvetica, sans-serif';
  const titleLines = framed && settings.showTitle ? wrapHeading(doc.title || 'Untitled diagram', Math.max(24, Math.floor((width - 2 * pad) / 16)), width - 2 * pad, `600 28px ${font}`) : [];
  const subtitleLines = framed && settings.showTitle && doc.subtitle ? wrapHeading(doc.subtitle, Math.max(36, Math.floor((width - 2 * pad) / 8.5)), width - 2 * pad, `15px ${font}`) : [];
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
  if (titleLines.length) {
    titleLines.forEach((line, index) => {
      const node = element(xml, 'text', { x: pad, y: pad + 24 + index * 34, fill: theme.text, 'font-size': 28, 'font-weight': 600, 'font-family': font, 'data-frame-label': 'title' });
      node.textContent = line; outer.append(node);
    });
    subtitleLines.forEach((line, index) => {
      const node = element(xml, 'text', { x: pad, y: pad + titleLines.length * 34 + 18 + index * 23, fill: theme.muted, 'font-size': 15, 'font-family': font, 'data-frame-label': 'subtitle' });
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
  return { svg: new XMLSerializer().serializeToString(outer), width, height };
}

export function buildExportSvg(result: RenderResult, doc: StudioDocument, opts: ExportFrameOptions = {}): string {
  return buildExportFrame(result, doc, opts).svg;
}

function filename(value: string, extension: string): string {
  return `${safeFilename(value.replace(/\.(?:svg|png|html|mmd|json)$/i, ''))}.${extension}`;
}

export function downloadSvg(svg: string, name: string): void {
  downloadBlob(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml;charset=utf-8' }), filename(name, 'svg'));
}

export function pngDimensions(naturalWidth: number, naturalHeight: number, scale: number): { width: number; height: number } {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) throw new Error('The diagram does not have valid export dimensions.');
  const wantedScale = Number.isFinite(scale) ? Math.max(1, Math.min(4, scale)) : 2;
  const actualScale = Math.min(wantedScale, 8192 / naturalWidth, 8192 / naturalHeight, Math.sqrt(32_000_000 / (naturalWidth * naturalHeight)));
  const width = Math.max(1, Math.floor(naturalWidth * actualScale));
  const height = Math.max(1, Math.floor(naturalHeight * actualScale));
  return { width, height };
}

export async function exportPng(svg: string, name: string, scale: number): Promise<{ width: number; height: number }> {
  const parsed = parseSvg(svg);
  const { width, height } = pngDimensions(parseFloat(parsed.getAttribute('width') ?? ''), parseFloat(parsed.getAttribute('height') ?? ''), scale);
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
    downloadBlob(blob, filename(name, 'png'));
    return { width, height };
  } finally { URL.revokeObjectURL(url); }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function buildLegacyPresentationHtml(svg: string, doc: StudioDocument): string {
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
  return html;
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Export the exact same timeline engine used by the studio, with no runtime imports. */
export async function buildPresentationHtml(svg: string, doc: StudioDocument): Promise<string> {
  const story = validateStoryboard(doc.storyboard);
  let html: string;
  if (!story.scenes.length) html = buildLegacyPresentationHtml(svg, doc);
  else {
    const theme = getTheme(doc.settings.theme);
    const sceneOptions = story.scenes.map((scene, index) => `<option value="${index}">${index + 1}. ${escapeHtml(scene.title || `Scene ${index + 1}`)}</option>`).join('');
    // This function has no closure dependencies. Its compiled text is used so
    // TypeScript syntax cannot escape into the portable presentation.
    const runtime = createStoryboardRuntime.toString();
    const script = `
const createPlayer=(${runtime})().createPlayer;
const story=${safeScriptJson(story)};
const accent=${safeScriptJson(theme.accent)};
const root=document.querySelector('main>svg'),playButton=document.getElementById('play'),seekInput=document.getElementById('seek'),sceneSelect=document.getElementById('scene'),timeOutput=document.getElementById('time'),sceneTitle=document.getElementById('scene-title');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function stamp(value){const seconds=Math.max(0,Math.floor(value));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')}
function update(state){playButton.textContent=state.playing?'Pause':'Play';playButton.setAttribute('aria-label',state.playing?'Pause presentation':'Play presentation');seekInput.max=String(state.duration);seekInput.value=String(state.time);seekInput.setAttribute('aria-valuetext',state.preview?'Preview of scene '+(state.sceneIndex+1):stamp(state.time)+' of '+stamp(state.duration));timeOutput.textContent=state.preview?'Scene '+(state.sceneIndex+1)+' / '+story.scenes.length+' · Preview':stamp(state.time)+' / '+stamp(state.duration);sceneSelect.value=String(state.sceneIndex);const scene=story.scenes[state.sceneIndex];sceneTitle.textContent=scene?scene.title:'';document.getElementById('previous').disabled=state.sceneIndex<=0;document.getElementById('next').disabled=state.sceneIndex>=story.scenes.length-1}
const player=createPlayer(root,story,{accent,reducedMotion:reduced.matches,initialPreview:0,onUpdate:update});
reduced.addEventListener('change',event=>player.setReducedMotion(event.matches));
function toggle(){if(player.getState().playing)player.pause();else player.play()}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{document.getElementById('status').textContent='Fullscreen is unavailable in this browser.'}}
playButton.addEventListener('click',toggle);document.getElementById('previous').addEventListener('click',()=>player.previous());document.getElementById('next').addEventListener('click',()=>player.next());document.getElementById('replay').addEventListener('click',()=>player.restart());document.getElementById('fullscreen').addEventListener('click',fullscreen);
// Capture user input before pause synchronously reports the previous playhead.
seekInput.addEventListener('input',()=>{const requestedTime=Number(seekInput.value);player.pause();player.seek(requestedTime)});sceneSelect.addEventListener('change',()=>{const requestedIndex=Number(sceneSelect.value);player.preview(requestedIndex)});document.getElementById('loop').addEventListener('change',event=>{story.loop=event.target.checked});
document.addEventListener('keydown',event=>{if(event.target.closest('input,select,textarea,button,[contenteditable]'))return;if(event.code==='Space'){event.preventDefault();toggle()}else if(event.key==='ArrowRight'){event.preventDefault();player.next()}else if(event.key==='ArrowLeft'){event.preventDefault();player.previous()}else if(event.key.toLowerCase()==='r'){event.preventDefault();player.restart()}else if(event.key.toLowerCase()==='f'){event.preventDefault();fullscreen()}});
`;
    html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title)} · Meridian</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:${theme.canvas};color:${theme.text};font-family:Arial,Helvetica,sans-serif}body{display:flex;flex-direction:column}header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 24px;border-bottom:1px solid ${theme.border}}header>strong{font-size:13px;font-weight:500;letter-spacing:.1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}header>span{font-size:11px;color:${theme.muted};flex-shrink:0}main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:18px;overflow:hidden}main>svg{display:block;max-width:100%;max-height:100%;width:auto;height:auto;overflow:hidden}footer{padding:15px 24px;border-top:1px solid ${theme.border};background:${theme.canvasRaised}}.timeline{display:flex;align-items:center;gap:14px;max-width:1050px;margin:0 auto 12px}.timeline input{flex:1;min-width:60px;accent-color:${theme.accent}}output{font:12px ui-monospace,Consolas,monospace;color:${theme.muted};white-space:nowrap}.controls{display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap}button,select{font:inherit;font-size:12px;padding:9px 12px;border-radius:6px;border:1px solid ${theme.border};background:${theme.canvas};color:${theme.text};cursor:pointer}button:hover,select:hover{border-color:${theme.accent}}button:disabled{opacity:.35;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid ${theme.accent};outline-offset:3px}#play{min-width:74px;border-color:${theme.accent};font-weight:600;color:${theme.accent}}select{max-width:240px;min-width:130px}.loop{display:flex;align-items:center;gap:5px;padding:4px;font-size:11px;color:${theme.muted}}.loop input{accent-color:${theme.accent}}.quiet{font-size:10px;color:${theme.muted};text-align:center;line-height:1.6;margin:12px 0 0}@media(max-width:640px){header{padding:11px 14px;gap:8px}header>span{display:none}main{padding:8px}footer{padding:12px}.controls{gap:6px}button,select{padding:8px;font-size:11px}select{max-width:180px}.timeline{gap:8px;margin-bottom:9px}.quiet{font-size:9px}}@media(prefers-reduced-motion:reduce){svg *{animation:none!important;transition:none!important}.meridian-motion,[data-story-flow]{display:none!important}}@media print{header,footer{display:none}main{padding:0}body{height:auto}}
</style></head><body><header><strong id="scene-title">${escapeHtml(story.scenes[0].title)}</strong><span>${escapeHtml(doc.title)} · MERIDIAN</span></header><main aria-label="Diagram presentation">${svg}</main><footer><div class="timeline"><input id="seek" type="range" min="0" max="1" value="0" step="0.05" aria-label="Presentation playhead"><output id="time">0:00</output></div><div class="controls"><button id="previous" type="button" aria-label="Previous scene">Previous</button><button id="play" type="button" aria-label="Play presentation">Play</button><button id="next" type="button" aria-label="Next scene">Next</button><button id="replay" type="button">Replay</button><select id="scene" aria-label="Choose scene">${sceneOptions}</select><button id="fullscreen" type="button">Fullscreen</button><label class="loop"><input id="loop" type="checkbox"${story.loop ? ' checked' : ''}>Loop</label></div><p class="quiet" id="status" role="status">Space to play or pause · Arrow keys for scenes · R to replay · F for fullscreen</p></footer><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error('The presentation must contain exactly one playback script.');
  if (!globalThis.crypto?.subtle) throw new Error('Presentation export needs a secure browser context. Open Meridian over HTTPS or localhost.');
  const hashBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scripts[0][1])));
  const hash = btoa(String.fromCharCode(...hashBytes));
  return html.replace("script-src 'unsafe-inline'", `script-src 'sha256-${hash}'`);
}

export async function exportPresentation(svg: string, doc: StudioDocument): Promise<void> {
  const html = await buildPresentationHtml(svg, doc);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), filename(doc.title, 'html'));
}
