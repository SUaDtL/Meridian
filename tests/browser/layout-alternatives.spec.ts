import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function downloadProject(page: Page, live: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('compares measured layouts, exports accepted geometry and undoes an exact direction patch', async ({ page, browser }) => {
  const source = '\uFEFFflowchart LR\r\n  %% keep the LR explanation\r\n  A["Client LR"]\r\n  B["Service"]\r\n  A main@-->|"Call"| B\r\n';
  const project = { ...createDocument(), title: 'Layout comparison', source };
  project.design.elements['node:A'] = { fill: '#abcdef' };
  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }));
    let held = false;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, options) {
      if (!held && Array.isArray(message?.current) && Array.isArray(message?.proposed)) {
        held = true;
        document.documentElement.dataset.layoutTestWorkerHeld = 'true';
        return;
      }
      return post.call(this, message, options ?? []);
    };
  }, { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Layout comparison' }).click();
  const live = page.getByRole('dialog', { name: 'Layout comparison' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Layout comparison' })).toBeVisible();
  const original = await downloadProject(page, live);

  await live.getByRole('button', { name: 'Compare layouts', exact: true }).click();
  const layouts = page.getByRole('dialog', { name: 'Compare layouts' });
  const choices = layouts.getByRole('group', { name: 'Layout alternatives' });
  await expect(choices.getByRole('button')).toHaveCount(3);
  await choices.getByRole('button', { name: /Compact/ }).click();
  await layouts.getByRole('combobox', { name: 'Source direction' }).selectOption('TB');
  const apply = layouts.getByRole('button', { name: 'Apply Compact', exact: true });
  const preview = layouts.getByRole('button', { name: 'Preview Compact', exact: true });
  await expect(apply).toBeDisabled();
  await preview.click();
  await expect(page.locator('html')).toHaveAttribute('data-layout-test-worker-held', 'true');
  await layouts.getByRole('button', { name: 'Cancel preview' }).click();
  await expect(layouts.getByRole('status')).toContainText('Preview cancelled.');
  await expect(apply).toBeDisabled();
  await expect(preview).toBeFocused();
  await expect(layouts.getByRole('combobox', { name: 'Source direction' })).toHaveValue('TB');
  await preview.click();
  await expect(layouts.getByRole('img', { name: 'Proposed Compact layout' })).toBeVisible();
  await expect(layouts.getByRole('list', { name: 'Layout changes' })).toContainText('Source direction · LR → TB');
  const measured = layouts.getByRole('region', { name: 'Viewed label sizes' });
  await expect(measured).toContainText('Viewed labels at 1280 × 720 CSS pixels');
  await expect(measured.getByText(/Current · .* measured/)).toBeVisible();
  await expect(measured.getByText(/Proposed · .* measured/)).toBeVisible();
  const crossings = layouts.getByRole('region', { name: 'Connection crossings' });
  await expect(crossings.getByText(/Current · 0 crossing candidates in checked routes · 1 measured · 0 unknown/)).toBeVisible();
  await expect(crossings.getByText(/Proposed · 0 crossing candidates in checked routes · 1 measured · 0 unknown/)).toBeVisible();
  await expect(crossings).toContainText('The checked routes have the same crossing candidate count.');
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await downloadProject(page, live);
  expect(applied.source).toBe(source.replace('flowchart LR', 'flowchart TB'));
  expect(applied.settings).toMatchObject({ layout: 'dagre', spacing: 'compact', curve: 'linear' });
  expect(applied.identity).toEqual(original.identity);
  expect(applied.design).toEqual(original.design);

  const image = live.getByRole('img', { name: 'Diagram preview for Layout comparison' });
  await expect(image).toBeVisible();
  const client = applied.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'A').id;
  await live.getByRole('button', { name: 'Export diagram', exact: true }).click();
  const exports = page.getByRole('dialog', { name: 'Take your diagram with you.' });
  await exports.getByRole('button', { name: /^SVG/ }).click();
  const [vector] = await Promise.all([page.waitForEvent('download'), exports.getByRole('button', { name: 'Download SVG', exact: true }).click()]);
  const vectorFile = await vector.path();
  if (!vectorFile) throw new Error('Missing accepted layout SVG.');
  const svg = await readFile(vectorFile, 'utf8');
  const liveTransform = await page.evaluate(({ svg, client }) => new DOMParser().parseFromString(svg, 'image/svg+xml')
    .querySelector(`[data-element-key="${client}"]`)?.getAttribute('transform'), { svg, client });
  expect(liveTransform).toBeTruthy();
  await exports.getByRole('button', { name: 'Close dialog' }).click();
  const [presentation] = await Promise.all([
    page.waitForEvent('download'), live.getByRole('button', { name: 'Download HTML presentation' }).click(),
  ]);
  const html = await presentation.path();
  if (!html) throw new Error('Missing accepted layout presentation.');
  const offline = await browser.newContext({ offline: true });
  try {
    const portable = await offline.newPage();
    await portable.setContent(await readFile(html, 'utf8'));
    await expect(portable.locator(`[data-element-key="${client}"]`)).toHaveAttribute('transform', liveTransform!);
    await expect(portable.getByText('Client LR', { exact: true })).toBeVisible();
  } finally { await offline.close(); }

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored.source).toBe(source);
  expect(restored.settings).toEqual(original.settings);
});

