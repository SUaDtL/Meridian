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
const measureMemory = process.argv.includes('--memory');
const measureInput = process.argv.includes('--input');
const measureReadability = process.argv.includes('--readability');
if ([measureInput, measureMemory, measureReadability].filter(Boolean).length > 1) {
  throw new Error('Run input, memory and readability measurement separately.');
}
const sizeOption = process.argv.find(value => value.startsWith('--nodes='));
const nodeCount = sizeOption ? Number(sizeOption.slice('--nodes='.length)) : 50;
if ((sizeOption && !measureInput) || ![10, 50, 150, 200].includes(nodeCount)) {
  throw new Error('Input measurement supports --nodes=10, 50, 150 or 200.');
}
const edgeCount = Math.floor(nodeCount * 1.5);
const fixtureOption = process.argv.find(value => value.startsWith('--fixtures='));
const measuredFixtures = fixtureOption ? Number(fixtureOption.slice('--fixtures='.length)) : 10;
if (!Number.isInteger(measuredFixtures) || measuredFixtures < 1 || measuredFixtures > 49) {
  throw new Error('Choose between 1 and 49 measured fixtures, plus one warm-up.');
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
function prepareFixture(index) {
  const label = String(index + 1).padStart(2, '0');
  const nodes = Array.from({ length: nodeCount }, (_, number) => `  N${number}["Service ${label}${number}"]`);
  const laneEdges = Array.from({ length: nodeCount - 5 }, (_, number) => `  N${number} lane${number}@--> N${number + 5}`);
  const crossEdges = Array.from({ length: edgeCount - laneEdges.length }, (_, number) => {
    const destination = (number + (number % 5 === 4 ? 1 : 6)) % nodeCount;
    return `  N${number} cross${number}@--> N${destination}`;
  });
  return {
    schema: 'meridian/v2', id: `layout-${index}`, title: `G04 layout ${label}`, subtitle: '',
    source: ['flowchart LR', ...nodes, ...laneEdges, ...crossEdges, ''].join('\n'),
    updatedAt: '2026-11-21T00:00:00Z', nodeAccents: {}, settings: standardSettings,
  };
}
const documents = Array.from({ length: measuredFixtures + 1 }, (_, index) => prepareFixture(index));

async function processMemory(browserSession) {
  if (process.platform !== 'linux') return undefined;
  const { processInfo } = await browserSession.send('SystemInfo.getProcessInfo');
  const byType = Object.create(null);
  let inaccessible = 0;
  for (const { id, type } of processInfo) {
    const rollup = readLimit(`/proc/${id}/smaps_rollup`);
    const proportionalKiB = rollup?.match(/^Pss:\s+(\d+) kB$/m)?.[1];
    if (!proportionalKiB) { inaccessible++; continue; }
    const memory = byType[type] ??= { processes: 0, proportionalBytes: 0 };
    memory.processes++;
    memory.proportionalBytes += Number(proportionalKiB) * 1024;
  }
  return { byType, inaccessible };
}

async function browserMemory(session, browserSession) {
  await session.send('HeapProfiler.collectGarbage');
  const [{ documents, nodes, jsEventListeners }, { metrics }] = await Promise.all([
    session.send('Memory.getDOMCounters'),
    session.send('Performance.getMetrics'),
  ]);
  const heap = metrics.find(metric => metric.name === 'JSHeapUsedSize');
  if (!heap || !Number.isSafeInteger(heap.value) || heap.value <= 0) {
    throw new Error('Chromium did not report JS heap bytes.');
  }
  const native = await processMemory(browserSession);
  return { documents, nodes, jsEventListeners, jsHeapBytes: heap.value, native };
}

async function inputToPaint(page, target, eventType, expectedText, trigger) {
  await target.evaluate((element, { eventType, expectedText }) => {
    window.layoutInputMeasurement = new Promise(resolve => {
      const timedOut = setTimeout(() => {
        element.removeEventListener(eventType, start, true);
        cancelAnimationFrame(frame);
        resolve(null);
      }, 5000);
      let frame;
      function start(event) {
        if (!event.isTrusted || (eventType === 'keydown' && event.key !== ' ')) return;
        element.removeEventListener(eventType, start, true);
        const startTime = event.timeStamp;
        function check() {
          const painted = expectedText === null ? element.getAttribute('aria-selected') === 'true'
            : element.querySelector('.cm-line')?.textContent === expectedText;
          if (!painted) {
            frame = requestAnimationFrame(check);
            return;
          }
          frame = requestAnimationFrame(timestamp => {
            clearTimeout(timedOut);
            resolve(timestamp - startTime);
          });
        }
        frame = requestAnimationFrame(check);
      }
      element.addEventListener(eventType, start, true);
    });
  }, { eventType, expectedText });
  await trigger();
  const milliseconds = await page.evaluate(() => window.layoutInputMeasurement);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error(`Missing trusted ${eventType} feedback.`);
  return milliseconds;
}

async function workspaceInput(page, live, mobile) {
  const navigation = live.getByRole('navigation', { name: 'Workspace panels' });
  if (mobile && await navigation.isVisible()) await navigation.getByRole('button', { name: 'Build', exact: true }).tap();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const selection = [];
  for (let index = 0; index < 3; index++) {
    const target = outline.getByRole('treeitem').nth(index);
    await target.scrollIntoViewIfNeeded();
    if (await target.getAttribute('aria-selected') !== 'false') throw new Error('Choose an unselected fixture node.');
    selection.push(await inputToPaint(page, target, 'pointerdown', null, () => mobile ? target.tap() : target.click()));
  }
  await outline.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const source = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const editor = source.locator('.cm-content');
  await editor.press('Control+Home');
  await editor.press('End');
  const typing = [];
  for (let index = 0; index < 3; index++) {
    typing.push(await inputToPaint(page, editor, 'keydown', 'flowchart LR ', () => editor.press('Space')));
    await editor.press('Backspace');
    const header = await editor.locator('.cm-line').first().textContent();
    if (header !== 'flowchart LR') throw new Error('The draft input fixture did not restore its header.');
  }
  await source.getByRole('button', { name: 'Close dialog' }).click();
  await source.waitFor({ state: 'hidden' });
  return { selection, typing };
}

async function readabilityInput(page, live, mobile) {
  if (mobile) {
    await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Design', exact: true }).tap();
  }
  await live.getByRole('button', { name: 'Check readability' }).click();
  const dialog = page.getByRole('dialog', { name: 'Check readability' });
  const check = dialog.getByRole('button', { name: 'Check diagram' });
  const samples = [];
  for (let index = 0; index < 3; index++) {
    await check.evaluate(button => {
      window.readabilityMeasurement = new Promise((resolve, reject) => {
        button.addEventListener('click', event => {
          if (!event.isTrusted) return reject(new Error('Expected a trusted readability action.'));
          window.readabilityWorkerElapsed = null;
          const start = event.timeStamp;
          let renderHostAppeared = false;
          const observer = new MutationObserver(records => {
            renderHostAppeared ||= records.some(record => [...record.addedNodes].some(node => node instanceof Element &&
              (node.matches('[data-meridian-render]') || node.querySelector('[data-meridian-render]'))));
          });
          observer.observe(document.body, { subtree: true, childList: true });
          let frame;
          const timeout = setTimeout(() => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            reject(new Error('The readability report did not settle.'));
          }, 5_000);
          const settled = '[aria-label="Readability results"][aria-busy="false"]';
          function checkReport() {
            if (!Number.isFinite(window.readabilityWorkerElapsed) || !button.closest('dialog')?.querySelector(settled)) {
              frame = requestAnimationFrame(checkReport);
              return;
            }
            frame = requestAnimationFrame(time => {
              clearTimeout(timeout);
              observer.disconnect();
              resolve({ milliseconds: time - start, workerRoundTrip: window.readabilityWorkerElapsed, renderHostAppeared });
            });
          }
          frame = requestAnimationFrame(checkReport);
        }, { once: true, capture: true });
      });
    });
    await (mobile ? check.tap() : check.click());
    const sample = await page.evaluate(() => window.readabilityMeasurement);
    if (sample.renderHostAppeared) throw new Error('Readability should reuse the settled rendering.');
    samples.push(sample);
  }
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  return samples;
}

