import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const fixtures = [
  {
    adapter: 'JSON Schema', entry: 'Import JSON Schema', dialog: 'JSON Schema relationships', choose: 'JSON Schema files',
    read: 'Read schema facts', preview: 'Preview schema diagram', create: 'Create schema project',
    proposed: 'Proposed JSON Schema diagram', title: 'JSON Schema relationships', first: 'previous-record', second: 'current-record',
    provenance: '/properties/current-record',
    body: (name: string) => ({ type: 'object', properties: { [name]: { type: 'string' } } }),
  },
  {
    adapter: 'Terraform', entry: 'Import Terraform JSON', dialog: 'Terraform inventory', choose: 'Terraform JSON file',
    read: 'Read Terraform facts', preview: 'Preview inventory', create: 'Create inventory project',
    proposed: 'Proposed Terraform inventory', title: 'Terraform planned resource inventory', first: 'aws_a.previous', second: 'aws_a.current',
    provenance: '/planned_values/root_module/resources/0',
    body: (name: string) => ({ format_version: '1.1', planned_values: { root_module: { resources: [{ address: name }] } } }),
  },
] as const;

async function download(page: Page, project: Locator) {
  await expect(project.getByText('Saved in this browser.')).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), project.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing engineering project download.');
  return readFile(path, 'utf8');
}

for (const fixture of fixtures) {
  test(`creates a new ${fixture.adapter} project on reimport and preserves the manually edited original`, async ({ page }) => {
    await page.goto('/');
    async function importProject(label: string) {
      await page.getByRole('button', { name: 'Build with guidance' }).click();
      await page.getByRole('button', { name: 'Engineering file' }).click();
      await page.getByRole('button', { name: fixture.entry }).click();
      const wizard = page.getByRole('dialog', { name: fixture.dialog });
      await wizard.getByLabel(fixture.choose).setInputFiles({
        name: 'reimport.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.body(label))),
      });
      await wizard.getByRole('button', { name: fixture.read }).click();
      await wizard.getByRole('checkbox', { name: label, exact: true }).check();
      await wizard.getByRole('button', { name: fixture.preview }).click();
      await expect(wizard.getByRole('img', { name: fixture.proposed })).toBeVisible();
      await wizard.getByRole('button', { name: fixture.create }).click();
      const live = page.getByRole('dialog', { name: fixture.title });
      await expect(live.getByRole('img', { name: `Diagram preview for ${fixture.title}` })).toBeVisible();
      return live;
    }

    const original = await importProject(fixture.first);
    const initial = JSON.parse(await download(page, original));
    const note = '  %% Retain this authored note\n';
    await original.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
    const source = page.getByRole('dialog', { name: 'Edit Mermaid source', exact: true });
    await source.getByRole('textbox', { name: 'Mermaid source' }).fill(initial.source + note);
    await source.getByRole('button', { name: 'Preview source' }).click();
    await source.getByRole('button', { name: 'Apply source' }).click();
    await expect(original.getByText('Saved in this browser.')).toBeVisible();
    await original.getByRole('button', { name: 'Edit heading' }).click();
    const heading = page.getByRole('dialog', { name: 'Edit heading', exact: true });
    const editedTitle = `Edited ${fixture.adapter} original`;
    await heading.getByRole('textbox', { name: 'Title', exact: true }).fill(editedTitle);
    await heading.getByRole('button', { name: 'Apply heading' }).click();
    const edited = page.getByRole('dialog', { name: editedTitle });
    const authored = await download(page, edited);
    expect(JSON.parse(authored)).toMatchObject({ source: initial.source + note, revision: initial.revision + 2 });
    await edited.getByRole('button', { name: 'Back to v3 projects' }).click();
    const library = page.getByRole('dialog', { name: 'Project migration and recovery' });
    await library.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('dialog', { name: 'Your projects' }).getByRole('button', { name: 'Close dialog' }).click();

    const updated = await importProject(fixture.second);
    const fresh = JSON.parse(await download(page, updated));
    expect(fresh.id).not.toBe(initial.id);
    expect(fresh.revision).toBe(0);
    expect(fresh.source).toContain(fixture.second);
    expect(fresh.source).not.toContain(fixture.first);
    expect(fresh.source).not.toContain(note);
    expect(fresh.provenance).toContainEqual(expect.objectContaining({ virtualPath: 'reimport.json', pointer: fixture.provenance }));
    await updated.getByRole('button', { name: 'Back to v3 projects' }).click();
    await library.getByRole('button', { name: `Open v3 project ${editedTitle}` }).click();
    expect(await download(page, edited)).toBe(authored);
  });
}
