import { expect, test, vi } from 'vitest';
import { projectBaseToken } from './base-token';
import fixture from './fixtures/example-project.json';
import { openStoredProjectEditor } from './project-editor';
import { validateMermaidProject } from './validate-mermaid-project';
import { readWorkspaceProject, writeWorkspaceProject, type StoredProject } from '../persistence/workspace-db';

const fixtureRecipe = vi.hoisted(() => ({ changedPadding: undefined as number | undefined }));

vi.mock('./design-recipes', async original => {
  const recipeModule = await original<typeof import('./design-recipes')>();
  const { readDesignRecipe, buildDesignRecipeCandidate } = recipeModule;
  function currentRecipe(id: Parameters<typeof readDesignRecipe>[0]) {
    const recipe = readDesignRecipe(id);
    const padding = fixtureRecipe.changedPadding;
    return padding === undefined ? recipe : { ...recipe, settings: { ...recipe.settings, padding } };
  }
  return {
    ...recipeModule,
    readDesignRecipe: currentRecipe,
    buildDesignRecipeCandidate(...args: Parameters<typeof buildDesignRecipeCandidate>) {
      const candidate = buildDesignRecipeCandidate(...args);
      const recipe = currentRecipe(args[1]);
      return { ...candidate, recipe, document: {
        ...candidate.document, settings: { ...candidate.document.settings, padding: recipe.settings.padding },
      } };
    },
  };
});

vi.mock(import('./project-render'), async original => ({
  ...await original(), renderMermaidProject: vi.fn<typeof import('./project-render').renderMermaidProject>(async document => ({
    result: { svg: '<svg/>', diagramType: 'flowchart', nodes: [], edgeCount: 0, width: 1, height: 1, warnings: [] },
    targetTable: { schema: 'meridian-targets/v1', baseToken: await projectBaseToken(document), renderFingerprint: 'fixture-frame', targets: [] },
  })),
}));

vi.mock(import('../persistence/workspace-db'), async original => ({
  ...await original(), readWorkspaceProject: vi.fn(), writeWorkspaceProject: vi.fn(),
}));

test('refuses a changed recipe with the same ID and version until the new content has been reviewed', async () => {
  const document = validateMermaidProject(structuredClone(fixture));
  const { stateDigest } = await projectBaseToken(document);
  const anchor = { storageGeneration: crypto.randomUUID(), stateDigest };
  const readMermaid: (db: IDBDatabase, id: string) => Promise<StoredProject | undefined> = readWorkspaceProject;
  vi.mocked(readMermaid).mockResolvedValue({ id: document.id, document, anchor });
  vi.mocked(writeWorkspaceProject).mockImplementation(async (_db, next) => ({
    ...anchor, stateDigest: (await projectBaseToken(next)).stateDigest,
  }));
  const editor = await openStoredProjectEditor({} as IDBDatabase, document.id, vi.fn());
  try {
    const original = await editor.prepareDesign('presentation', { kind: 'diagram' });
    const reviewed = editor.readDesignPreview(original);
    expect(reviewed?.recipe).toMatchObject({ id: 'presentation', version: '1.0.0', settings: { padding: 64 } });

    fixtureRecipe.changedPadding = 80;
    expect(editor.applyDesign(original)).toBe('stale');
    expect(editor.snapshot()).toBe(document);
    expect(editor.canUndo()).toBe(false);
    expect(writeWorkspaceProject).not.toHaveBeenCalled();

    const fresh = await editor.prepareDesign('presentation', { kind: 'diagram' });
    expect(editor.readDesignPreview(fresh)?.recipe).toMatchObject({ id: 'presentation', version: '1.0.0', settings: { padding: 80 } });
    expect(editor.applyDesign(fresh)).toBe('applied');
    await editor.flush();
    expect(editor.snapshot().source).toBe(document.source);
    expect(editor.snapshot().settings.padding).toBe(80);
    expect(editor.canUndo()).toBe(true);
    expect(writeWorkspaceProject).toHaveBeenCalledTimes(1);
  } finally {
    fixtureRecipe.changedPadding = undefined;
    editor.close();
  }
});
