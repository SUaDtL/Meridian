import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/example-project.json';
import { parseMermaidProject, validateMermaidProject } from './validate-mermaid-project';
import { captureProjectWrite } from '../persistence/workspace-db';
import { serializeProject } from '../storage';
import type { MermaidProjectV3 } from './mermaid-project';

const project = (): MermaidProjectV3 => structuredClone(validateMermaidProject(fixture));
const getText = (edit: (document: MermaidProjectV3) => void) => {
  const value = project();
  edit(value);
  return serializeProject(value);
};

describe('v3 Mermaid project validation', () => {
  it('reopens the authoritative fixture and preserves escaped source characters', () => {
    const value = project();
    value.source = '\uFEFFflowchart LR\r\nA[\uD800]\r\n';
    expect(parseMermaidProject(serializeProject(value))).toEqual(value);
  });

  it.each([
    ['duplicate identity', (document: MermaidProjectV3) => {
      document.identity.elements = [...document.identity.elements, document.identity.elements[0]];
    }],
    ['contradictory bindings', (document: MermaidProjectV3) => {
      document.identity.elements = [...document.identity.elements, { ...document.identity.elements[0], id: crypto.randomUUID() }];
    }],
    ['wrong binding kind', (document: MermaidProjectV3) => {
      const node = document.identity.elements[0];
      Object.assign(node, { elementKind: 'edge' });
    }],
    ['missing role target', (document: MermaidProjectV3) => { document.roles[0].elementId = crypto.randomUUID(); }],
    ['duplicate role', (document: MermaidProjectV3) => { document.roles.push(document.roles[0]); }],
    ['invalid calendar time', (document: MermaidProjectV3) => { document.updatedAt = '2026-02-30T12:00:00Z'; }],
    ['unknown data', (document: MermaidProjectV3) => { Object.assign(document, { rejectedPayload: true }); }],
  ])('rejects %s', (_, edit) => {
    expect(() => parseMermaidProject(getText(edit))).toThrow();
  });

  it('uses typed connector kinds for scene flow and bounds headings by UTF-16', () => {
    const value = project();
    const node = value.identity.elements[0];
    value.storyboard.scenes.push({
      id: 'scene', title: 'A scene', duration: 3, transition: 1, easing: 'linear',
      visible: null, reveal: 'together', highlight: [], flow: [node.id], camera: { mode: 'fit', padding: 32, keys: [] },
    });
    expect(() => validateMermaidProject(value)).toThrow('references');
    value.storyboard.scenes[0].flow = [];
    value.title = '🧭'.repeat(61);
    expect(() => validateMermaidProject(value)).toThrow('file limits');
  });

  it('refuses repeated keys before materialization and invalid writes before allocating an anchor', async () => {
    const value = project();
    expect(() => parseMermaidProject(serializeProject(value).replace('"revision": 7', '"revision": 7, "revision": 8'))).toThrow('repeated');
    Object.assign(value, { advancedProviderConfig: {} });
    const allocate = vi.spyOn(crypto, 'randomUUID');
    try {
      await expect(captureProjectWrite(value)).rejects.toThrow('valid Meridian v3');
      expect(allocate).not.toHaveBeenCalled();
    } finally {
      allocate.mockRestore();
    }
  });
});
