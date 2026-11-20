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
  await relationships.getByRole('option', { name: /audit · Line 5/ }).click();
  await outline.getByRole('button', { name: 'Jump to source' }).click();
  await expect(outline).toHaveCount(0);
  const marked = live.locator('mark');
  await expect(marked).toHaveText('A audit@-->|"Sends"| B');
  await expect(marked).toBeFocused();
  expect(await live.locator('pre').textContent()).toBe(source);

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await expect(outline.getByRole('status')).toHaveText('1 selected · 1 hidden');
  await outline.getByRole('treeitem', { name: /Result/ }).click();
  await tree.press('F2');
  const editor = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(editor.getByRole('combobox', { name: 'Node to rename' }).locator('option:checked')).toHaveText('Result (B)');
  await expect(editor.getByRole('button', { name: 'Apply change' })).toBeDisabled();
});

test('collapsing a verified group hides its selected member and never guesses a source span', async ({ page }) => {
  const source = 'flowchart LR\n  subgraph cluster [Team boundary]\n    A[First system]\n  end\n  B[Second system]\n  A --> B\n';
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
  await expect(outline.getByRole('button', { name: 'Jump to source' })).toBeDisabled();
  await tree.press('ArrowLeft');
  await tree.press('ArrowLeft');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(child).toHaveCount(0);
  await expect(outline.getByRole('status')).toHaveText('1 selected · 1 hidden');
  await tree.press('ArrowRight');
  await expect(child).toHaveAttribute('aria-selected', 'true');
  await expect(outline.getByRole('status')).toHaveText('1 selected · 0 hidden');
});
