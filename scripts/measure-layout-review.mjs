import os from 'node:os';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173/');
if (!base.pathname.endsWith('/')) base.pathname += '/';
const response = await fetch(new URL('build.json', base));
if (!response.ok) throw new Error('Serve a built production Pages artifact before measuring layouts.');
const build = await response.json();
if (build.repository !== 'SUaDtL/Meridian' || build.format !== 'split-v1'
  || build.workingTreeDirty !== false || !/^[0-9a-f]{40}$/.test(build.commit)) {
  throw new Error('Measure a clean Meridian production artifact.');
}
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });

function readLimit(path) {
  try { return readFileSync(path, 'utf8').trim(); }
  catch { return null; }
}
const standardSettings = {
  theme: 'obsidian', layout: 'dagre', curve: 'basis', spacing: 'balanced', finish: 'solid',
  shadow: false, glow: false, motion: 'none', speed: 1, background: 'none', ambient: false,
  frame: 'auto', font: 'sans', edgeWidth: 2, padding: 20, showTitle: true, showBrand: false,
};
const alternatives = ['Compact', 'Balanced', 'Presentation'];
const variants = 11;
function prepareFixture(index) {
  const label = String.fromCharCode(65 + index);
  const nodes = Array.from({ length: 50 }, (_, number) => `  N${number}["Service ${label}${number}"]`);
  const laneEdges = Array.from({ length: 45 }, (_, number) => `  N${number} lane${number}@--> N${number + 5}`);
  const crossEdges = Array.from({ length: 30 }, (_, number) => `  N${number} cross${number}@--> N${number + (number % 5 === 4 ? 1 : 6)}`);
  return {
    schema: 'meridian/v2', id: `layout-${index}`, title: `G04 layout ${label}`, subtitle: '',
    source: ['flowchart LR', ...nodes, ...laneEdges, ...crossEdges, ''].join('\n'),
    updatedAt: '2026-11-21T00:00:00Z', nodeAccents: {}, settings: standardSettings,
  };
}
const documents = Array.from({ length: variants }, (_, index) => prepareFixture(index));

async function measure(mobile) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
  try {
    const session = await page.context().newCDPSession(page);
    if (mobile) await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(({ documents }) => {
      localStorage.setItem('meridian:v2', JSON.stringify({ version: 2, activeId: documents[0].id, documents }));
    }, { documents });
    await page.goto(base.href);
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
    const batches = [];
    for (const [index, project] of documents.entries()) {
      await page.getByRole('button', { name: `Open v3 project ${project.title}` }).click({ timeout: 30000 });
      const live = page.getByRole('dialog', { name: project.title });
      await live.getByRole('img', { name: `Diagram preview for ${project.title}` }).waitFor();
      if (mobile) await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Design', exact: true }).tap();
      await live.getByRole('button', { name: 'Compare layouts', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Compare layouts' });
      const choices = dialog.getByRole('group', { name: 'Layout alternatives' });
      const samples = [];
      // Rotate the first candidate so initial work is measured for every option.
      const order = alternatives.map((_, ordinal) => alternatives[(index + ordinal) % alternatives.length]);
      for (const option of order) {
        await choices.getByRole('button', { name: new RegExp('^' + option) }).click();
        const preview = dialog.getByRole('button', { name: `Preview ${option}`, exact: true });
        await preview.evaluate((button, option) => {
          window.currentLayoutMeasurement = new Promise(resolve => {
            button.addEventListener('click', () => {
              const parent = button.closest('dialog');
              const start = performance.now();
              let priorFrame = start;
              let feedback = null;
              let longestFrameGap = 0;
              let raf;
              const taskEntries = [];
              const tasks = new PerformanceObserver(list => taskEntries.push(...list.getEntries()));
              tasks.observe({ type: 'longtask' });
              function frame(timestamp) {
                longestFrameGap = Math.max(longestFrameGap, timestamp - priorFrame);
                priorFrame = timestamp;
                if (feedback === null && parent.querySelector('[role="status"]')?.textContent.includes('Rendering')) {
                  feedback = timestamp - start;
                }
                raf = requestAnimationFrame(frame);
              }
              raf = requestAnimationFrame(frame);
              const timeout = setTimeout(() => finish(null), 15000);
              function finish(painted) {
                clearTimeout(timeout);
                cancelAnimationFrame(raf);
                tasks.disconnect();
                observer.disconnect();
                resolve({ option, painted, feedback, longestFrameGap,
                  longestTask: Math.max(0, ...taskEntries.filter(item => item.startTime >= start).map(item => item.duration)) });
              }
              const observer = new MutationObserver(() => {
                const apply = [...parent.querySelectorAll('button')].find(item => item.textContent === 'Apply ' + option);
                if (!apply || apply.disabled || !parent.querySelector(`img[alt="Proposed ${option} layout"]`)) return;
                observer.disconnect();
                requestAnimationFrame(() => requestAnimationFrame(timestamp => finish(timestamp - start)));
              });
              observer.observe(parent, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
            }, { capture: true, once: true });
          });
        }, option);
        if (mobile) await preview.tap(); else await preview.click();
        const measured = await page.evaluate(() => window.currentLayoutMeasurement);
        if (measured.painted === null) throw new Error(`Preview failed for ${project.title} · ${option}`);
        samples.push(measured);
      }
      if (index > 0) batches.push(samples);
      process.stderr.write(`${mobile ? 'mobile' : 'desktop'} fixture ${index + 1}/${documents.length}\n`);
      await dialog.getByRole('button', { name: 'Close dialog' }).click();
      await live.getByRole('button', { name: 'Back to v3 projects' }).click();
    }
    return { mobile, throttle: mobile ? 4 : 1, viewport: page.viewportSize(), batches };
  } finally { await page.close(); }
}
try {
  const results = [];
  for (const mobile of [false, true]) results.push(await measure(mobile));
  process.stdout.write(JSON.stringify({ evidenceCommit: build.commit,
    browser: browser.version(), os: os.release(), cpu: os.cpus()[0].model,
    cpuCgroup: readLimit('/sys/fs/cgroup/cpu.max'), memoryCgroup: readLimit('/sys/fs/cgroup/memory.max'),
    fixture: { nodes: 50, edges: 75, warmedModuleFixtures: 1, measuredFixturesPerProfile: 10 },
    method: 'Real click or tap to two animation frames after a visible decoded candidate becomes eligible to apply. Long Tasks API and requestAnimationFrame gaps observed independently. Candidate inputs differ per fixture. Three sequential options per fixture.',
    results,
  }, null, 2) + '\n');
} finally { await browser.close(); }
