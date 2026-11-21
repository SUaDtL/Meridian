import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';
import type { ComponentDefinition } from '../../src/lib/authoring/component-definition';

test('inserts a reviewed component and attachment as one source-preserving project change', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  m_n1[Intake]\r\n  End[Finish]\r\n  %% Keep the existing source\r\n  m_n1 m_e1@--> End\r\n';
  const manual = { ...createScene(), title: 'Original scene', visible: ['node:m_n1', 'node:End', 'edge:id:m_e1'] };
  const project = { ...createDocument(), title: 'Insertion example', source,
    storyboard: { version: 1 as const, scenes: [manual], loop: false } };
  project.design.elements['node:m_n1'] = { fill: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Insertion example' }).click();
  const live = page.getByRole('dialog', { name: 'Insertion example' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Insertion example' })).toBeVisible();
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const original = await download();
  await live.getByRole('button', { name: 'Commands', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
  await search.fill('Insert component');
  await search.press('Enter');
  const component = page.getByRole('dialog', { name: 'Insert component' });
  await component.getByRole('button', { name: /API, queue, and worker/ }).click();
  const preview = component.getByRole('button', { name: 'Preview component' });
  await expect(preview).toBeDisabled();
  await component.getByLabel('Find attachment nodes').fill('Intake');
  await component.getByRole('group', { name: 'Request input' }).getByRole('combobox', { name: 'Attachment target' })
    .selectOption({ label: 'Intake (m_n1)' });
  await expect(preview).toBeDisabled();
  await component.getByRole('group', { name: 'Worker result' }).getByRole('combobox', { name: 'Attachment target' })
    .selectOption({ label: 'Leave unconnected' });
  await preview.click();
  await expect(component.getByRole('img', { name: 'Proposed component diagram' })).toBeVisible();
  const attachments = component.getByRole('list', { name: 'Reviewed attachments' });
  await expect(attachments).toContainText('Request input · From Intake (m_n1)');
  await expect(attachments).toContainText('Worker result · Leave unconnected');
  await page.screenshot({ path: info.outputPath('component-insert-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('component-insert-mobile.png') });
  await component.getByRole('button', { name: 'Insert reviewed component' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const inserted = await download();
  expect(inserted.source).toBe(source + '  m_n2["API"]\r\n  m_n3[("Work queue")]\r\n  m_n4["Worker"]\r\n'
    + '  m_n2 m_e2@-->|"Enqueue"| m_n3\r\n  m_n3 m_e3@-->|"Consume"| m_n4\r\n  m_n1 m_e4@--> m_n2\r\n');
  expect(inserted.identity.elements.slice(0, original.identity.elements.length)).toEqual(original.identity.elements);
  expect(inserted.storyboard).toEqual(original.storyboard);
  expect(inserted.design).toEqual(original.design);
  expect(inserted.componentInstances).toHaveLength(1);
  expect(inserted.componentInstances[0].bindings.map((item: { localId: string }) => item.localId)).toEqual(['api', 'queue', 'worker', 'enqueue', 'consume']);
  expect(inserted.roles.map((item: { role: string }) => item.role)).toEqual(['service', 'queue', 'service']);

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await download();
  expect(undone).toEqual({ ...original, revision: inserted.revision + 1, updatedAt: undone.updatedAt });
});

test('inserts the same grouped component twice while keeping every current source binding distinct', async ({ page }) => {
  const source = 'flowchart LR\n  subgraph m_g1 [Existing area]\n    A[Intake]\n  end\n  B[Finish]\n  A current@--> B\n';
  const project = { ...createDocument(), title: 'Insert nested components', source };
  const definition: ComponentDefinition = {
    schema: 'meridian-component/v1', family: 'flowchart', id: crypto.randomUUID(), version: '1.0.0',
    name: 'Nested work unit', description: '', tags: [], provenance: { author: '', source: '', license: '', licenseText: '' },
    fragment: {
      nodes: [{ id: 'work', label: 'Worker', shape: 'rect', role: 'service' }],
      edges: [],
      groups: [
        { id: 'outer', label: 'Component area', members: ['inner'], parentId: null },
        { id: 'inner', label: 'Worker area', members: ['work'], parentId: 'outer' },
      ],
    },
    ports: [{ id: 'request', nodeId: 'work', label: 'Incoming work', direction: 'in' }], parameters: [], labelBindings: [],
  };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Insert nested components' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing grouped insertion project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const original = await download();
  async function insert(first: boolean) {
    await live.getByRole('button', { name: 'Outline', exact: true }).waitFor();
    await live.getByRole('button', { name: 'Commands', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
    await search.fill('Insert component');
    await search.press('Enter');
    const component = page.getByRole('dialog', { name: 'Insert component' });
    if (first) {
      await component.getByLabel('Import a component definition or library').setInputFiles({
        name: 'nested.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
      });
    } else await component.getByRole('button', { name: /^Nested work unit/ }).click();
    await component.getByRole('combobox', { name: 'Attachment target' }).selectOption({ label: 'Intake (A)' });
    await component.getByRole('button', { name: 'Preview component' }).click();
    await expect(component.getByText(/1 node · 0 internal connections · 2 groups/)).toBeVisible();
    await component.getByRole('button', { name: 'Insert reviewed component' }).click();
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    return download();
  }
  const first = await insert(true);
  const twice = await insert(false);
  expect(first.source).toBe(source + '  subgraph m_g2 ["Component area"]\n    subgraph m_g3 ["Worker area"]\n      m_n1["Worker"]\n    end\n  end\n  A m_e1@--> m_n1\n');
  expect(twice.source).toBe(first.source + '  subgraph m_g4 ["Component area"]\n    subgraph m_g5 ["Worker area"]\n      m_n2["Worker"]\n    end\n  end\n  A m_e2@--> m_n2\n');
  expect(twice.identity.elements.slice(0, first.identity.elements.length)).toEqual(first.identity.elements);
  const [one, two] = twice.componentInstances;
  expect(one).toEqual(first.componentInstances[0]);
  expect(new Set([...one.bindings, ...two.bindings].map(item => item.elementId)).size).toBe(6);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...first, revision: twice.revision + 1, updatedAt: restored.updatedAt });
  expect(first.identity.elements.slice(0, original.identity.elements.length)).toEqual(original.identity.elements);
});

test('resumes component parameters and distinguishes unanswered, unconnected, and directed ports', async ({ page }) => {
  const source = 'flowchart LR\n  In[Intake]\n  End[Finish]\n  In first@--> End\n';
  const project = { ...createDocument(), title: 'Draft insertion', source };
  const definition: ComponentDefinition = {
    schema: 'meridian-component/v1', family: 'flowchart', id: crypto.randomUUID(), version: '1.0.0',
    name: 'Configurable worker', description: 'A worker with a configurable service name.', tags: ['test'],
    provenance: { author: 'Meridian test', source: 'Browser fixture', license: '', licenseText: '' },
    fragment: {
      nodes: [{ id: 'api', label: 'API', shape: 'rect', role: 'service' }, { id: 'worker', label: 'Worker', shape: 'rect', role: 'service' }],
      edges: [
        { id: 'queued', sourceId: 'api', targetId: 'worker', label: 'Queued', direction: 'both' },
        { id: 'shared', sourceId: 'api', targetId: 'worker', label: 'Shared capacity', direction: 'none' },
      ],
      groups: [],
    },
    ports: [{ id: 'request', nodeId: 'api', label: 'Request input', direction: 'either' },
      { id: 'result', nodeId: 'worker', label: 'Worker result', direction: 'out' }],
    parameters: [{ id: 'service', type: 'text', label: 'Service name', default: 'API', maxLength: 40, required: true }],
    labelBindings: [{ nodeId: 'api', parameterId: 'service', prefix: '', suffix: '' }],
  };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  async function openProject(prepare: boolean) {
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    if (prepare) await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await page.getByRole('button', { name: 'Open v3 project Draft insertion' }).click();
  }
  const live = page.getByRole('dialog', { name: 'Draft insertion' });
  async function openInsertion() {
    await live.getByRole('button', { name: 'Commands', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
    await search.fill('Insert component');
    await search.press('Enter');
  }
  await page.goto('/');
  await openProject(true);
  await openInsertion();
  const component = page.getByRole('dialog', { name: 'Insert component' });
  await component.getByLabel('Import a component definition or library').setInputFiles({
    name: 'worker.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
  });
  const service = component.getByRole('textbox', { name: 'Service name' });
  const request = component.getByRole('group', { name: 'Request input' });
  const ownTarget = request.getByRole('combobox', { name: 'Attachment target' });
  const direction = request.getByRole('combobox', { name: 'Connection direction' });
  const result = component.getByRole('group', { name: 'Worker result' }).getByRole('combobox', { name: 'Attachment target' });
  const resume = component.getByRole('button', { name: /Resume Configurable worker draft/ });
  const close = component.getByRole('button', { name: 'Close dialog' });
  const preview = component.getByRole('button', { name: 'Preview component' });
  await service.fill('Reviewed worker');
  await ownTarget.selectOption({ label: 'Intake (In)' });
  await direction.selectOption('out');
  await component.getByRole('button', { name: 'Save component draft' }).click();
  await expect(component.getByRole('status')).toHaveText('Component choices saved as a local draft.');
  await close.click();
  await page.reload();
  await openProject(false);
  await openInsertion();
  await resume.click();
  await expect(service).toHaveValue('Reviewed worker');
  await expect(ownTarget.locator('option:checked')).toHaveText('Intake (In)');
  await expect(direction).toHaveValue('out');
  await expect(result).toHaveValue('');
  await expect(preview).toBeDisabled();
  await result.selectOption('skip');
  await close.click();
  await expect(component).toBeHidden();
  await openInsertion();
  await resume.click();
  await expect(result).toHaveValue('skip');
  await expect(direction).toHaveValue('out');
  await preview.click();
  const reviewed = component.getByRole('list', { name: 'Reviewed attachments' });
  await expect(reviewed).toContainText('Request input · To Intake (In)');
  await expect(reviewed).toContainText('Worker result · Leave unconnected');
  await component.getByRole('button', { name: 'Insert reviewed component' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing inserted component project download.');
  const inserted = JSON.parse(await readFile(path, 'utf8'));
  expect(inserted.source).toContain('m_n1["Reviewed worker"]');
  expect(inserted.source).toContain('m_n1 m_e1@<-->|"Queued"| m_n2');
  expect(inserted.source).toContain('m_n1 m_e2@---|"Shared capacity"| m_n2');
  expect(inserted.source).toContain('m_n1 m_e3@--> In');
  expect(inserted.componentInstances[0].bindings.map((item: { localId: string }) => item.localId)).toEqual(['api', 'worker', 'queued', 'shared']);
  await openInsertion();
  await expect(component.getByRole('button', { name: /^Configurable worker/ })).toBeVisible();
  await expect(resume).toHaveCount(0);
});

test('reviews a same-version replacement and rejects an already prepared insertion from another tab', async ({ page }, info) => {
  const project = { ...createDocument(), title: 'Replacement insertion', source: 'flowchart LR\n  In[Intake]\n' };
  const definition: ComponentDefinition = {
    schema: 'meridian-component/v1', family: 'flowchart', id: crypto.randomUUID(), version: '1.0.0',
    name: 'Current worker', description: '', tags: [],
    provenance: { author: 'Meridian test', source: 'Browser fixture', license: '', licenseText: '' },
    fragment: { nodes: [{ id: 'worker', label: 'First worker', shape: 'rect', role: 'service' }], edges: [], groups: [] },
    ports: [], parameters: [], labelBindings: [],
  };
  const replacement = { ...definition, name: 'Reviewed worker', fragment: { ...definition.fragment,
    nodes: [{ ...definition.fragment.nodes[0], label: 'Second worker' }] } };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Replacement insertion' }).click();
  const live = page.getByRole('dialog', { name: 'Replacement insertion' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Replacement insertion' })).toBeVisible();
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing replacement insertion project.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  async function openInsertion() {
    await live.getByRole('button', { name: 'Commands', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
    await search.fill('Insert component');
    await search.press('Enter');
  }
  const component = page.getByRole('dialog', { name: 'Insert component' });
  const importLabel = 'Import a component definition or library';
  const fixture = (value: ComponentDefinition) => ({ name: 'worker.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  const insert = component.getByRole('button', { name: 'Insert reviewed component' });
  const preview = component.getByRole('button', { name: 'Preview component' });
  await openInsertion();
  await component.getByLabel(importLabel).setInputFiles(fixture(definition));
  await preview.click();
  await insert.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const before = await download();
  expect(before.source).toContain('First worker');
  await openInsertion();
  await component.getByRole('button', { name: /^Current worker/ }).click();
  await preview.click();
  await expect(insert).toBeEnabled();

  const other = await page.context().newPage();
  try {
    await other.goto('/');
    await other.getByRole('button', { name: 'Build with guidance' }).click();
    await other.getByRole('button', { name: 'Browse components' }).click();
    const shelf = other.getByRole('dialog', { name: 'Components' });
    const file = shelf.getByLabel(importLabel);
    await file.setInputFiles(fixture(replacement));
    const comparison = shelf.getByRole('region', { name: 'Compare component definitions' });
    await expect(comparison.getByRole('heading', { name: 'Review changes to a saved component' })).toBeFocused();
    await expect(comparison.getByRole('list', { name: 'Changed definition fields' }).getByRole('listitem'))
      .toHaveText(['Name', 'Nodes, connections, and groups']);
    await expect(comparison.getByRole('button', { name: 'Import as copy' })).toBeEnabled();
    await other.screenshot({ path: info.outputPath('component-replacement-desktop.png') });
    await other.setViewportSize({ width: 390, height: 844 });
    await other.screenshot({ path: info.outputPath('component-replacement-mobile.png') });
    await comparison.getByText('Compare exact definitions').click();
    await expect(comparison.locator('pre').first()).toContainText('First worker');
    await expect(comparison.locator('pre').last()).toContainText('Second worker');
    await comparison.getByRole('button', { name: 'Cancel import' }).click();
    await expect(file).toBeFocused();
    await expect(shelf.getByRole('button', { name: /^Current worker/ })).toBeVisible();
    await file.setInputFiles(fixture(replacement));
    await comparison.getByRole('button', { name: 'Replace saved definition' }).click();
    await expect(shelf.getByRole('status')).toHaveText('Saved the reviewed replacement definition.');
  } finally { await other.close(); }

  await insert.click();
  await expect(component.getByRole('alert')).toContainText('The saved definition changed.');
  await expect(insert).toHaveCount(0);
  await component.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download()).toEqual(before);
  await openInsertion();
  await component.getByRole('button', { name: /^Reviewed worker/ }).click();
  await preview.click();
  await insert.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await download();
  expect(after.source).toContain('First worker');
  expect(after.source).toContain('Second worker');
  expect(after.componentInstances[0]).toEqual(before.componentInstances[0]);
  expect(after.componentInstances[1]).toMatchObject({ definitionId: definition.id, definitionVersion: definition.version });
  expect(after.componentInstances[1].definitionHash).not.toBe(before.componentInstances[0].definitionHash);
});
