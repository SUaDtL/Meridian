import { expect, test } from '@playwright/test';

test('command search reports unavailable actions and opens existing tools by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start from scratch', exact: true }).click();
  const commands = page.getByRole('button', { name: 'Commands', exact: true });
  await commands.focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Commands' });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await expect(search).toBeFocused();
  await search.fill('Undo');
  const undo = palette.getByRole('option', { name: /Undo/ });
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(undo).toContainText('There are no changes to undo.');
  await search.press('Enter');
  await expect(palette).toBeVisible();
  await search.fill('unlikely command');
  await expect(palette.getByText(/No commands match/)).toBeVisible();
  await search.press('Escape');
  await expect(commands).toBeFocused();

  await commands.click();
  await search.fill('theme');
  await expect(palette.getByRole('option', { name: /Open design options/ })).toBeVisible();
  await search.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Design', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await commands.click();
  await expect(palette.getByRole('option').first()).toContainText('Open design options');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:recent-commands') ?? '[]'))).toEqual(['open-design']);
  await search.fill('mermaid source');
  await search.press('ArrowDown');
  await expect(palette.getByRole('option', { name: /Show Mermaid source/ })).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('a v3 Connect command uses the same reviewed edit and durable save as the flowchart tool', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const guide = page.getByRole('dialog', { name: 'Build with guidance' });
  await guide.getByLabel('Project title').fill('Command route');
  await guide.getByLabel('Put one step on each line').fill('First\nSecond');
  await guide.getByRole('button', { name: 'Review connections' }).click();
  await guide.getByRole('button', { name: 'Preview process' }).click();
  await guide.getByRole('button', { name: 'Create process' }).click();
  await page.getByRole('button', { name: 'Authoring tools', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'Command route' });
  await expect(project.getByRole('img', { name: 'Diagram preview for Command route' })).toBeVisible();
  await project.getByRole('button', { name: 'Commands', exact: true }).click();
  const palette = page.getByRole('dialog', { name: 'Commands' });
  const search = palette.getByRole('combobox');
  await search.fill('add edge');
  await expect(palette.getByRole('option', { name: /Connect nodes/ })).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(editor.getByLabel('Operation')).toHaveValue('addEdge');
  await editor.getByRole('combobox', { name: 'From', exact: true }).selectOption({ label: 'Second (m_n2)' });
  await editor.getByRole('combobox', { name: 'To', exact: true }).selectOption({ label: 'First (m_n1)' });
  await editor.getByLabel('Connection label (optional)').fill('Return');
  const apply = editor.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeDisabled();
  await editor.getByRole('button', { name: 'Preview change' }).click();
  await expect(editor.getByRole('img', { name: 'Proposed diagram' })).toBeVisible();
  await apply.click();
  await expect(project.getByText('Saved in this browser.')).toBeVisible();
  await project.getByRole('button', { name: 'Commands', exact: true }).focus();
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox').fill('open source');
  await palette.getByRole('combobox').press('Enter');
  await expect(project.locator('pre')).toContainText('m_n2 m_e2@-->|"Return"| m_n1');
});

test.describe('command search on touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('opens the normal export dialog without a keyboard shortcut', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start from scratch', exact: true }).tap();
    await page.getByRole('button', { name: 'Commands', exact: true }).tap();
    const palette = page.getByRole('dialog', { name: 'Commands' });
    await palette.getByRole('combobox').fill('export');
    await palette.getByRole('option', { name: /Export diagram/ }).tap();
    await expect(page.getByRole('dialog', { name: 'Take your diagram with you.' })).toBeVisible();
    await expect(palette).toHaveCount(0);
  });
});
