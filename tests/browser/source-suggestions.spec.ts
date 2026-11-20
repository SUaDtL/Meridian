import { expect, test } from '@playwright/test';

test('completes Mermaid source only at known statement positions and keeps one app-history action', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start from scratch', exact: true }).click();
  const editor = page.locator('.cm-content');
  const suggestions = page.locator('.cm-editor').getByRole('listbox');
  await editor.fill('flo');
  await editor.press('Control+Space');
  await suggestions.getByRole('option', { name: /flowchart/ }).click();
  await expect(editor).toHaveText('flowchart LR');
  await editor.press('Control+z');
  await expect(editor).toHaveText('flo');
  const declarations = 'flowchart LR\n  alpha[Client]\n  beta[Worker]\n';
  await editor.fill(declarations + '  alpha ready@--> be');
  await editor.press('Control+End');
  await editor.press('Control+Space');
  await expect(suggestions.getByRole('option', { name: /beta.*Worker/ })).toBeVisible();
  await suggestions.getByRole('option', { name: /beta.*Worker/ }).click();
  await expect(editor).toContainText('alpha ready@--> beta');
  await editor.press('Control+z');
  await expect(editor).toContainText('alpha ready@--> be');
  await expect(editor).not.toContainText('alpha ready@--> beta');
  for (const source of [declarations + '  %% alpha ready@--> be', declarations + '  gamma["alpha ready@--> be', declarations + '  unknown ready@--> be']) {
    await editor.fill(source);
    await editor.press('Control+End');
    await editor.press('Control+Space');
    await expect(suggestions).toHaveCount(0);
  }
});