async function measure(mobile) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
  try {
    const session = await page.context().newCDPSession(page);
    if (mobile) await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const browserSession = measureMemory ? await browser.newBrowserCDPSession() : undefined;
    if (measureMemory) await session.send('Performance.enable');
    await page.addInitScript(({ documents, measureMemory, measureReadability }) => {
      localStorage.setItem('meridian:v2', JSON.stringify({ version: 2, activeId: documents[0].id, documents }));
      if (measureReadability) {
        const BuiltinWorker = window.Worker;
        window.Worker = class extends BuiltinWorker {
          postMessage(message, ...args) {
            if (Array.isArray(message?.targets) && message?.profile && message?.frame) {
              const started = performance.now();
              this.addEventListener('message', event => {
                if (event.data?.id === message.id && event.data?.status === 'ready') {
                  window.readabilityWorkerElapsed = performance.now() - started;
                }
              }, { once: true });
            }
            return super.postMessage(message, ...args);
          }
        };
      }
      if (!measureMemory) return;
      const peak = { hosts: 0, elements: 0 };
      window.layoutMeasurementHosts = peak;
      const observer = new MutationObserver(records => {
        const hosts = [...document.querySelectorAll('[data-meridian-render]')];
        peak.hosts = Math.max(peak.hosts, hosts.length);
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.matches('[data-meridian-render]') && !hosts.includes(node)) hosts.push(node);
          }
        }
        for (const host of hosts) peak.elements = Math.max(peak.elements, host.querySelectorAll('*').length);
      });
      observer.observe(document, { childList: true, subtree: true });
    }, { documents, measureMemory, measureReadability });
    await page.goto(base.href);
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
    // An extended run migrates all fixtures before the first project is available.
    const firstProject = page.getByRole('button', { name: `Open v3 project ${documents[0].title}` });
    await firstProject.waitFor({ timeout: 180_000 });
    const batches = [];
    const memory = measureMemory ? { baseline: await browserMemory(session, browserSession), fixtures: [] } : undefined;
    for (const [index, project] of documents.entries()) {
      await page.getByRole('button', { name: `Open v3 project ${project.title}` }).click({ timeout: 30000 });
      const live = page.getByRole('dialog', { name: project.title });
      await live.getByRole('img', { name: `Diagram preview for ${project.title}` }).waitFor();
      if (measureInput || measureReadability) {
        const sample = await (measureInput ? workspaceInput : readabilityInput)(page, live, mobile);
        if (index > 0) batches.push(sample);
        await live.getByRole('button', { name: 'Back to v3 projects' }).click();
        process.stderr.write(`${mobile ? 'mobile' : 'desktop'} ${measureInput ? 'input' : 'readability'} fixture ${index + 1}/${documents.length}\n`);
        continue;
      }
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
      const active = memory ? await browserMemory(session, browserSession) : undefined;
      await dialog.getByRole('button', { name: 'Close dialog' }).click();
      await live.getByRole('button', { name: 'Back to v3 projects' }).click();
      if (memory) {
        await live.waitFor({ state: 'hidden' });
        const closed = await browserMemory(session, browserSession);
        memory.fixtures.push({ title: project.title, active, closed });
      }
    }
    const hosts = memory ? await page.evaluate(() => window.layoutMeasurementHosts) : undefined;
    return { mobile, throttle: mobile ? 4 : 1, viewport: page.viewportSize(), batches, memory: memory && { ...memory, hosts } };
  } finally { await page.close(); }
}
try {
  const results = [];
  for (const mobile of [false, true]) results.push(await measure(mobile));
  process.stdout.write(JSON.stringify({ evidenceCommit: build.commit,
    browser: browser.version(), os: os.release(), cpu: os.cpus()[0].model,
    cpuCgroup: readLimit('/sys/fs/cgroup/cpu.max'), memoryCgroup: readLimit('/sys/fs/cgroup/memory.max'),
    fixture: { nodes: nodeCount, edges: edgeCount, warmedModuleFixtures: 1, measuredFixturesPerProfile: measuredFixtures },
    method: measureInput
      ? 'Trusted outline pointerdown or CodeMirror keydown to the animation frame following matching visible state. Three samples per action per fixture, immediately after foreground rendering has settled. Mobile typing uses Chromium keyboard input.'
      : measureReadability
      ? 'Trusted readability click or tap through the frame after the settled report. Worker round trip measured separately from its send and ready message. A DOM observer rejects a new renderer host. Three checks per drawn fixture.'
      : measureMemory
      ? 'Observed temporary rendering hosts with a DOM observer. Read Chromium DOM and live JavaScript heap counters after forced garbage collection before opening the first project, during the settled comparison, and after closing each project. Linux process proportional set size allocates shared pages proportionally and includes JavaScript heap and other memory. It is reported by Chromium process type. Timings include observer instrumentation.'
      : 'Real click or tap to two animation frames after a visible decoded candidate becomes eligible to apply. Long Tasks API and requestAnimationFrame gaps observed independently. Candidate inputs differ per fixture. Three sequential options per fixture.',
    results,
  }, null, 2) + '\n');
} finally { await browser.close(); }
