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
});

test('imports conflicting library definitions as copies and exports them after reload', async ({ page }) => {
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
  await expect(restored.getByRole('button', { name: /Team approval/ })).toBeVisible();
  await expect(restored.getByRole('button', { name: /Independent approval/ })).toBeVisible();
  const [backup] = await Promise.all([page.waitForEvent('download'), restored.getByRole('button', { name: 'Download component library' }).click()]);
  const path = await backup.path();
  if (!path) throw new Error('Missing library backup.');
  const result = JSON.parse(await readFile(path, 'utf8'));
  expect(result.schema).toBe('meridian-library/v1');
  expect(result.definitions).toHaveLength(2);
  expect(result.definitions.find((entry: { name: string }) => entry.name === original.name)).toEqual(original);
  const copy = result.definitions.find((entry: { name: string }) => entry.name === conflict.name);
  expect(copy.id).not.toBe(id);
  expect(copy).toEqual({ ...conflict, id: copy.id });
});
