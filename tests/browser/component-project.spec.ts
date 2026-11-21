import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const serviceComponent = {
  schema: 'meridian-component/v1', family: 'flowchart', version: '1.0.0',
  id: '44ac035b-2ddb-4d20-a745-eb59fb16ca9b', name: 'Local service component',
  description: 'Accept and process work.', tags: ['architecture'],
  provenance: { author: 'Test fixture', source: 'Browser test', license: '', licenseText: '' },
  fragment: {
    nodes: [
      { id: 'api', label: 'API', role: 'service', shape: 'rect' },
      { id: 'queue', label: 'Work queue', role: 'queue', shape: 'cylinder' },
      { id: 'worker', label: 'Worker', role: 'service', shape: 'rect' },
    ],
    edges: [
      { id: 'enqueue', sourceId: 'api', targetId: 'queue', label: 'Enqueue', direction: 'forward' },
      { id: 'consume', sourceId: 'queue', targetId: 'worker', label: 'Consume', direction: 'forward' },
    ],
    groups: [],
  },
  ports: [{ id: 'request', nodeId: 'api', label: 'Request input', direction: 'in' }],
  parameters: [], labelBindings: [],
};

test('previews a typed component, stores only instance bindings, and preserves the renamed label', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Browse components' }).click();
  const shelf = page.getByRole('dialog', { name: 'Components' });
  await shelf.getByLabel('Search components').fill('queue');
  await expect(shelf.getByRole('button', { name: /API, queue, and worker/ })).toBeVisible();
  await expect(shelf.getByRole('button', { name: /Approval branch/ })).toHaveCount(0);

  const definition = {
    ...serviceComponent,
    fragment: { ...serviceComponent.fragment, edges: [
      { ...serviceComponent.fragment.edges[0], direction: 'both' },
      { ...serviceComponent.fragment.edges[1], direction: 'none' },
    ] },
    parameters: [{ id: 'serviceName', label: 'API name', required: true, type: 'text', default: 'Public', maxLength: 50 }],
    labelBindings: [{ nodeId: 'api', parameterId: 'serviceName', prefix: 'API ', suffix: '' }],
  };
  await shelf.getByLabel('Import a component definition').setInputFiles({
    name: 'test.meridian-component.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
  });
  await shelf.getByRole('textbox', { name: 'API name' }).fill('Edge service');
  await expect(shelf.getByRole('status')).toHaveText('Component saved locally.');
  const preview = shelf.getByRole('button', { name: 'Preview component' });
  await expect(preview).toBeDisabled();
  await shelf.getByRole('checkbox', { name: 'Leave the ports unconnected in this new project' }).check();
  await preview.click();
  await expect(shelf.getByRole('img', { name: 'Proposed component diagram' })).toBeVisible();
  await shelf.getByRole('button', { name: 'Create component project' }).click();
  const live = page.getByRole('dialog', { name: 'Local service component' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Local service component' })).toBeVisible();
  async function downloadProject() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const created = await downloadProject();
  expect(created.source).toContain('m_n1["API Edge service"]');
  expect(created.source).toContain('m_n1 m_e1@<-->|"Enqueue"| m_n2');
  expect(created.source).toContain('m_n2 m_e2@---|"Consume"| m_n3');
  expect(created.componentInstances).toHaveLength(1);
  const instance = created.componentInstances[0];
  expect(instance).toMatchObject({ definitionId: definition.id, definitionVersion: '1.0.0', definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(instance.bindings.map((record: { localId: string }) => record.localId)).toEqual(['api', 'queue', 'worker', 'enqueue', 'consume']);
  expect(JSON.stringify(instance)).not.toContain('Edge service');

  await live.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit flowchart' });
  await editor.getByRole('combobox', { name: 'Operation' }).selectOption('setNodeLabel');
  await editor.getByRole('combobox', { name: 'Node to rename' }).selectOption({ label: 'API Edge service (m_n1)' });
  await editor.getByRole('textbox', { name: 'Node label' }).fill('API gateway');
  await editor.getByRole('button', { name: 'Preview change' }).click();
  await editor.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const renamed = await downloadProject();
  expect(renamed.source).toContain('m_n1["API gateway"]');
  expect(renamed.componentInstances).toEqual(created.componentInstances);
  expect(JSON.stringify(renamed)).not.toContain('Edge service');

  await live.getByRole('button', { name: 'Detach component', exact: true }).click();
  const detach = page.getByRole('dialog', { name: 'Detach component' });
  await detach.getByLabel('Component instance').selectOption(instance.id);
  await expect(detach.getByRole('list', { name: 'Elements in this instance' })).toContainText('API gateway');
  await detach.getByRole('button', { name: 'Detach instance' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const detached = await downloadProject();
  expect(detached).toEqual({ ...renamed, revision: renamed.revision + 1, updatedAt: detached.updatedAt, componentInstances: [] });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject();
  expect(restored).toEqual({ ...renamed, revision: detached.revision + 1, updatedAt: restored.updatedAt });
});

test('creates a component project with nested verified containment and durable group identities', async ({ page, browser }, info) => {
  const definition = {
    ...serviceComponent, id: crypto.randomUUID(), name: 'Nested service component', ports: [],
    fragment: { ...serviceComponent.fragment, groups: [
      { id: 'outer', label: 'Service boundary', members: ['api', 'inner'], parentId: null },
      { id: 'inner', label: 'Queue boundary', members: ['queue'], parentId: 'outer' },
    ] },
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Browse components' }).click();
  const shelf = page.getByRole('dialog', { name: 'Components' });
  await shelf.getByLabel('Import a component definition').setInputFiles({
    name: 'nested.meridian-component.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(definition)),
  });
  await shelf.getByRole('button', { name: 'Preview component' }).click();
  await expect(shelf.getByRole('img', { name: 'Proposed component diagram' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('grouped-component-review.png') });
  await shelf.getByRole('button', { name: 'Create component project' }).click();
  const live = page.getByRole('dialog', { name: 'Nested service component' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Nested service component' })).toBeVisible();
  async function download(name: string) {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name, exact: true }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing grouped component project download.');
    return readFile(path, 'utf8');
  }
  const saved = JSON.parse(await download('Download v3 project'));
  expect(saved.source).toContain('subgraph m_g1 ["Service boundary"]\n    m_n1["API"]\n    subgraph m_g2 ["Queue boundary"]\n      m_n2[("Work queue")]\n    end\n  end');
  const groups = saved.identity.elements.filter((item: { elementKind: string }) => item.elementKind === 'group');
  expect(groups).toHaveLength(2);
  for (const [local, source] of [['outer', 'm_g1'], ['inner', 'm_g2']]) {
    const element = groups.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === source);
    expect(saved.componentInstances[0].bindings).toContainEqual({ localId: local, elementId: element.id });
  }
  const html = await download('Download HTML presentation');
  const offline = await browser.newContext({ offline: true });
  try {
    const presentation = await offline.newPage();
    await presentation.setContent(html);
    await expect(presentation.getByText('Service boundary', { exact: true })).toBeVisible();
    await expect(presentation.getByText('Queue boundary', { exact: true })).toBeVisible();
  } finally { await offline.close(); }
});

test('explicit replacement preserves the distinct library entry made by Import as copy', async ({ page }) => {
  const original = { ...serviceComponent, id: crypto.randomUUID(), name: 'Original approval' };
  const alternative = { ...original, name: 'Independent approval' };
  const replacement = { ...original, name: 'Reviewed approval update' };
  const shelf = page.getByRole('dialog', { name: 'Components' });
  const compare = shelf.getByRole('region', { name: 'Compare component definitions' });
  const back = shelf.getByRole('button', { name: 'Back to components' });
  async function openShelf() {
    await page.getByRole('button', { name: 'Build with guidance' }).click();
    await page.getByRole('button', { name: 'Browse components' }).click();
  }
  async function importDefinition(value: typeof original) {
    await shelf.getByLabel('Import a component definition or library').setInputFiles({
      name: 'approval.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
    });
  }
  async function exportDefinitions() {
    const [file] = await Promise.all([page.waitForEvent('download'), shelf.getByRole('button', { name: 'Download component library' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing library backup.');
    return (JSON.parse(await readFile(path, 'utf8')) as { definitions: (typeof original)[] }).definitions;
  }

  await page.goto('/');
  await openShelf();
  await importDefinition(original);
  await back.click();
  expect(await exportDefinitions()).toEqual([original]);

  await importDefinition(alternative);
  await compare.getByRole('button', { name: 'Import as copy' }).click();
  await back.click();
  const withCopy = await exportDefinitions();
  expect(withCopy).toHaveLength(2);
  expect(withCopy).toContainEqual(original);
  const copy = withCopy.find(entry => entry.name === alternative.name);
  expect(copy?.id).toBeTruthy();
  expect(copy?.id).not.toBe(original.id);
  expect(copy).toEqual({ ...alternative, id: copy?.id });

  await importDefinition(replacement);
  await compare.getByRole('button', { name: 'Replace saved definition' }).click();
  await back.click();
  await page.reload();
  await openShelf();
  const saved = await exportDefinitions();
  expect(saved).toHaveLength(2);
  expect(saved).toEqual(expect.arrayContaining([replacement, copy]));
});

test('imports library conflicts as copies and restores an explicitly removed definition', async ({ page }) => {
  async function openShelf() {
    await page.getByRole('button', { name: 'Build with guidance' }).click();
    await page.getByRole('button', { name: 'Browse components' }).click();
    return page.getByRole('dialog', { name: 'Components' });
  }
  const id = '279f37e9-9804-459e-82dd-06176008828e';
  const original = { ...serviceComponent, id, name: 'Team approval' };
  const conflict = { ...original, name: 'Independent approval' };
  await page.goto('/');
  const shelf = await openShelf();
  await shelf.getByLabel('Import a component definition or library').setInputFiles({
    name: 'team.meridian-library.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schema: 'meridian-library/v1', definitions: [original, conflict] })),
  });
  await expect(shelf.getByRole('status')).toHaveText('2 components saved locally. One conflict was saved as a separate copy.');
  await page.reload();
  const restored = await openShelf();
  const originalCard = restored.getByRole('button', { name: /^Team approval/ });
  await expect(originalCard).toBeVisible();
  await expect(restored.getByRole('button', { name: /^Independent approval/ })).toBeVisible();
  async function readDownload(name: string) {
    const [backup] = await Promise.all([page.waitForEvent('download'), restored.getByRole('button', { name, exact: true }).click()]);
    const path = await backup.path();
    if (!path) throw new Error('Missing library backup.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const result = await readDownload('Download component library');
  expect(result.schema).toBe('meridian-library/v1');
  expect(result.definitions).toHaveLength(2);
  expect(result.definitions.find((entry: { name: string }) => entry.name === original.name)).toEqual(original);
  const copy = result.definitions.find((entry: { name: string }) => entry.name === conflict.name);
  expect(copy.id).not.toBe(id);
  expect(copy).toEqual({ ...conflict, id: copy.id });

  const remove = restored.getByRole('button', { name: /Remove Team approval version/ });
  const review = restored.getByRole('region', { name: 'Review library removal' });
  await remove.click();
  await expect(review.getByRole('heading')).toBeFocused();
  await review.getByRole('button', { name: 'Cancel removal' }).click();
  await expect(remove).toBeFocused();
  expect(await readDownload('Download component library')).toEqual(result);
  await remove.click();
  await review.getByRole('button', { name: 'Remove definition' }).click();
  const undo = restored.getByRole('button', { name: 'Undo library removal' });
  await expect(undo).toBeFocused();
  await expect(originalCard).toHaveCount(0);
  expect((await readDownload('Download component library')).definitions).toEqual([copy]);
  expect(await readDownload('Download removed definition')).toEqual(original);
  await undo.click();
  await expect(originalCard).toBeFocused();
  expect(await readDownload('Download component library')).toEqual(result);
  await page.reload();
  await openShelf();
  expect(await readDownload('Download component library')).toEqual(result);
});
