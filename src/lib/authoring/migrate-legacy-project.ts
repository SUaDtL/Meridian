import type { StudioDocument } from '../../types';
import type { ElementStyle } from '../../types/design';
import { colorToHex, type FlowModel } from '../design';
import { flowchartModelFor, renderDiagram } from '../render';
import { fitsProjectFile, serializeProject } from '../storage';
import { observeFlowchartIdentities, type ObservedIdentity } from './identity-observation';
import { elementUuidPattern, MAX_RETAINED_IDENTITY_RECORDS, reconcileIdentities, sourceBindingKey, type IdentityRecord } from './identities';
import type { MermaidProjectV3, OrphanAnnotation, OrphanSceneReference } from './mermaid-project';

export type LegacySourceObservation =
  | { status: 'verified'; model: FlowModel }
  | { status: 'unsupported' }
  | { status: 'invalid' };

export type MigrationOutcome =
  | { status: 'migrated'; document: MermaidProjectV3 }
  | { status: 'recovery'; reason: 'source' | 'identity' | 'annotations' | 'metadata' | 'size'; document: StudioDocument };

const implicitLegacyKey = /^(edge:[^:]+:[^:]+:[a-z0-9]+):(\d+)$/;
const unpairedSurrogate = /[\uD800-\uDFFF]/u;
const maxReferencesPerOrphan = 100;

type LegacyNote = {
  style?: ElementStyle;
  references: OrphanSceneReference[];
};

