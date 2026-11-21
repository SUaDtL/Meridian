import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function openProject(page: Page, title: string, source: string) {
  const project = { ...createDocument(), title, source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: `Open v3 project ${title}` }).click();
  return page.getByRole('dialog', { name: title });
}

test('frames measured outline targets with the keyboard and preserves hidden selections and project bytes', async ({ page }, info) => {
  await page.addInitScript(() => {
    const frames = new Map<string, Blob>();
    Object.defineProperty(window, 'outlineFixtureFrames', { value: frames });
    const create = URL.createObjectURL;
    URL.createObjectURL = value => {
      const url = create(value);
      if (value instanceof Blob && value.type === 'image/svg+xml') frames.set(url, value);
      return url;
    };
  });
  const source = 'flowchart LR\n A[First step]\n B[Second step]\n C[Third step]\n D[Last step]\n A --> B\n B --> C\n C --> D\n';
  const live = await openProject(page, 'Outline framing', source);
  const image = live.getByRole('img', { name: 'Diagram preview for Outline framing' });
  const readFrame = () => image.evaluate(async (image: HTMLImageElement) => {
    const frames = (window as Window & { outlineFixtureFrames: ReadonlyMap<string, Blob> }).outlineFixtureFrames;
    const source = await frames.get(image.src)?.text();
    if (!source) throw new Error('Missing diagram frame.');
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
    const diagram = svg.querySelector('svg[data-meridian-export] > svg');
    return { viewBox: diagram?.getAttribute('viewBox')?.split(/\s+/u).map(Number) ?? [],
      markers: diagram?.querySelectorAll('rect[stroke="#fde047"]').length };
  });
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project backup.');
    return readFile(path, 'utf8');
  };
  await expect(image).toBeVisible();
  const full = await readFrame();
  const original = await download();
  const openOutline = live.getByRole('button', { name: 'Outline', exact: true });
  await openOutline.click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const query = outline.getByRole('textbox', { name: 'Find an element' });
  const tree = outline.getByRole('tree', { name: 'Diagram elements' });
  await query.fill('Last step');
  await query.press('ArrowDown');
  await tree.press('Enter');
  await expect(tree).toBeFocused();
  await expect(outline.getByRole('status')).toHaveText('1 selected · 0 hidden');
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await expect(live.getByText('Framed around 1 element.')).toBeVisible();
  const focus = await readFrame();
  expect(focus.markers).toBe(1);
  expect(focus.viewBox[0]).toBeGreaterThan(full.viewBox[0]);
  expect(focus.viewBox[2]).toBeLessThan(full.viewBox[2]);
  await page.screenshot({ path: info.outputPath('outline-frame-desktop.png') });
  const fit = live.getByRole('button', { name: 'Fit full diagram' });
  await fit.press('Enter');
  await expect(openOutline).toBeFocused();
  expect(await readFrame()).toEqual(full);

  await page.setViewportSize({ width: 390, height: 844 });
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await openOutline.click();
  await query.fill('First step');
  await outline.getByRole('button', { name: 'Select multiple' }).click();
  await outline.getByRole('checkbox', { name: /First step/ }).check();
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await outline.getByRole('button', { name: 'Frame selected elements' }).click();
  await expect(live.getByText('Framed around 2 elements.')).toBeVisible();
  await expect(fit).toBeFocused();
  expect((await readFrame()).markers).toBe(2);
  await page.screenshot({ path: info.outputPath('outline-frame-mobile.png') });
  expect(await download()).toBe(original);
  await expect(live.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('discovers parallel relationships and jumps only to the exact selected source span', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  A["Intake"]\r\n  B["Result"]\r\n  A delivery@-->|"Sends"| B\r\n  A audit@-->|"Sends"| B\r\n';
  const live = await openProject(page, 'Outline example', source);
  await live.getByRole('button', { name: 'Commands', exact: true }).click();
  const commands = page.getByRole('dialog', { name: 'Commands' });
  const search = commands.getByRole('combobox');
  await search.fill('outline');
  await expect(commands.getByRole('option', { name: /Find element/ })).toBeEnabled();
  await search.press('Enter');

  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const query = outline.getByRole('textbox', { name: 'Find an element' });
  await expect(query).toBeFocused();
  const tree = outline.getByRole('tree', { name: 'Diagram elements' });
  await query.press('ArrowDown');
  await tree.press('Enter');
  await tree.press('ArrowDown');
  await tree.press('Shift+Space');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 0 hidden');
  await query.fill('Intake');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await query.fill('');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 0 hidden');

  await outline.getByRole('button', { name: 'Relationships', exact: true }).click();
  const relationships = outline.getByRole('listbox', { name: 'Relationships' });
  await expect(relationships.getByRole('option')).toHaveCount(2);
  await expect(relationships.getByRole('option', { name: /delivery · Line 4/ })).toBeVisible();
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('audit');
  await relationships.getByRole('option', { name: /audit · Line 5/ }).click();
  await outline.getByRole('button', { name: 'Jump to source' }).click();
  await expect(outline).toHaveCount(0);
  const marked = live.locator('mark');
  await expect(marked).toHaveText('A audit@-->|"Sends"| B');
  await expect(marked).toBeFocused();
  expect(await live.locator('pre').textContent()).toBe(source);

  await page.setViewportSize({ width: 390, height: 844 });
  await live.getByRole('button', { name: 'Return to outline' }).click();
  await expect(outline.getByRole('textbox', { name: 'Find an element' })).toHaveValue('audit');
  await expect(relationships.getByRole('option')).toHaveCount(1);
  await expect(relationships).toBeFocused();
  await expect(relationships.getByRole('option', { name: /audit · Line 5/ })).toHaveAttribute('aria-selected', 'true');
  await expect(outline.getByRole('status')).toHaveText('1 selected · 0 hidden');
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(outline.getByRole('status')).toHaveText('1 selected · 1 hidden');
  await outline.getByRole('treeitem', { name: /Result/ }).click();
  await tree.press('F2');
  const editor = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(editor.getByRole('combobox', { name: 'Node to rename' }).locator('option:checked')).toHaveText('Result (B)');
  await expect(editor.getByRole('button', { name: 'Apply change' })).toBeDisabled();
});

test('keeps selection under a collapsed group and opens exact group and member source spans', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  subgraph cluster [Team boundary]\r\n    A[First system]\r\n  end\r\n  B[Second system]\r\n  A --> B\r\n';
  const live = await openProject(page, 'Grouped outline', source);
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const tree = outline.getByRole('tree');
  const group = tree.getByRole('treeitem', { name: /Team boundary/ });
  const child = tree.getByRole('treeitem', { name: /First system/ });
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await expect(child).toHaveAttribute('aria-level', '2');
  await child.click();
  await expect(outline.getByRole('status')).toHaveText('1 selected · 0 hidden');
  const jump = outline.getByRole('button', { name: 'Jump to source' });
  await expect(jump).toBeEnabled();
  await tree.press('ArrowLeft');
  await tree.press('ArrowLeft');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(child).toHaveCount(0);
  await expect(outline.getByRole('status')).toHaveText('1 selected · 1 hidden');
  await tree.press('ArrowRight');
  await expect(child).toHaveAttribute('aria-selected', 'true');
  await expect(outline.getByRole('status')).toHaveText('1 selected · 0 hidden');
  await child.click();
  await jump.click();
  await expect(live.locator('mark')).toHaveText('First system');
  await expect(live.locator('mark')).toBeFocused();

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await group.click();
  await jump.click();
  await expect(live.locator('mark')).toHaveText('subgraph cluster [Team boundary]');
  expect(await live.locator('pre').textContent()).toBe(source);

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await outline.getByRole('button', { name: 'Relationships', exact: true }).click();
  await outline.getByRole('listbox', { name: 'Relationships' }).getByRole('option').click();
  await expect(jump).toBeDisabled();
});

