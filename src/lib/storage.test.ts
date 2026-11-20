import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, loadWorkspace, normalizeSource, parseProject, saveWorkspace } from './storage';
import type { StudioDocument } from '../types';

const STORAGE_KEY = 'meridian:v1';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() { return values.size; },
  };
}

function styledProject(): StudioDocument {
  const project = createDocument();
  return {
    ...project,
    title: 'Gateway to café',
    subtitle: 'A deliberately styled project',
    source: '%% Keep this comment\nflowchart LR\n  A["Café & source"] -->|requests| B[API]\n',
    settings: {
      ...project.settings,
      theme: 'porcelain',
      layout: 'elk',
      motion: 'flow',
      frame: '16:9',
      padding: 72,
    },
    nodeAccents: { A: '#167D68', B: '#abc' },
  };
}

describe('portable project files and local workspace', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('round trips source and presentation settings without changing their meaning', () => {
    const original = styledProject();
    const imported = parseProject(JSON.stringify(original));
    expect(imported).toEqual(original);
    expect(imported.source).toBe(original.source);
    expect(imported.id).toBe(original.id);

    const second = createDocument();
    expect(saveWorkspace([imported, second], second.id)).toEqual({ ok: true });
    expect(loadWorkspace()).toEqual({ documents: [imported, second], activeId: second.id });
  });

  it('does not share mutable settings between newly created documents', () => {
    const first = createDocument();
    const second = createDocument();
    first.settings.theme = 'ember';
    first.nodeAccents.A = '#abc';
    expect(second.id).not.toBe(first.id);
    expect(second.settings.theme).not.toBe('ember');
    expect(second.nodeAccents).toEqual({});
  });

  it.each([
    ['a future schema', { schema: 'meridian/v2' }],
    ['an unrelated file', { schema: 'other-app/v1' }],
    ['an unexpected version field', { version: 2 }],
  ])('rejects %s instead of silently coercing the document', (_label, patch) => {
    expect(() => parseProject(JSON.stringify({ ...styledProject(), ...patch }))).toThrow();
  });

  it('rejects malformed numeric settings and overlarge text at the import boundary', () => {
    const project = styledProject();
    const invalidProjects = [
      { ...project, settings: { ...project.settings, speed: 'fast' } },
      { ...project, settings: { ...project.settings, padding: -1 } },
      { ...project, settings: { ...project.settings, edgeWidth: Infinity } },
      { ...project, source: 'x'.repeat(100_001) },
      { ...project, title: 'x'.repeat(121) },
      { ...project, subtitle: 'x'.repeat(241) },
    ];
    for (const value of invalidProjects) {
      expect(() => parseProject(JSON.stringify(value))).toThrow();
    }
  });

  it('accepts only color values and rejects prototype keys without polluting objects', () => {
    const project = styledProject();
    const invalidAccents = [
      { A: 'url(https://example.invalid/pixel)' },
      { A: '#fff;display:none' },
      JSON.parse('{"__proto__":"#ffffff"}') as Record<string, string>,
      { constructor: '#ffffff' },
      { prototype: '#ffffff' },
    ];
    for (const nodeAccents of invalidAccents) {
      expect(() => parseProject(JSON.stringify({ ...project, nodeAccents }))).toThrow();
    }
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, 'A')).toBe(false);
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  it.each(['{not-json', '{"version":999,"documents":[],"activeId":null}'])('warns about unreadable stored data and leaves its bytes untouched', raw => {
    storage.values.set(STORAGE_KEY, raw);
    const result = loadWorkspace();
    expect(result.documents).toEqual([]);
    expect(result.activeId).toBeNull();
    expect(result.warning).toMatch(/could not be loaded/i);
    expect(storage.values.get(STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('rejects duplicate project identities on both save and load without replacing good data', () => {
    const project = styledProject();
    expect(saveWorkspace([project], project.id).ok).toBe(true);
    const before = storage.values.get(STORAGE_KEY);
    storage.setItem.mockClear();

    const saved = saveWorkspace([project, { ...project, title: 'A conflicting copy' }], project.id);
    expect(saved.ok).toBe(false);
    expect(saved.error).toMatch(/unique/i);
    expect(storage.values.get(STORAGE_KEY)).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled();

    storage.values.set(STORAGE_KEY, JSON.stringify({ version: 1, documents: [project, project], activeId: project.id }));
    const loaded = loadWorkspace();
    expect(loaded.documents).toEqual([]);
    expect(loaded.warning).toMatch(/duplicate/i);
  });

  it('reports blocked storage and failed writes instead of claiming the workspace was saved', () => {
    storage.getItem.mockImplementation(() => { throw new DOMException('Storage access denied', 'SecurityError'); });
    expect(loadWorkspace().warning).toMatch(/could not be loaded/i);

    storage.setItem.mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    const project = styledProject();
    expect(saveWorkspace([project], project.id)).toEqual({
      ok: false,
      error: expect.stringMatching(/Download a project file/i),
    });
    expect(storage.values.size).toBe(0);
  });

  it('enforces the workspace capacity without discarding the existing project list', () => {
    const projects = Array.from({ length: 50 }, () => createDocument());
    expect(saveWorkspace(projects, projects[0].id).ok).toBe(true);
    const before = storage.values.get(STORAGE_KEY);
    expect(saveWorkspace([...projects, createDocument()], projects[0].id).ok).toBe(false);
    expect(storage.values.get(STORAGE_KEY)).toBe(before);
    expect(loadWorkspace().documents).toHaveLength(50);
  });

  it('recovers an obsolete active selection while retaining every valid project', () => {
    const projects = [styledProject(), createDocument()];
    storage.values.set(STORAGE_KEY, JSON.stringify({ version: 1, documents: projects, activeId: 'removed-project' }));
    const loaded = loadWorkspace();
    expect(loaded.documents).toEqual(projects);
    expect(loaded.activeId).toBe(projects[0].id);
    expect(loaded.warning).toBeUndefined();
  });

  it('unwraps only one complete Mermaid fence and preserves other source text', () => {
    const source = 'flowchart LR\n  A --> B';
    expect(normalizeSource(`\n\`\`\`mermaid\n${source}\n\`\`\`\n`)).toBe(source);
    const ordinary = `${source}\n`;
    expect(normalizeSource(ordinary)).toBe(ordinary);
    const partial = `\`\`\`mermaid\n${source}`;
    expect(normalizeSource(partial)).toBe(partial);
    const anotherLanguage = `\`\`\`javascript\n${source}\n\`\`\``;
    expect(normalizeSource(anotherLanguage)).toBe(anotherLanguage);
    const multiple = `\`\`\`mermaid\r\n${source}\r\n\`\`\`\r\n\r\n\`\`\`mermaid\r\n${source}\r\n\`\`\``;
    expect(normalizeSource(multiple)).toBe(multiple);
  });
});
