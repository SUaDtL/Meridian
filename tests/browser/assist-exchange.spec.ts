import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { canonicalDigest } from '../../src/lib/authoring/base-token';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing local exchange file.');
  return readFile(path, 'utf8');
}

async function openProject(page: Page, title: string, source: string, configure?: (project: ReturnType<typeof createDocument>) => void) {
  const project = { ...createDocument(), title, source };
  configure?.(project);
  await page.addInitScript(({ key, project }) => localStorage.setItem(
    key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }),
  ), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: `Open v3 project ${title}` }).click();
  const live = page.getByRole('dialog', { name: title });
  await expect(live.getByRole('img', { name: `Diagram preview for ${title}` })).toBeVisible();
  return live;
}

async function openExchange(page: Page, live: Locator) {
  await live.getByRole('button', { name: 'Commands' }).click();
  const commands = page.getByRole('dialog', { name: 'Commands' });
  await commands.getByRole('combobox').fill('external assistant');
  await commands.getByRole('option', { name: /External assistant file exchange/ }).click();
  const dialog = page.getByRole('dialog', { name: 'External assistant file exchange' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function review(dialog: Locator, value: object) {
  await dialog.getByLabel('Assistant proposal file').setInputFiles({
    name: 'return.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
  await dialog.getByRole('button', { name: 'Preview unverified suggestion' }).click();
}

test('exports scoped facts offline, rejects context-only changes, and applies a matched rename once with Undo', async ({ page, context }, info) => {
  const source = 'flowchart LR\n A[First]\n B[Context node]\n C[Excluded node]\n A path@--> B\n %% original-source-only\n';
  const live = await openProject(page, 'Scoped exchange', source);
  const before = await download(page, live.getByRole('button', { name: 'Download v3 project' }));
  const dialog = await openExchange(page, live);
  await context.setOffline(true);
  await dialog.getByLabel('Instruction').fill('Use a short literal label on the writable node.');
  await dialog.getByRole('combobox', { name: 'First', exact: true }).selectOption('writable');
  await dialog.getByRole('combobox', { name: 'Context node', exact: true }).selectOption('context');
  await dialog.getByRole('button', { name: 'Review what will be shared' }).click();
  await expect(dialog.getByRole('region', { name: 'What will be shared' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('request-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('request-mobile.png') });
  const text = await download(page, dialog.getByRole('button', { name: 'Download request' }));
  expect(text).not.toMatch(/original-source-only|Excluded node|"source":|"storyboard":|"svg":/);
  const request = JSON.parse(text);
  const requestHash = await canonicalDigest('meridian-assist-request/v1', request);
  expect(request.requestId).toMatch(/^[a-f0-9-]{14}7[a-f0-9-]+$/);
  expect(request.graph.edges).toEqual([expect.objectContaining({ label: '' })]);
  const writable = request.graph.nodes.find((node: { label: string }) => node.label === 'First');
  const contextOnly = request.graph.nodes.find((node: { label: string }) => node.label === 'Context node');
  expect(request.scope.writableElementIds).toEqual([writable.id]);
  expect(request.scope.attachmentPointIds).toEqual([]);
  expect(request.allowedOperations).toEqual(['setNodeLabel']);
  const pending = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('pendingAssist');
      const read = tx.objectStore('pendingAssist').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    open.onerror = () => reject(open.error);
  }));
  expect(pending).toEqual([expect.objectContaining({ id: request.requestId, requestHash })]);
  expect(JSON.stringify(pending)).not.toMatch(/literal label|Context node/);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download(page, live.getByRole('button', { name: 'Download v3 project' }))).toBe(before);

  await openExchange(page, live);
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  const proposal = {
    schema: 'meridian-proposal/v1', id: crypto.randomUUID(), documentKind: 'mermaid', origin: 'ai',
    requestId: request.requestId, requestHash, baseToken: request.baseToken,
    operations: [{ op: 'setNodeLabel', targetId: writable.id, label: 'Reviewed label' }],
  };
  await review(dialog, { ...proposal, origin: 'canvas' });
  await expect(dialog.getByRole('alert')).toContainText('one supported label edit or removal');
  await review(dialog, { ...proposal, operations: [{ ...proposal.operations[0], targetId: contextOnly.id }] });
  await expect(dialog.getByRole('alert')).toContainText('outside the request’s writable scope');
  await review(dialog, { ...proposal, baseToken: { ...proposal.baseToken, stateDigest: 'a'.repeat(64) } });
  await expect(dialog.getByRole('alert')).toContainText('does not match a live request');
  await review(dialog, proposal);
  await expect(dialog.getByRole('img', { name: 'Diagram preview with proposed node label' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Unverified suggestion' })).toContainText('Rename First to Reviewed label.');
  await dialog.getByRole('button', { name: 'Apply reviewed rename' }).click();
  await expect(dialog).toBeHidden();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const original = JSON.parse(before);
  const after = JSON.parse(await download(page, live.getByRole('button', { name: 'Download v3 project' })));
  expect(after).toEqual({
    ...original, source: source.replace('[First]', '["Reviewed label"]'),
    revision: original.revision + 1, updatedAt: after.updatedAt,
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = JSON.parse(await download(page, live.getByRole('button', { name: 'Download v3 project' })));
  expect(restored).toEqual({ ...original, revision: after.revision + 1, updatedAt: restored.updatedAt });
  await openExchange(page, live);
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  await review(dialog, proposal);
  await expect(dialog.getByRole('alert')).toContainText('no longer matches a live request');
});

test('grants one explicit connection label with context-only endpoints and protects its parallel neighbor', async ({ page, context }, info) => {
  const source = 'flowchart LR\r\n A[First]\r\n B[Second]\r\n A keep@-->|"Keep this"| B\r\n A clear@-->|"Clear this"| B\r\n linkStyle 0 stroke-dasharray:7 5\r\n linkStyle 1 stroke-dasharray:2 4\r\n';
  const live = await openProject(page, 'Connection exchange', source);
  const projectFile = live.getByRole('button', { name: 'Download v3 project' });
  const original = JSON.parse(await download(page, projectFile));
  const dialog = await openExchange(page, live);
  await context.setOffline(true);
  await dialog.getByLabel('Instruction').fill('Clear the label on the selected connection.');
  await dialog.getByRole('combobox', { name: 'First', exact: true }).selectOption('context');
  const end = dialog.getByRole('combobox', { name: 'Second', exact: true });
  await end.selectOption('context');
  const connection = dialog.getByRole('checkbox', { name: 'First to Second (clear) · Clear this' });
  await connection.check();
  await end.selectOption('');
  await expect(connection).toHaveCount(0);
  await end.selectOption('context');
  await expect(connection).not.toBeChecked();
  await connection.check();
  await dialog.getByRole('button', { name: 'Review what will be shared' }).click();
  const disclosure = dialog.getByRole('region', { name: 'What will be shared' });
  await expect(disclosure.getByText(/Clear this.*dotted.*Writable connection/)).toBeVisible();
  await expect(disclosure.getByText(/Keep this.*dashed.*Read-only context/)).toBeVisible();
  const request = JSON.parse(await download(page, dialog.getByRole('button', { name: 'Download request' })));
  expect(request.graph.edges.map((edge: { label: string; lineStyle: string }) => [edge.label, edge.lineStyle]))
    .toEqual([['Keep this', 'dashed'], ['Clear this', 'dotted']]);
  const edgeId = request.graph.edges.find((edge: { label: string }) => edge.label === 'Clear this').id;
  const otherId = request.graph.edges.find((edge: { label: string }) => edge.label === 'Keep this').id;
  expect(request.scope.writableElementIds).toEqual([edgeId]);
  expect(request.allowedOperations).toEqual(['setEdgeLabel']);
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  const operation = { op: 'setEdgeLabel', targetId: edgeId, label: '' };
  const proposal = {
    schema: 'meridian-proposal/v1', id: crypto.randomUUID(), documentKind: 'mermaid', origin: 'ai',
    requestId: request.requestId, requestHash: await canonicalDigest('meridian-assist-request/v1', request), baseToken: request.baseToken,
    operations: [operation],
  };
  await review(dialog, { ...proposal, operations: [{ ...operation, targetId: otherId }] });
  await expect(dialog.getByRole('alert')).toContainText('outside the request’s writable scope');
  await review(dialog, { ...proposal, operations: [{ op: 'removeEdge', targetId: edgeId, annotationPolicy: 'preserve-orphans' }] });
  await expect(dialog.getByRole('alert')).toContainText('outside the request’s writable scope');
  await review(dialog, { ...proposal, operations: [{ op: 'setNodeLabel', targetId: request.graph.nodes[0].id, label: 'Changed' }] });
  await expect(dialog.getByRole('alert')).toContainText('outside the request’s writable scope');
  await review(dialog, proposal);
  await expect(dialog.getByRole('img', { name: 'Diagram preview with proposed connection label' })).toBeVisible();
  await expect(dialog.getByText('Clear the label of First to Second (clear).')).toBeVisible();
  await page.screenshot({ path: info.outputPath('connection-label-review.png') });
  await dialog.getByRole('button', { name: 'Apply reviewed connection label' }).click();
  await expect(dialog).toBeHidden();
  const applied = JSON.parse(await download(page, projectFile));
  expect(applied).toEqual({ ...original, source: source.replace('|"Clear this"|', ''), revision: original.revision + 1, updatedAt: applied.updatedAt });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = JSON.parse(await download(page, projectFile));
  expect(undone).toEqual({ ...original, revision: applied.revision + 1, updatedAt: undone.updatedAt });
});

test('removes one explicitly authorized connection offline and retains its scene references with exact Undo', async ({ page, context }, info) => {
  const source = 'flowchart LR\r\n A[First]\r\n B[Second]\r\n A drop@-->|"Remove this"| B\r\n A keep@-->|"Keep this"| B\r\n linkStyle 0 stroke:#aaaaaa\r\n linkStyle 1 stroke:#123456\r\n';
  const key = 'edge:id:drop';
  const scene = { ...createScene(), title: 'Original transition', visible: ['node:A', 'node:B', key], flow: [key] };
  const live = await openProject(page, 'Connection removal exchange', source, project => {
    project.storyboard = { version: 1, scenes: [scene], loop: false };
    project.design.elements[key] = { stroke: '#abcdef' };
  });
  const projectFile = live.getByRole('button', { name: 'Download v3 project' });
  const original = JSON.parse(await download(page, projectFile));
  const dialog = await openExchange(page, live);
  await context.setOffline(true);
  await dialog.getByLabel('Instruction').fill('Review removing the obsolete connection.');
  await dialog.getByRole('combobox', { name: 'First', exact: true }).selectOption('context');
  await dialog.getByRole('combobox', { name: 'Second', exact: true }).selectOption('context');
  const selected = dialog.getByRole('checkbox', { name: 'First to Second (drop) · Remove this' });
  await selected.check();
  await dialog.getByRole('combobox', { name: 'Allowed connection change' }).selectOption('removeEdge');
  await expect(selected).not.toBeChecked();
  const share = dialog.getByRole('button', { name: 'Review what will be shared' });
  await expect(share).toBeDisabled();
  await selected.check();
  await share.click();
  const disclosure = dialog.getByRole('region', { name: 'What will be shared' });
  await expect(disclosure.getByText(/Remove this.*Removal allowed/)).toBeVisible();
  await expect(disclosure.getByText(/Keep this.*Read-only context/)).toBeVisible();
  const request = JSON.parse(await download(page, dialog.getByRole('button', { name: 'Download request' })));
  const edgeId = request.graph.edges.find((edge: { label: string }) => edge.label === 'Remove this').id;
  const neighborId = request.graph.edges.find((edge: { label: string }) => edge.label === 'Keep this').id;
  expect(request.scope.writableElementIds).toEqual([edgeId]);
  expect(request.allowedOperations).toEqual(['removeEdge']);
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  const operation = { op: 'removeEdge', targetId: edgeId, annotationPolicy: 'preserve-orphans' };
  const proposal = {
    schema: 'meridian-proposal/v1', id: crypto.randomUUID(), documentKind: 'mermaid', origin: 'ai',
    requestId: request.requestId, requestHash: await canonicalDigest('meridian-assist-request/v1', request), baseToken: request.baseToken,
    operations: [operation],
  };
  await review(dialog, { ...proposal, operations: [{ ...operation, annotationPolicy: 'remove-related' }] });
  await expect(dialog.getByRole('alert')).toContainText('that preserves annotations');
  await review(dialog, { ...proposal, operations: [{ ...operation, targetId: neighborId }] });
  await expect(dialog.getByRole('alert')).toContainText('outside the request’s writable scope');
  await review(dialog, proposal);
  await expect(dialog.getByRole('img', { name: 'Diagram preview after proposed connection removal' })).toBeVisible();
  const impact = dialog.getByRole('region', { name: 'Retained annotations' });
  await expect(impact).toContainText('2 scene references and 1 style');
  await expect(impact).toContainText('Original transition');
  await page.screenshot({ path: info.outputPath('connection-removal-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('connection-removal-review-mobile.png') });
  await dialog.getByRole('button', { name: 'Apply reviewed connection removal' }).click();
  await expect(dialog).toBeHidden();
  const removed = JSON.parse(await download(page, projectFile));
  expect(removed.source).toBe(source.replace('A drop@-->|"Remove this"| B', '').replace('linkStyle 0 stroke:#aaaaaa', '')
    .replace('linkStyle 1 stroke:#123456', 'linkStyle 0 stroke:#123456'));
  expect(removed.identity.orphans).toContainEqual(expect.objectContaining({ formerElementId: edgeId, retained: {
    style: { stroke: '#abcdef' }, sceneReferences: [{ sceneId: scene.id, field: 'visible', index: 2 }, { sceneId: scene.id, field: 'flow', index: 0 }],
  } }));
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = JSON.parse(await download(page, projectFile));
  expect(undone).toEqual({ ...original, revision: removed.revision + 1, updatedAt: undone.updatedAt });
  await openExchange(page, live);
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  await review(dialog, proposal);
  await expect(dialog.getByRole('alert')).toContainText('no longer matches a live request');
});

test('requires complete writable incidence for assistant node removal and restores the reviewed graph with Undo', async ({ page, context }) => {
  const source = [
    'flowchart LR', ' A[Old relay]', ' B[Receiver]', ' C[Other service]',
    ' A intake@--> B', ' C returnEdge@--> A', ' B keep@--> C',
    ' linkStyle 0,1 stroke:#aaaaaa', ' linkStyle 2 stroke:#123456', '',
  ].join('\r\n');
  const scene = { ...createScene(), title: 'Incoming messages', visible: ['node:A', 'node:B', 'edge:id:intake'] };
  const live = await openProject(page, 'Node removal exchange', source, project => {
    project.storyboard = { version: 1, scenes: [scene], loop: false };
    project.design.elements['node:A'] = { fill: '#123456' };
  });
  const projectFile = live.getByRole('button', { name: 'Download v3 project' });
  const original = JSON.parse(await download(page, projectFile));
  const dialog = await openExchange(page, live);
  await context.setOffline(true);
  await dialog.getByLabel('Instruction').fill('Review removing the old relay and both related connections.');
  await dialog.getByRole('combobox', { name: 'Old relay', exact: true }).selectOption('writable');
  await dialog.getByRole('combobox', { name: 'Receiver', exact: true }).selectOption('context');
  await dialog.getByRole('checkbox', { name: 'Old relay to Receiver (intake)' }).check();
  await dialog.getByRole('checkbox', { name: 'Allow removal of one writable node and all its writable incident connections' }).check();
  const share = dialog.getByRole('button', { name: 'Review what will be shared' });
  await share.click();
  await expect(dialog.getByRole('alert')).toContainText('mark every incident connection writable');
  await dialog.getByRole('combobox', { name: 'Other service', exact: true }).selectOption('context');
  await share.click();
  await expect(dialog.getByRole('alert')).toContainText('mark every incident connection writable');
  await dialog.getByRole('checkbox', { name: 'Other service to Old relay (returnEdge)' }).check();
  await share.click();
  await expect(dialog.getByRole('list', { name: 'Nodes eligible for removal' }).getByRole('listitem')).toHaveText('Old relay');
  const request = JSON.parse(await download(page, dialog.getByRole('button', { name: 'Download request' })));
  const relay = request.graph.nodes.find((node: { label: string }) => node.label === 'Old relay');
  const incident = request.graph.edges.filter((edge: { sourceId: string; targetId: string }) => edge.sourceId === relay.id || edge.targetId === relay.id);
  const [first, second] = incident.map((edge: { id: string }) => edge.id);
  const unauthorized = request.graph.edges.find((edge: { id: string }) => edge.id !== first && edge.id !== second);
  expect(relay.incidentEdgesComplete).toBe(true);
  expect(request.scope.writableElementIds).toEqual([relay.id, first, second]);
  expect(request.allowedOperations).toContain('removeNode');
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  const operation = { op: 'removeNode', targetId: relay.id, incidentEdgeIds: [first, second], annotationPolicy: 'preserve-orphans' };
  const proposal = {
    schema: 'meridian-proposal/v1', id: crypto.randomUUID(), documentKind: 'mermaid', origin: 'ai',
    requestId: request.requestId, requestHash: await canonicalDigest('meridian-assist-request/v1', request), baseToken: request.baseToken,
    operations: [operation],
  };
  await review(dialog, { ...proposal, operations: [{ ...operation, incidentEdgeIds: [first, unauthorized.id] }] });
  await expect(dialog.getByRole('alert')).toContainText('Every incident connection must be inside the request’s writable scope');
  await review(dialog, { ...proposal, operations: [{ ...operation, incidentEdgeIds: [first] }] });
  await expect(dialog.getByRole('alert')).toContainText('Review all incident connections');
  await review(dialog, proposal);
  await expect(dialog.getByRole('img', { name: 'Diagram preview after proposed node removal' })).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Connections to remove' }).getByRole('listitem')).toHaveText([
    'Old relay to Receiver (intake)', 'Other service to Old relay (returnEdge)',
  ]);
  await expect(dialog.getByRole('region', { name: 'Retained annotations' })).toContainText('Incoming messages');
  await dialog.getByRole('button', { name: 'Apply reviewed node removal' }).click();
  await expect(dialog).toBeHidden();
  const removed = JSON.parse(await download(page, projectFile));
  expect(removed.source).toBe(source.replace('A[Old relay]', '').replace('A intake@--> B', '').replace('C returnEdge@--> A', '')
    .replace('linkStyle 0,1 stroke:#aaaaaa', '').replace('linkStyle 2 stroke:#123456', 'linkStyle 0 stroke:#123456'));
  expect(removed.identity.orphans).toContainEqual(expect.objectContaining({ formerElementId: relay.id, retained: expect.objectContaining({
    style: { fill: '#123456' }, sceneReferences: [{ sceneId: scene.id, field: 'visible', index: 0 }],
  }) }));
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = JSON.parse(await download(page, projectFile));
  expect(restored).toEqual({ ...original, revision: removed.revision + 1, updatedAt: restored.updatedAt });
});
