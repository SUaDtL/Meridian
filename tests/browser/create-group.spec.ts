import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

async function download(page: Page, dialog: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing group project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('reviews exact group members and boundary connections, preserves identities and restores exact source with Undo', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  A[First]\r\n  %% Keep between nodes\r\n  B[Second]\r\n  C[Last]\r\n  A inside@--> B\r\n  B crossing@-->|"Send"| C\r\n';
  const project = { ...createDocument(), title: 'Group a reviewed range', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Group a reviewed range' }).click();
  const live = page.getByRole('dialog', { name: 'Group a reviewed range' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Group a reviewed range' })).toBeVisible();
  const original = await download(page, live);
  await live.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await edit.getByLabel('Operation').selectOption('addGroup');
  await edit.getByLabel('Group label').fill('First two');
  await edit.getByRole('checkbox', { name: 'First (A)' }).check();
  await edit.getByRole('checkbox', { name: 'Last (C)' }).check();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  await expect(edit.getByRole('alert')).toContainText('Choose consecutive node declarations');
  await edit.getByRole('checkbox', { name: 'Last (C)' }).uncheck();
  await edit.getByRole('checkbox', { name: 'Second (B)' }).check();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Group impact' });
  await expect(impact.getByRole('list', { name: 'Connections crossing the group' })).toContainText('Send');
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const grouped = await download(page, live);
  expect(grouped.source).toBe(source.replace('  A[First]', '  subgraph m_g1 ["First two"]\r\n  A[First]').replace('  C[Last]', '  end\r\n  C[Last]'));
  expect(grouped.identity.elements).toEqual(expect.arrayContaining(original.identity.elements));
  expect(grouped.identity.elements).toContainEqual(expect.objectContaining({ elementKind: 'group', binding: { type: 'source-id', sourceId: 'm_g1' } }));
  await live.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  await expect(edit.getByRole('region', { name: 'Deletion impact' })).toContainText('Group container to remove');
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const flat = await download(page, live);
  expect(flat.source).toBe(original.source);
  expect(flat.identity.elements).toEqual(expect.arrayContaining(original.identity.elements));
  expect(flat.identity.elements).toContainEqual(expect.objectContaining({ elementKind: 'group', status: 'retired' }));
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const returned = await download(page, live);
  expect(returned.source).toBe(grouped.source);
  expect(returned.identity).toEqual(grouped.identity);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download(page, live);
  expect(restored.source).toBe(original.source);
  expect(restored.identity).toEqual(original.identity);
});

test('moves an outside declaration into a reviewed group and preserves exact project annotations and Undo', async ({ page }) => {
  const moved = '  B[Outside]\r\n';
  const source = '\uFEFFflowchart LR\r\n' + moved
    + '  subgraph Team [Review group]\r\n    A[Member]\r\n  end\r\n  C[Finish]\r\n  A local@--> B\r\n  B external@-->|"Send"| C\r\n  linkStyle 1 stroke:#123456\r\n';
  const project = { ...createDocument(), title: 'Move a node into review', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Move a node into review' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  await expect(live.getByRole('img', { name: 'Diagram preview for Move a node into review' })).toBeVisible();
  const original = await download(page, live);

  await live.getByRole('button', { name: 'Move node into group', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(edit.getByRole('button', { name: 'Apply change' })).toBeDisabled();
  const picker = edit.getByLabel('Node to move into Review group');
  await expect(picker.getByRole('option', { name: 'Member (A)' })).toHaveCount(0);
  await picker.selectOption({ label: 'Outside (B)' });
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Group move impact' });
  await expect(impact).toContainText('Outside (B) will join Review group.');
  await expect(impact.getByRole('list', { name: 'Connections retained' }).getByRole('listitem')).toHaveCount(2);
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await download(page, live);
  expect(applied).toEqual({
    ...original, revision: original.revision + 1, updatedAt: applied.updatedAt,
    source: source.replace(moved, '').replace('  end\r\n', moved + '  end\r\n'),
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download(page, live);
  expect(restored.source).toBe(original.source);
  expect(restored.identity).toEqual(original.identity);
});

test('reviews deleting one group with its full footprint and restores the exact snapshot with Undo', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  subgraph Team [Review group]\r\n    A[Input]\r\n    %% Keep this comment\r\n    B[Review]\r\n  end\r\n  C[Retain]\r\n  D[Finish]\r\n  A inner@--> B\r\n  B crossing@-->|"Send"| C\r\n  C retained@--> D\r\n  linkStyle 0,1,2 stroke:#123456\r\n';
  const scene = { ...createScene(), title: 'Original review', visible: ['node:A', 'edge:id:crossing', 'node:C'] };
  const project = { ...createDocument(), title: 'Delete a reviewed group', source,
    storyboard: { version: 1 as const, scenes: [scene], loop: false } };
  project.design.elements['node:A'] = { color: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Delete a reviewed group' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  await expect(live.getByRole('img', { name: 'Diagram preview for Delete a reviewed group' })).toBeVisible();
  const original = await download(page, live);
  await expect(live.getByRole('button', { name: 'Ungroup', exact: true })).toBeVisible();
  await live.getByRole('button', { name: 'Delete group and contents', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const footprint = edit.getByRole('region', { name: 'Group contents to delete' });
  await expect(footprint.getByRole('list', { name: 'Nodes to delete' }).getByRole('listitem')).toHaveText(['Input (A)', 'Review (B)']);
  const connections = footprint.getByRole('list', { name: 'Connections to delete' });
  await expect(connections.getByRole('listitem')).toHaveCount(2);
  await expect(connections).toContainText('crossing');
  await expect(edit.getByRole('button', { name: 'Apply change' })).toBeDisabled();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const retention = edit.getByRole('region', { name: 'Deletion impact' });
  await expect(retention).toContainText('2 scene references');
  await expect(retention).toContainText('Original review');
  await expect(retention).toContainText('Appearance settings for 1 removed element');
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const removed = await download(page, live);
  expect(removed.source).toBe(source.replace('  subgraph Team [Review group]\r\n', '')
    .replace('A[Input]', '').replace('B[Review]', '').replace('  end\r\n', '')
    .replace('A inner@--> B', '').replace('B crossing@-->|"Send"| C', '').replace('linkStyle 0,1,2', 'linkStyle 0'));
  expect(removed.identity.elements.filter((item: { status: string }) => item.status === 'resolved')).toEqual(
    original.identity.elements.filter((item: { binding: { sourceId: string } }) => ['C', 'D', 'retained'].includes(item.binding.sourceId)),
  );
  expect(removed.identity.orphans).toHaveLength(2);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download(page, live);
  expect(restored).toEqual({ ...original, revision: removed.revision + 1, updatedAt: restored.updatedAt });
});