test('uses touch checkboxes across filters and refuses selection beyond the interactive limit', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const nodes = Array.from({ length: 200 }, (_, index) => `N${index}[Regular ${String(index).padStart(3, '0')}]`);
    const source = ['flowchart LR', ...nodes, 'Final[Last system]', ''].join('\n');
    const live = await openProject(page, 'Touch outline', source);
    await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).tap();
    await live.getByRole('button', { name: 'Outline', exact: true }).tap();
    const outline = page.getByRole('dialog', { name: 'Diagram outline' });
    const multi = outline.getByRole('button', { name: 'Select multiple', exact: true });
    await multi.tap();
    await expect(multi).toHaveAttribute('aria-pressed', 'true');
    const first = outline.getByRole('checkbox', { name: /^Regular 000/ });
    const firstRow = outline.locator('label').filter({ has: page.getByRole('checkbox', { name: /^Regular 000/ }) });
    expect((await firstRow.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await firstRow.tap();
    await outline.getByRole('checkbox', { name: /^Regular 001/ }).tap();
    await expect(first).toBeChecked();
    const search = outline.getByRole('textbox', { name: 'Find an element' });
    await search.fill('Regular 000');
    await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
    await outline.getByRole('button', { name: 'Select all diagram elements' }).tap();
    await expect(outline.getByRole('alert')).toHaveText('That action would select 201 elements. The limit is 200. 2 are selected.');
    await expect(first).toBeChecked();
    await search.fill('Regular');
    const showMore = outline.getByRole('button', { name: 'Show more' });
    await showMore.tap();
    await showMore.tap();
    await outline.getByRole('button', { name: 'Select visible results' }).tap();
    await expect(outline.getByRole('status')).toHaveText('200 selected · 0 hidden');
    await search.fill('Last system');
    const last = outline.getByRole('checkbox', { name: /^Last system/ });
    await last.tap();
    await expect(last).not.toBeChecked();
    await expect(outline.getByRole('alert')).toHaveText('That action would select 201 elements. The limit is 200. 200 are selected.');
    await expect(outline.getByRole('status')).toHaveText('200 selected · 200 hidden');
    await search.fill('Regular 000');
    await search.press('ArrowDown');
    await expect(first).toBeFocused();
    await first.press('Space');
    await expect(first).not.toBeChecked();
    await expect(outline.getByRole('status')).toHaveText('199 selected · 199 hidden');
  } finally { await context.close(); }
});