/** Preflight migration without writing either the old or the new workspace. */
export async function migrateLegacyProject(
  legacy: StudioDocument,
  source: LegacySourceObservation,
  newId: () => string = () => crypto.randomUUID(),
): Promise<MigrationOutcome> {
  const recovery = (reason: Extract<MigrationOutcome, { status: 'recovery' }>['reason']): MigrationOutcome =>
    ({ status: 'recovery', reason, document: legacy });
  if (source.status === 'invalid') return recovery('source');

  const scenes = legacy.storyboard?.scenes ?? [];
  if ([legacy.title, legacy.subtitle, ...scenes.map(scene => scene.title)].some(value => unpairedSurrogate.test(value))) {
    return recovery('metadata');
  }

  const notes = new Map<string, LegacyNote>();
  for (const [key, style] of Object.entries(legacy.design.elements)) {
    if (Object.keys(style).length) notes.set(key, { style: { ...style }, references: [] });
  }
  for (const [sourceId, accent] of Object.entries(legacy.nodeAccents)) {
    const key = `node:${sourceId}`;
    const previous = notes.get(key);
    const fill = colorToHex(accent);
    if (fill) notes.set(key, { style: { fill, ...previous?.style }, references: [] });
  }
  for (const scene of scenes) {
    const fields = { visible: scene.visible ?? [], highlight: scene.highlight, flow: scene.flow, camera: scene.camera.keys };
    for (const field of ['visible', 'highlight', 'flow', 'camera'] as const) {
      fields[field].forEach((key, index) => {
        let note = notes.get(key);
        if (!note) notes.set(key, note = { references: [] });
        note.references.push({ sceneId: scene.id, field, index });
      });
    }
  }

  const usedIds = new Set<string>();
  const allocate = () => {
    const id = newId();
    if (!elementUuidPattern.test(id) || usedIds.has(id)) throw new Error('Could not allocate a unique migration ID.');
    usedIds.add(id);
    return id;
  };
  const id = elementUuidPattern.test(legacy.id) ? legacy.id : allocate();
  usedIds.add(id);

  let observed: ObservedIdentity[];
  let registry: readonly IdentityRecord[];
  try {
    observed = source.status === 'verified' ? await observeFlowchartIdentities(source.model) : [];
    if (observed.some(row => {
      const binding = row.binding;
      return binding.sourceId.length > 200 || unpairedSurrogate.test(binding.sourceId)
        || (binding.type === 'legacy-edge' && (binding.targetId.length > 200 || unpairedSurrogate.test(binding.targetId)));
    })) return recovery('identity');
    registry = reconcileIdentities([], observed, new Set(), 0, allocate);
  } catch {
    return recovery('identity');
  }
  const registryByBinding = new Map(registry.map(record => [sourceBindingKey(record), record]));
  const observationByLegacyKey = new Map(observed.map(row => [row.legacyKey, row]));
  const ambiguousLegacyPrefixes = new Set<string>();
  // v2 persisted an ordinal within an endpoint/label-hash bucket. Any
  // nonzero ordinal is evidence that even the first key may be ambiguous.
  for (const key of [...observationByLegacyKey.keys(), ...notes.keys()]) {
    const entry = implicitLegacyKey.exec(key);
    if (entry && entry[2] !== '0') ambiguousLegacyPrefixes.add(entry[1]);
  }

  const elements: Record<string, ElementStyle> = {};
  const targetIds = new Map<string, string>();
  const orphans: OrphanAnnotation[] = [];
  for (const [key, note] of notes) {
    if (key.length > 1000 || unpairedSurrogate.test(key)) return recovery('metadata');
    const seen = observationByLegacyKey.get(key);
    const resolved = seen && registryByBinding.get(sourceBindingKey(seen));
    const ambiguous = ambiguousLegacyPrefixes.has(implicitLegacyKey.exec(key)?.[1] ?? '') || (seen && !resolved);
    if (resolved && !ambiguous) {
      targetIds.set(key, resolved.id);
      if (note.style) elements[resolved.id] = note.style;
      continue;
    }
    const reason = source.status === 'unsupported' ? 'unsupported' : ambiguous ? 'ambiguous' : 'missing';
    // Preserve each slot and its original index, including repeated references
    // to the same old key in different scenes or fields.
    const chunks = Math.max(1, Math.ceil(note.references.length / maxReferencesPerOrphan));
    if (orphans.length + chunks > MAX_RETAINED_IDENTITY_RECORDS) return recovery('annotations');
    for (let offset = 0; offset < chunks; offset++) {
      const retained: OrphanAnnotation['retained'] = {};
      if (offset === 0 && note.style) retained.style = note.style;
      const references = note.references.slice(offset * maxReferencesPerOrphan, (offset + 1) * maxReferencesPerOrphan);
      if (references.length) retained.sceneReferences = references;
      orphans.push({ id: allocate(), formerElementId: null, legacyKey: key, reason, retained });
    }
  }

  const remap = (keys: string[]) => keys.flatMap(key => {
    const target = targetIds.get(key);
    return target === undefined ? [] : [target];
  });
  const migrated: MermaidProjectV3 = {
    schema: 'meridian/v3', documentKind: 'mermaid', id, revision: 0,
    title: legacy.title, subtitle: legacy.subtitle, updatedAt: legacy.updatedAt, source: legacy.source,
    settings: { ...legacy.settings },
    design: { preset: legacy.design.preset, elements, recipe: null, applyRoleShapes: false, recipeElements: {} },
    identity: { version: 1, elements: registry, orphans },
    roles: [], componentInstances: [], provenance: [],
    storyboard: {
      version: 2, loop: legacy.storyboard?.loop ?? false,
      scenes: scenes.map(scene => ({
        ...scene,
        visible: scene.visible === null ? null : remap(scene.visible),
        highlight: remap(scene.highlight), flow: remap(scene.flow),
        camera: { ...scene.camera, keys: remap(scene.camera.keys) },
      })),
    },
  };
  return fitsProjectFile(serializeProject(migrated)) ? { status: 'migrated', document: migrated } : recovery('size');
}

/** Obtain migration evidence from the serialized renderer for this exact project. */
export async function inspectLegacyProject(legacy: StudioDocument, signal?: AbortSignal): Promise<MigrationOutcome> {
  signal?.throwIfAborted();
  if (!legacy.source.trim()) return migrateLegacyProject(legacy, { status: 'unsupported' });

  let observation: LegacySourceObservation;
  try {
    const render = await renderDiagram(legacy.source, legacy.settings, legacy.nodeAccents, legacy.design, { signal });
    const model = flowchartModelFor(render);
    observation = model ? { status: 'verified', model } : { status: 'unsupported' };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    observation = { status: 'invalid' };
  }
  const result = await migrateLegacyProject(legacy, observation);
  signal?.throwIfAborted();
  return result;
}