test('shows the tradeoff when a real layout removes crossings and shrinks the smallest viewed label', async ({ page }) => {
  const source = `flowchart LR
 A[A much longer diagnostic dependency]
 B[B]
 C[C]
 D[D]
 E[E]
 F[F]
 G[G]
 A e0@--> E
 B e1@--> C
 B e2@--> E
 B e3@--> F
 B e4@--> G
 C e5@--> D
 C e6@--> G
 D e7@--> F
 D e8@--> G
`;
  const project = { ...createDocument(), title: 'Layout readability tradeoff', source };
  Object.assign(project.settings, { layout: 'dagre', spacing: 'compact', curve: 'linear' });
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Layout readability tradeoff' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  await expect(live.getByRole('img', { name: 'Diagram preview for Layout readability tradeoff' })).toBeVisible();
  const before = await downloadProject(page, live);
  await live.getByRole('button', { name: 'Compare layouts', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Compare layouts' });
  await review.getByRole('button', { name: 'Preview Balanced', exact: true }).click();
  const routes = review.getByRole('region', { name: 'Connection crossings' });
  await expect(routes).toContainText('Current · 2 crossing candidates in checked routes · 9 measured · 0 unknown');
  await expect(routes).toContainText('Proposed · 0 crossing candidates in checked routes · 9 measured · 0 unknown');
  const labels = review.getByRole('region', { name: 'Viewed label sizes' });
  const current = await labels.getByText(/^Current · [\d.]+ CSS pixels for the smallest measured label · 7 measured · 0 unknown$/).textContent();
  const proposed = await labels.getByText(/^Proposed · [\d.]+ CSS pixels for the smallest measured label · 7 measured · 0 unknown$/).textContent();
  const currentSize = current?.match(/([\d.]+) CSS pixels/)?.[1];
  const proposedSize = proposed?.match(/([\d.]+) CSS pixels/)?.[1];
  expect(Number(proposedSize)).toBeLessThan(Number(currentSize));
  await expect(routes).toContainText(`The proposed layout has fewer crossing candidates. Its smallest viewed label drops from ${currentSize} to ${proposedSize} CSS pixels.`);
  await expect(routes.getByText(/best layout|no issues/i)).toHaveCount(0);
  await review.getByRole('button', { name: 'Close dialog' }).click();
  expect(await downloadProject(page, live)).toEqual(before);
});

for (const inputs of [
  { title: 'Grouped layout', source: 'flowchart LR\n subgraph Service [Service boundary]\n  A[Client]\n  B[Worker]\n end\n A job@--> B\n', grouped: true },
  { title: 'Sequence layout', source: 'sequenceDiagram\n Alice->>Bob: Hello\n', grouped: false },
]) {
  test(`${inputs.title} exposes only verified layout controls and preserves its source`, async ({ page }) => {
    const project = { ...createDocument(), title: inputs.title, source: inputs.source };
    await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
      version: 2, activeId: project.id, documents: [project],
    })), { key: STORAGE_KEY, project });
    await page.goto('/');
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await page.getByRole('button', { name: `Open v3 project ${inputs.title}` }).click();
    const live = page.getByRole('dialog', { name: inputs.title, exact: true });
    await expect(live.getByRole('img', { name: `Diagram preview for ${inputs.title}` })).toBeVisible();
    const before = await downloadProject(page, live);
    if (inputs.grouped) {
      await live.getByRole('button', { name: 'Compare layouts' }).click();
      const layouts = page.getByRole('dialog', { name: 'Compare layouts' });
      const direction = layouts.getByRole('combobox', { name: 'Source direction' });
      await expect(direction).toBeDisabled();
      await expect(direction).toHaveValue('keep');
      await expect(layouts.getByText('Direction changes are available for flat flowcharts with explicit node declarations.')).toBeVisible();
      await layouts.getByRole('group', { name: 'Layout alternatives' }).getByRole('button', { name: /^Compact/ }).click();
      await layouts.getByRole('button', { name: 'Preview Compact' }).click();
      await expect(layouts.getByRole('img', { name: 'Proposed Compact layout' })).toBeVisible();
      await expect(layouts.getByRole('list', { name: 'Layout changes' })).not.toContainText('Source direction');
      await layouts.getByRole('button', { name: 'Apply Compact' }).click();
      await expect(live.getByText('Saved in this browser.')).toBeVisible();
      const applied = await downloadProject(page, live);
      expect(applied.source).toBe(inputs.source);
      expect(applied.identity).toEqual(before.identity);
      expect(applied.settings).toMatchObject({ layout: 'dagre', spacing: 'compact', curve: 'linear' });
    } else {
      await expect(live.getByRole('button', { name: 'Compare layouts' })).toHaveCount(0);
      await live.getByRole('button', { name: 'Commands' }).click();
      const commands = page.getByRole('dialog', { name: 'Commands' });
      await commands.getByRole('combobox').fill('Compare layouts');
      const unavailable = commands.getByRole('option', { name: /Compare layouts/ });
      await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
      await expect(unavailable).toContainText('A verified flowchart is needed to compare layouts.');
      await commands.getByRole('button', { name: 'Close dialog' }).click();
      expect(await downloadProject(page, live)).toEqual(before);
    }
  });
}