test('renames nested node and explicit connection labels without rewriting grouped source or identities', async ({ page }) => {
  const source = [
    '\uFEFFflowchart LR',
    '  subgraph Fleet [Fleet]',
    '    subgraph Rack [Rack]',
    '      A["Intake"]',
    '    end',
    '  end',
    '  %% external connections retain their style indices',
    '  B[Result]',
    '  A delivery@-->|"Sends"| B',
    '  A --> B',
    '  linkStyle 0 stroke:#005500',
    '',
  ].join('\r\n');
  const live = await openProject(page, 'Grouped labels', source);
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project backup.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const original = await download();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /Intake/ }).click();
  await outline.getByRole('tree').press('F2');
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const operation = edit.getByRole('combobox', { name: 'Operation' });
  const label = edit.getByRole('textbox', { name: 'Node label' });
  await expect(label).toHaveValue('Intake');
  await expect(operation.locator('option')).toHaveCount(2);
  await label.fill('Reviewed intake');
  const preview = () => edit.getByRole('button', { name: 'Preview change' }).click();
  const apply = async () => {
    await edit.getByRole('button', { name: 'Apply change' }).click();
    await expect(edit).toHaveCount(0);
  };
  await preview();
  await apply();
  const renamed = await download();
  expect(renamed.source).toBe(source.replace('"Intake"', '"Reviewed intake"'));
  expect(renamed.identity).toEqual(original.identity);

  await live.getByRole('button', { name: 'Commands', exact: true }).click();
  const query = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
  await query.fill('Edit connection label');
  await query.press('Enter');
  const edge = edit.getByRole('combobox', { name: 'Connection to edit' });
  await expect(edge.locator('option')).toHaveCount(2);
  await edge.selectOption({ label: 'Reviewed intake → Result · Sends (delivery)' });
  const edgeLabel = edit.getByRole('textbox', { name: 'Connection label (optional)' });
  await expect(edgeLabel).toHaveValue('Sends');
  await edgeLabel.fill('Routes');
  await preview();
  await apply();
  const relabeled = await download();
  expect(relabeled.source).toBe(renamed.source.replace('"Sends"', '"Routes"'));
  expect(relabeled.identity).toEqual(original.identity);
  const undo = live.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await download()).source).toBe(renamed.source);
  await undo.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await download()).source).toBe(source);
});

