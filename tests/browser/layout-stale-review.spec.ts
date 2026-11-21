import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function openSavedProject(page: Page, title: string, migrate = false) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  if (migrate) await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: `Open v3 project ${title}` }).click();
  const live = page.getByRole('dialog', { name: title, exact: true });
  await expect(live.getByRole('img', { name: `Diagram preview for ${title}` })).toBeVisible();
  return live;
}

async function downloadProject(page: Page, title: string) {
  const live = page.getByRole('dialog', { name: title, exact: true });
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing reviewed layout project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('refuses a stale layout before committing and restores its choices for explicit review', async ({ page, context }) => {
  const source = '\uFEFFflowchart LR\r\n A[Client]\r\n B[Worker]\r\n A jobs@--> B\r\n';
  const project = { ...createDocument(), title: 'Layout across tabs', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  const live = await openSavedProject(page, project.title, true);
  await live.getByRole('button', { name: 'Compare layouts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Compare layouts', exact: true });
  const compact = dialog.getByRole('group', { name: 'Layout alternatives' }).getByRole('button', { name: /^Compact/ });
  const direction = dialog.getByRole('combobox', { name: 'Source direction' });
  const apply = dialog.getByRole('button', { name: 'Apply Compact' });
  await compact.click();
  await direction.selectOption('TB');
  await dialog.getByRole('button', { name: 'Preview Compact' }).click();
  await expect(apply).toBeEnabled();

  const other = await context.newPage();
  try {
    const concurrent = await openSavedProject(other, project.title);
    await concurrent.getByRole('button', { name: 'Edit heading' }).click();
    const title = other.getByRole('dialog', { name: 'Edit heading' });
    await title.getByRole('textbox', { name: 'Subtitle' }).fill('Saved change from the other tab');
    await title.getByRole('button', { name: 'Apply heading' }).click();
    const saved = await downloadProject(other, project.title);
    await apply.click();
    await expect(dialog.getByRole('alert')).toHaveText('The saved project changed. Refresh the diagram to review this layout again.');
    await expect(apply).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Preview Compact' })).toBeDisabled();
    expect(saved.source).toBe(source);

    await dialog.getByRole('button', { name: 'Refresh saved diagram' }).click();
    await expect(compact).toHaveAttribute('aria-pressed', 'true');
    await expect(direction).toHaveValue('TB');
    await expect(apply).toBeDisabled();
    await dialog.getByRole('button', { name: 'Preview Compact' }).click();
    await apply.click();
    const accepted = await downloadProject(page, project.title);
    expect(accepted.source).toBe(source.replace('flowchart LR', 'flowchart TB'));
    expect(accepted.subtitle).toBe(saved.subtitle);
    expect(accepted.identity).toEqual(saved.identity);
    expect(accepted.revision).toBe(saved.revision + 1);
    await live.getByRole('button', { name: 'Undo', exact: true }).click();
    const restored = await downloadProject(page, project.title);
    expect(restored).toEqual({ ...saved, revision: accepted.revision + 1, updatedAt: restored.updatedAt });
  } finally { await other.close(); }
});