test('removes one nested container while keeping the parent, member identities, connections and exact Undo', async ({ page }, info) => {
  const source = [
    '\uFEFFflowchart LR', '  subgraph Fleet [Fleet]', '    subgraph Rack [Rack]',
    '      %% Keep the published description', '      A[Service]', '    end', '    B[Neighbor]', '  end',
    '  C[External]', '  A existing@--> C', '  linkStyle 0 stroke:#446677', '',
  ].join('\r\n');
  const live = await openProject(page, 'Nested ungroup', source);
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project backup.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const original = await download();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const openOutline = live.getByRole('button', { name: 'Outline', exact: true });
  const member = outline.getByRole('treeitem', { name: /Service/ });
  await openOutline.click();
  await expect(member).toHaveAttribute('aria-level', '3');
  await outline.getByRole('treeitem', { name: /Rack/ }).click();
  await outline.getByRole('button', { name: 'Ungroup', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(edit.getByText('Ungroup Rack. Its members and connections will stay in the diagram.')).toBeVisible();
  await expect(edit.getByRole('option', { name: 'Delete group and contents' })).toHaveCount(0);
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const apply = edit.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeEnabled();
  await page.screenshot({ path: info.outputPath('nested-ungroup-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('nested-ungroup-mobile.png') });
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await download();
  expect(applied.source).toBe(source.replace('    subgraph Rack [Rack]\r\n', '').replace('    end\r\n', ''));
  expect(applied.identity.elements.filter((item: { status: string }) => item.status === 'resolved'))
    .toEqual(original.identity.elements.filter((item: { binding: { sourceId: string } }) => item.binding.sourceId !== 'Rack'));
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await openOutline.click();
  await expect(member).toHaveAttribute('aria-level', '2');
  await expect(outline.getByRole('treeitem', { name: /Rack/ })).toHaveCount(0);
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored.source).toBe(source);
  expect(restored.identity).toEqual(original.identity);
});

test('reviews a nested group deletion and retires only the confirmed footprint', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  subgraph Fleet [Fleet]\r\n    subgraph Rack [Rack]\r\n'
    + '      subgraph Pool [Pool]\r\n        A[Service]\r\n      end\r\n      B[Worker]\r\n    end\r\n'
    + '    C[Neighbor]\r\n  end\r\n  D[Outside]\r\n  A internal@--> B\r\n'
    + '  Pool boundary@-->|"Reports"| D\r\n  C retained@--> D\r\n  linkStyle 0,1,2 stroke:#446677\r\n';
  const live = await openProject(page, 'Delete a nested group', source);
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project backup.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const original = await download();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await outline.getByRole('treeitem', { name: /Rack/ }).click();
  await outline.getByRole('button', { name: 'Delete group and contents' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const footprint = edit.getByRole('region', { name: 'Group contents to delete' });
  await expect(footprint.getByRole('list', { name: 'Nested groups to delete' })).toHaveText('Pool');
  await expect(footprint.getByRole('list', { name: 'Nodes to delete' }).getByRole('listitem')).toHaveText(['Service (A)', 'Worker (B)']);
  const connections = footprint.getByRole('list', { name: 'Connections to delete' });
  await expect(connections.getByRole('listitem')).toHaveCount(2);
  await expect(connections).toContainText('Reports');
  await expect(connections).not.toContainText('retained');
  const apply = edit.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeDisabled();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  await expect(apply).toBeEnabled();
  await page.screenshot({ path: info.outputPath('nested-deletion-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('nested-deletion-mobile.png') });
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await download();
  expect(applied.source).toBe(
    '\uFEFFflowchart LR\r\n  subgraph Fleet [Fleet]\r\n        \r\n      \r\n    C[Neighbor]\r\n  end\r\n'
      + '  D[Outside]\r\n  \r\n  \r\n  C retained@--> D\r\n  linkStyle 0 stroke:#446677\r\n',
  );
  expect(applied.identity.elements.filter((item: { status: string }) => item.status === 'resolved')).toEqual(
    original.identity.elements.filter((item: { binding: { sourceId: string } }) => ['Fleet', 'C', 'D', 'retained'].includes(item.binding.sourceId)),
  );
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...original, revision: applied.revision + 1, updatedAt: restored.updatedAt });
});

test('moves a reviewed node between nested groups while preserving its bindings and source bytes', async ({ page }, info) => {
  const declaration = '      B[Worker]\r\n';
  const source = '\uFEFFflowchart LR\r\n  subgraph Fleet [Fleet]\r\n    subgraph Rack [Rack]\r\n      A[Service]\r\n    end\r\n'
    + '    subgraph Pool [Pool]\r\n      %% Preserve this note\r\n' + declaration + '      C[Neighbor]\r\n    end\r\n  end\r\n'
    + '  D[External]\r\n  B existing@-->|"Reports"| D\r\n  linkStyle 0 stroke:#446677\r\n';
  const live = await openProject(page, 'Move between groups', source);
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project backup.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const original = await download();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const openOutline = live.getByRole('button', { name: 'Outline', exact: true });
  const rack = outline.getByRole('treeitem', { name: /Rack/ });
  const worker = outline.getByRole('treeitem', { name: /Worker/ });
  await openOutline.click();
  await rack.click();
  await outline.getByRole('button', { name: 'Move node into this group' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const nodes = edit.getByRole('combobox', { name: 'Node to move into Rack' });
  await expect(nodes.getByRole('option', { name: 'Service (A)' })).toHaveCount(0);
  await nodes.selectOption({ label: 'Worker (B)' });
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Group move impact' });
  await expect(impact).toContainText('Worker (B) will join Rack.');
  await expect(impact.getByRole('list', { name: 'Connections retained' })).toContainText('Reports');
  await page.screenshot({ path: info.outputPath('nested-move-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('nested-move-mobile.png') });
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const moved = await download();
  expect(moved.source).toBe(source.replace(declaration, '').replace('    end\r\n', declaration + '    end\r\n'));
  expect(moved.identity).toEqual(original.identity);
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await openOutline.click();
  await expect(worker).toBeVisible();
  await rack.click();
  await outline.getByRole('button', { name: 'Collapse group' }).click();
  await expect(worker).toHaveCount(0);
  await expect(outline.getByRole('treeitem', { name: /Neighbor/ })).toBeVisible();
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored.source).toBe(source);
  expect(restored.identity).toEqual(original.identity);
});

test('groups reviewed sibling nodes within an existing nested parent and preserves their connections', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  subgraph m_g1 [Fleet]\r\n    subgraph Team [Team]\r\n'
    + '      A[First]\r\n      %% Keep this comment\r\n      B[Second]\r\n      C[Neighbor]\r\n'
    + '    end\r\n  end\r\n  D[Outside]\r\n  B boundary@-->|"Sends"| D\r\n  linkStyle 0 stroke:#446677\r\n';
  const live = await openProject(page, 'Nest a reviewed group', source);
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing grouped project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const before = await download();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const first = outline.getByRole('treeitem', { name: /^First/ });
  const second = outline.getByRole('treeitem', { name: /^Second/ });
  const group = outline.getByRole('button', { name: 'Group selected nodes' });
  await first.click();
  await outline.getByRole('treeitem', { name: /^Outside/ }).click({ modifiers: ['Shift'] });
  await expect(group).toHaveCount(0);
  await first.click();
  await second.click({ modifiers: ['Shift'] });
  const query = outline.getByRole('textbox', { name: 'Find an element' });
  await query.fill('First');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await group.click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(edit.getByRole('region', { name: 'Selected group members' })).toContainText('2 selected · 1 hidden');
  await edit.getByRole('textbox', { name: 'Group label' }).fill('New batch');
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const apply = edit.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeEnabled();
  await page.screenshot({ path: info.outputPath('nested-group-creation-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('nested-group-creation-mobile.png') });
  await apply.click();
  await expect(outline.getByRole('treeitem', { name: /^New batch/ })).toHaveAttribute('aria-level', '3');
  await expect(first).toHaveAttribute('aria-level', '4');
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const grouped = await download();
  expect(grouped.source).toBe(source.replace('      A[First]', '      subgraph m_g2 ["New batch"]\r\n      A[First]')
    .replace('      C[Neighbor]', '      end\r\n      C[Neighbor]'));
  expect(grouped.identity.elements.filter((item: { binding: { sourceId: string } }) => item.binding.sourceId !== 'm_g2')).toEqual(before.identity.elements);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...before, revision: grouped.revision + 1, updatedAt: restored.updatedAt });
});

test('groups the complete reviewed outline selection and refuses a mixed selection', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  A[First]\r\n  B[Second]\r\n  C[Third]\r\n  A internal@--> B\r\n  B outside@-->|"External"| C\r\n';
  const live = await openProject(page, 'Group outline selection', source);
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing grouped project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const before = await download();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^First/ }).click();
  await outline.getByRole('treeitem', { name: /^Second/ }).click({ modifiers: ['Shift'] });
  const group = outline.getByRole('button', { name: 'Group selected nodes' });
  await expect(group).toBeVisible();
  await outline.getByRole('button', { name: 'Relationships', exact: true }).click();
  const edge = outline.getByRole('option', { name: /outside/ });
  await edge.click({ modifiers: ['Shift'] });
  await expect(group).toHaveCount(0);
  await edge.click({ modifiers: ['Shift'] });
  await outline.getByRole('button', { name: 'Nodes and groups' }).click();
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('First');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await group.click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const scope = edit.getByRole('region', { name: 'Selected group members' });
  await expect(scope.getByText('2 selected · 1 hidden in the outline')).toBeVisible();
  await expect(scope.getByRole('listitem')).toHaveText(['First (A)', 'Second (B)']);
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(group).toBeFocused();
  await group.click();
  await edit.getByRole('textbox', { name: 'Group label' }).fill('Team boundary');
  const apply = edit.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeDisabled();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Group impact' });
  await expect(impact.getByRole('list', { name: 'Connections crossing the group' })).toContainText('outside');
  await page.screenshot({ path: info.outputPath('outline-group-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('outline-group-mobile.png') });
  await apply.click();
  await expect(outline.getByRole('status')).toContainText('2 selected');
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const grouped = await download();
  expect(grouped.source).toBe(source.replace('  A[First]\r\n  B[Second]\r\n', '  subgraph m_g1 ["Team boundary"]\r\n  A[First]\r\n  B[Second]\r\n  end\r\n'));
  expect(grouped.identity.elements.slice(0, before.identity.elements.length)).toEqual(before.identity.elements);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...before, revision: grouped.revision + 1, updatedAt: restored.updatedAt });
});

test('applies one reviewed text color to eligible labels across an outline filter', async ({ page }, info) => {
  const nodes = Array.from({ length: 10 }, (_, index) => `N${index}[${index < 2 ? 'Focus' : 'Other'} ${index}]`);
  const source = ['flowchart LR', ...nodes, 'N0 path@--> N1', ''].join('\n');
  const live = await openProject(page, 'Bulk label styling', source);
  const readProject = async () => {
    const [file] = await Promise.all([
      page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click(),
    ]);
    const path = await file.path();
    if (!path) throw new Error('Missing styled project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  await expect(live.getByRole('img', { name: 'Diagram preview for Bulk label styling' })).toBeVisible();
  const before = await readProject();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('Focus');
  await outline.getByRole('button', { name: 'Select visible results' }).click();
  await expect(outline.getByRole('status')).toHaveText('2 selected · 0 hidden');
  await outline.getByRole('button', { name: 'Select all diagram elements' }).click();
  await expect(outline.getByRole('status')).toHaveText('11 selected · 9 hidden');
  await outline.getByRole('button', { name: 'Change selected text color' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change selected text color' });
  await expect(dialog.getByRole('status')).toHaveText('10 eligible of 11 selected · 9 hidden in the outline');
  await dialog.getByLabel('New text color').fill('#A13C65');
  await dialog.getByRole('button', { name: 'Preview text color' }).click();
  await expect(dialog.getByRole('img', { name: 'Diagram preview with selected text color' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('bulk-color-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('bulk-color-mobile.png') });
  await dialog.getByRole('button', { name: 'Apply to 10 eligible labels' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await readProject();
  const styled = Object.fromEntries(before.identity.elements
    .filter((item: { elementKind: string }) => item.elementKind === 'node')
    .map((item: { id: string }) => [item.id, { color: '#a13c65' }]));
  expect(after).toEqual({
    ...before, design: { ...before.design, elements: styled },
    revision: before.revision + 1, updatedAt: after.updatedAt,
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await readProject();
  expect(restored).toEqual({ ...before, revision: after.revision + 1, updatedAt: restored.updatedAt });
});
