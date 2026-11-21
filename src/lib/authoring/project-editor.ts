import type { StoryScene } from '../../types/storyboard';
import { createProjectSaveQueue, type ProjectSaveState } from '../persistence/project-save-queue';
import { readPendingAssist } from '../persistence/pending-assist';
import { readWorkspaceProject, writeWorkspaceProject, type SavedAnchor } from '../persistence/workspace-db';
import { serializeProject } from '../storage';
import { createScene } from '../storyboard';
import { authorizeAssistEdit, parseAssistSuggestion, type PendingAssistRequest } from './assist-exchange';
import { canonicalDigest, canonicalJson, projectBaseToken, sameBaseToken, type BaseToken } from './base-token';
import { buildBulkTextCandidate, bulkTextSelection, verifyBulkTextCandidate } from './bulk-text';
import type { ComponentDefinition } from './component-definition';
import type { PortAssignment } from './component-insertion';
import { buildContrastCandidate, measureTargetContrast, type ContrastKind } from './contrast-fix';
import { buildDesignRecipeCandidate, buildScopedDesignRecipe, readDesignRecipe, verifyPresentationRoleShapes, verifyScopedDesign, type DesignRecipeId, type DesignScope } from './design-recipes';
import { buildDesignReset, measuredResetValues, type DesignReset } from './design-reset';
import { suggestGroupScenes, type GroupStoryOptions } from './group-story';
import { buildLayoutCandidate, readLayoutAlternative, type LayoutIntent } from './layout-alternatives';
import { prepareManualSource } from './manual-source';
import type { MermaidProjectV3 } from './mermaid-project';
import { suggestPathScene, type PathStoryOptions } from './path-story';
import { prepareFlowchartCandidate, type NativeFlowchartEdit } from './project-flowchart';
import { renderMermaidProject, verifiedTopology } from './project-render';
import { createHeadingProposalLane, type ReadyProposal } from './proposals';
import type { ViewingProfile } from './readability';
import type { ElementRemovalImpact } from './retire-elements';
import { SourceDiagnosticError } from './source-diagnostics';
import { resolveManualStoryScope } from './story-targets';
import { validateMermaidProject } from './validate-mermaid-project';

const historyByteLimit = 8 * 1024 * 1024;
const historyEntryLimit = 50;
export const orphanCleanupLimit = 500;
const encoder = new TextEncoder();
export type StoryDestination = 'append' | 'replace' | 'duplicate';
export type StorySceneDetails = Pick<StoryScene, 'title' | 'duration' | 'transition' | 'easing' | 'reveal'> & { padding: number };
export type StorySceneOrderEdit = 'earlier' | 'later' | 'remove';

function freezeSnapshot<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

const headingLane = createHeadingProposalLane<MermaidProjectV3>((draft, base) =>
  draft === base.document ? draft : freezeSnapshot(validateMermaidProject({ ...draft, revision: base.revision + 1 })));

function historyEntry(document: MermaidProjectV3) {
  return { document, bytes: encoder.encode(serializeProject(document)).byteLength };
}

/** Open the verified durable revision and edit through prepared snapshots. */
export async function openStoredProjectEditor(db: IDBDatabase, id: string, notify: (state: ProjectSaveState) => void) {
  const stored = await readWorkspaceProject(db, id);
  if (!stored) throw new Error('The saved Meridian project could not be found.');
  let current = historyEntry(freezeSnapshot(stored.document));
  const queue = createProjectSaveQueue(current.document, stored.anchor, (document, anchor) =>
    writeWorkspaceProject(db, document, anchor), notify);
  const past: (typeof current)[] = [];
  const future: (typeof current)[] = [];
  const insertions = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3; next: MermaidProjectV3; definition: { id: string; version: string; hash: string };
  }>();
  const structure = new WeakMap<ReadyProposal, { base: MermaidProjectV3; next: MermaidProjectV3; elementId?: string; impact?: ElementRemovalImpact }>();
  const suggestions = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3; next: MermaidProjectV3; request: PendingAssistRequest;
  }>();
  const designs = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3;
    dependency: string;
    candidate: ReturnType<typeof buildDesignRecipeCandidate> | ReturnType<typeof buildScopedDesignRecipe>;
    rendered: Awaited<ReturnType<typeof renderMermaidProject>>;
  }>();
  const layouts = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3;
    dependency: string;
    candidate: ReturnType<typeof buildLayoutCandidate>;
    current: Awaited<ReturnType<typeof renderMermaidProject>>;
    rendered: Awaited<ReturnType<typeof renderMermaidProject>>;
  }>();
  const stories = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3;
    next: MermaidProjectV3;
    suggestions: ReturnType<typeof suggestGroupScenes>;
    rendered: Awaited<ReturnType<typeof renderMermaidProject>>;
    destination: StoryDestination | 'edit';
    savingCopy: boolean;
  }>();
  const contrast = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3; next: MermaidProjectV3; kind: ContrastKind; color: string; label: string; beforeRatio: number; afterRatio: number; threshold: number; svg: string;
  }>();
  const bulkText = new WeakMap<ReadyProposal, { base: MermaidProjectV3; next: MermaidProjectV3 }>();
  const designResets = new WeakMap<ReadyProposal, { base: MermaidProjectV3; next: MermaidProjectV3 }>();
  let closed = false;
  let savingSuggestion = false;

  function prepareHeading(envelope: unknown) {
    return headingLane.prepare({ document: current.document, revision: current.document.revision }, envelope);
  }

  function applyHeading(proposal: ReadyProposal) {
    if (closed) return 'invalid';
    const result = headingLane.resolve(proposal, current.document, current.document.revision);
    if (result.status !== 'ready') return result.status;
    return commit(result.document);
  }

  async function prepareStructure(edit: NativeFlowchartEdit, signal?: AbortSignal): Promise<ReadyProposal> {
    const base = current.document;
    const { document, elementId, impact } = await prepareFlowchartCandidate(base, { ...edit }, signal);
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    structure.set(proposal, { base, next: freezeSnapshot(document), elementId, impact: freezeSnapshot(impact) });
    return proposal;
  }

  async function prepareSource(source: string, expected: MermaidProjectV3, signal?: AbortSignal) {
    const base = current.document;
    const stale = () => new SourceDiagnosticError('stale', 'The project changed. Reopen the source editor to review the current revision.');
    if (closed || base !== expected) throw stale();
    const { document, added, preserved } = await prepareManualSource(base, source, signal);
    if (closed || current.document !== base) throw stale();
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    structure.set(proposal, { base, next: freezeSnapshot(document) });
    return { proposal, added, preserved };
  }

  function prepareOrphanCleanup(ids: readonly string[], expected: MermaidProjectV3): ReadyProposal {
    const base = current.document;
    if (closed || base !== expected) throw new Error('This project changed. Review the current annotations again.');
    const selection = new Set(ids);
    const orphans = base.identity.orphans.filter(record => !selection.has(record.id));
    if (!selection.size || selection.size > orphanCleanupLimit || selection.size !== ids.length
      || base.identity.orphans.length - orphans.length !== selection.size) {
      throw new Error(`Choose up to ${orphanCleanupLimit} distinct unresolved annotations from this project.`);
    }
    const next = freezeSnapshot(validateMermaidProject({
      ...base, identity: { ...base.identity, orphans }, revision: base.revision + 1, updatedAt: new Date().toISOString(),
    }));
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    structure.set(proposal, { base, next });
    return proposal;
  }

  function applyStructure(proposal: ReadyProposal) {
    const change = structure.get(proposal);
    if (closed || !change) return { status: 'invalid' } as const;
    if (change.base !== current.document) return { status: 'stale' } as const;
    const status = commit(change.next);
    return { status, elementId: status === 'applied' || status === 'unchanged' ? change.elementId : undefined };
  }

  async function prepareInsertion(
    definition: ComponentDefinition, values: Readonly<Record<string, string | number>>,
    assignments: ReadonlyMap<string, PortAssignment>, signal?: AbortSignal,
  ) {
    if (closed) throw new Error('The project is closed.');
    const base = current.document;
    const snapshot = structuredClone(definition);
    const input = structuredClone(values);
    const ports = structuredClone(assignments);
    const { prepareComponentInsertion } = await import('./component-insertion');
    const candidate = await prepareComponentInsertion(base, snapshot, input, ports, signal);
    const rendered = await renderMermaidProject(candidate.document, signal);
    signal?.throwIfAborted();
    if (closed || current.document !== base || !rendered.targetTable) {
      throw new Error('The project changed or the inserted component could not be verified.');
    }
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    const next = freezeSnapshot(candidate.document);
    insertions.set(proposal, { base, next, definition: { id: snapshot.id, version: snapshot.version, hash: candidate.definitionHash } });
    return { ...candidate, document: next, rendered: rendered.result, proposal };
  }

  async function applyInsertion(proposal: ReadyProposal, signal?: AbortSignal) {
    const change = insertions.get(proposal);
    if (closed || !change || change.base !== current.document) return 'stale';
    const [{ readComponentLibrary }, { curatedComponents }] = await Promise.all([
      import('../persistence/component-library'), import('./curated-components'),
    ]);
    const definitions = [...curatedComponents, ...await readComponentLibrary(db)];
    const currentDefinition = definitions.find(item => item.id === change.definition.id && item.version === change.definition.version);
    if (!currentDefinition || await canonicalDigest('meridian-component/v1', [currentDefinition]) !== change.definition.hash) {
      throw new Error('The saved definition changed. Select the current definition and preview again.');
    }
    signal?.throwIfAborted();
    return !closed && change.base === current.document ? commit(change.next) : 'stale';
  }

  function detachComponentInstance(instanceId: string, expected: MermaidProjectV3) {
    const base = current.document;
    if (closed || base !== expected) return 'stale';
    const componentInstances = base.componentInstances.filter(instance => instance.id !== instanceId);
    if (componentInstances.length === base.componentInstances.length) return 'unchanged';
    return commit(freezeSnapshot(validateMermaidProject({
      ...base, componentInstances, revision: base.revision + 1, updatedAt: new Date().toISOString(),
    })));
  }

  function readStructurePreview(proposal: ReadyProposal) {
    const change = structure.get(proposal);
    return !closed && change?.base === current.document ? change.next : undefined;
  }

  function readStructureImpact(proposal: ReadyProposal) {
    const change = structure.get(proposal);
    return !closed && change?.base === current.document ? change.impact : undefined;
  }

  async function prepareAssistSuggestion(text: string, signal?: AbortSignal) {
    const base = current.document;
    const file = parseAssistSuggestion(text);
    const request = await readPendingAssist(db, file.requestId);
    const token = await projectBaseToken(base);
    const operation = authorizeAssistEdit(file, request, token);
    signal?.throwIfAborted();
    const { document, impact } = await prepareFlowchartCandidate(base, operation, signal);
    if (closed || current.document !== base) throw new Error('The project changed. Export a fresh request.');
    if (document === base) throw new Error('The suggestion makes no change to the current label.');
    const preview = await renderMermaidProject(document, signal);
    signal?.throwIfAborted();
    if (!preview.targetTable || closed || current.document !== base) throw new Error('The suggestion could not be verified against the current diagram.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    const next = freezeSnapshot(document);
    suggestions.set(proposal, { base, next, request });
    return { proposal, next, preview, impact, ...operation };
  }

  async function applyAssistSuggestion(proposal: ReadyProposal) {
    const change = suggestions.get(proposal);
    if (closed || savingSuggestion || !change || change.base !== current.document) {
      throw new Error('The project changed. Export a fresh request.');
    }
    const next = historyEntry(change.next);
    if (current.bytes + next.bytes > historyByteLimit) throw new Error('The suggestion exceeds the Undo history budget.');
    savingSuggestion = true;
    try {
      await queue.flush();
      const saved = queue.state();
      if (closed || change.base !== current.document || saved.phase !== 'saved' || !saved.anchor) {
        throw new Error('Save the current project before applying this suggestion.');
      }
      const anchor = await writeWorkspaceProject(db, change.next, saved.anchor, change.request);
      advanceHistory(next, anchor);
      suggestions.delete(proposal);
    } finally {
      savingSuggestion = false;
    }
  }

  async function prepareDesign(id: DesignRecipeId, intent: DesignScope, signal?: AbortSignal) {
    if (closed) throw new Error('The project is closed.');
    signal?.throwIfAborted();
    const base = current.document;
    const scope = structuredClone(intent);
    const accepted = scope.kind === 'diagram' && !scope.applyRoleShapes ? undefined : await renderMermaidProject(base, signal);
    if (closed || current.document !== base) throw new Error('The project changed. Refresh the design preview.');
    const candidate = scope.kind === 'diagram' ? buildDesignRecipeCandidate(base, id, scope.applyRoleShapes === true, accepted)
      : buildScopedDesignRecipe(base, id, scope, accepted!);
    const rendered = candidate.document === base && accepted ? accepted : await renderMermaidProject(candidate.document, signal);
    if (accepted && scope.kind !== 'diagram') verifyScopedDesign(accepted, rendered, candidate.proof);
    if (accepted && 'shapeIds' in candidate && candidate.shapeIds.length) verifyPresentationRoleShapes(accepted, rendered, candidate.shapeIds);
    signal?.throwIfAborted();
    if (!rendered.targetTable) throw new Error('This design can only be previewed on a verified flowchart.');
    if (closed || current.document !== base) throw new Error('The project changed. Refresh the design preview.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    designs.set(proposal, { base, candidate: freezeSnapshot(candidate),
      rendered, dependency: canonicalJson(candidate.recipe) });
    return proposal;
  }

  function readDesignPreview(proposal: ReadyProposal) {
    const change = designs.get(proposal);
    if (closed || !change || change.base !== current.document) return undefined;
    return { ...change.candidate, rendered: change.rendered };
  }

  function applyDesign(proposal: ReadyProposal) {
    const change = designs.get(proposal);
    if (closed || !change) return 'invalid';
    if (change.base !== current.document || change.dependency !== canonicalJson(readDesignRecipe(change.candidate.recipe.id))) return 'stale';
    return commit(change.candidate.document);
  }

  async function prepareDesignReset(selected: ReadonlySet<string>, reset: DesignReset, expected: BaseToken, signal?: AbortSignal) {
    if (closed || !selected.size || selected.size > 1_500) throw new Error('Select up to 1,500 verified diagram elements.');
    const base = current.document;
    const selection = new Set(selected);
    const intent = { ...reset };
    const accepted = await renderMermaidProject(base, signal);
    if (!accepted.targetTable || !sameBaseToken(expected, accepted.targetTable.baseToken) || closed || current.document !== base) {
      throw new Error('The diagram changed. Review the current selection.');
    }
    const candidate = buildDesignReset(base, accepted, selection, intent);
    const next = freezeSnapshot(candidate.document);
    const rendered = await renderMermaidProject(next, signal);
    signal?.throwIfAborted();
    if (!rendered.targetTable || verifiedTopology(accepted.targetTable) !== verifiedTopology(rendered.targetTable)) {
      throw new Error('The reset could not be verified against the diagram topology and labels.');
    }
    if (closed || current.document !== base) throw new Error('The diagram changed. Review the current selection.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    designResets.set(proposal, { base, next });
    return { proposal, next, rendered, changes: measuredResetValues(candidate.changes, rendered) };
  }

  function applyDesignReset(proposal: ReadyProposal) {
    const change = designResets.get(proposal);
    if (closed || !change) return 'invalid';
    return change.base === current.document ? commit(change.next) : 'stale';
  }

  async function prepareBulkText(selected: ReadonlySet<string>, color: string, expected: BaseToken, signal?: AbortSignal) {
    if (closed || !selected.size || selected.size > 1_500) throw new Error('Select up to 1,500 diagram elements.');
    const base = current.document;
    const selection = new Set(selected);
    const accepted = await renderMermaidProject(base, signal);
    if (!accepted.targetTable || !sameBaseToken(expected, accepted.targetTable.baseToken) || closed || current.document !== base) {
      throw new Error('The diagram changed. Review the current selection.');
    }
    const scope = bulkTextSelection(accepted, selection);
    const ids = scope.eligible.map(item => item.id);
    const next = freezeSnapshot(buildBulkTextCandidate(base, ids, color));
    const preview = await renderMermaidProject(next, signal);
    signal?.throwIfAborted();
    verifyBulkTextCandidate(accepted, preview, ids, color);
    if (closed || current.document !== base) throw new Error('The diagram changed. Review the current selection.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    bulkText.set(proposal, { base, next });
    return { proposal, next, preview, scope };
  }

  function applyBulkText(proposal: ReadyProposal) {
    const change = bulkText.get(proposal);
    if (closed || !change) return 'invalid';
    return change.base === current.document ? commit(change.next) : 'stale';
  }

  async function prepareContrast(elementId: string, profile: ViewingProfile, expected: BaseToken, kind: ContrastKind, signal?: AbortSignal) {
    if (closed) throw new Error('The project is closed.');
    const base = current.document;
    const viewing = { ...profile };
    const accepted = await renderMermaidProject(base, signal);
    if (!accepted.targetTable || !sameBaseToken(expected, accepted.targetTable.baseToken) || closed || current.document !== base) {
      throw new Error('The diagram changed. Check readability again.');
    }
    const before = measureTargetContrast(accepted, base, elementId, viewing, kind);
    const { document, color } = buildContrastCandidate(base, elementId, before);
    const rendered = await renderMermaidProject(document, signal);
    signal?.throwIfAborted();
    if (!rendered.targetTable || verifiedTopology(rendered.targetTable) !== verifiedTopology(accepted.targetTable)) {
      throw new Error('The proposed color did not preserve the verified diagram targets.');
    }
    const after = measureTargetContrast(rendered, document, elementId, viewing, kind);
    if (after.ratio < after.threshold || after.ratio <= before.ratio) {
      throw new Error('The proposed color did not meet the contrast target. Adjust its appearance manually.');
    }
    if (closed || current.document !== base) throw new Error('The diagram changed. Check readability again.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    contrast.set(proposal, { base, next: freezeSnapshot(document), kind, color, label: before.label,
      beforeRatio: before.ratio, afterRatio: after.ratio, threshold: after.threshold, svg: after.svg });
    return proposal;
  }

  function readContrastPreview(proposal: ReadyProposal) {
    const prepared = contrast.get(proposal);
    return !closed && prepared?.base === current.document ? prepared : undefined;
  }

  function applyContrast(proposal: ReadyProposal) {
    const prepared = contrast.get(proposal);
    if (closed || !prepared) return 'invalid';
    return prepared.base === current.document ? commit(prepared.next) : 'stale';
  }

  async function prepareLayout(intent: LayoutIntent, signal?: AbortSignal) {
    if (closed) throw new Error('The project is closed.');
    signal?.throwIfAborted();
    const base = current.document;
    const { id, direction } = intent;
    const candidate = buildLayoutCandidate(base, { id, direction });
    const accepted = await renderMermaidProject(base, signal);
    if (!accepted.targetTable) throw new Error('A verified flowchart is needed to compare layouts.');
    if (closed || current.document !== base) throw new Error('The project changed. Refresh the layout preview.');
    const rendered = candidate.document === base ? accepted : await renderMermaidProject(candidate.document, signal);
    signal?.throwIfAborted();
    if (!rendered.targetTable || verifiedTopology(accepted.targetTable) !== verifiedTopology(rendered.targetTable)) {
      throw new Error('The proposed layout did not preserve the verified diagram relationships.');
    }
    const expectedDirection = direction === 'keep' ? accepted.flowDirection : direction;
    if (rendered.flowDirection !== expectedDirection) throw new Error('The renderer did not honor the requested direction.');
    if (closed || current.document !== base) throw new Error('The project changed. Refresh the layout preview.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    layouts.set(proposal, { base, candidate: freezeSnapshot(candidate), current: accepted, rendered, dependency: canonicalJson(candidate.option) });
    return proposal;
  }

  function readLayoutPreview(proposal: ReadyProposal) {
    const change = layouts.get(proposal);
    if (closed || !change || change.base !== current.document) return undefined;
    return { ...change.candidate, current: change.current, rendered: change.rendered };
  }

  function applyLayout(proposal: ReadyProposal) {
    const change = layouts.get(proposal);
    if (closed || !change) return 'invalid';
    if (change.base !== current.document || change.dependency !== canonicalJson(readLayoutAlternative(change.candidate.option.id))) return 'stale';
    return commit(change.candidate.document);
  }

  async function prepareStory(
    intent: { strategy: 'groups'; options: GroupStoryOptions } | { strategy: 'path'; options: readonly PathStoryOptions[] },
    destination: StoryDestination,
    signal?: AbortSignal,
  ) {
    if (closed) throw new Error('The project is closed.');
    if (destination !== 'append' && destination !== 'replace' && destination !== 'duplicate') {
      throw new Error('Choose a storyboard destination.');
    }
    signal?.throwIfAborted();
    const base = current.document;
    const choices = structuredClone(intent);
    const rendered = await renderMermaidProject(base, signal);
    signal?.throwIfAborted();
    if (!rendered.targetTable) throw new Error('Render a verified flowchart before suggesting scenes.');
    if (closed || current.document !== base) throw new Error('The project changed. Prepare the story preview again.');
    if (choices.strategy === 'path' && (!choices.options.length || choices.options.length > 20)) {
      throw new Error('Choose between 1 and 20 path scenes.');
    }
    const table = rendered.targetTable;
    const suggestions = choices.strategy === 'groups'
      ? suggestGroupScenes(table, choices.options) : choices.options.flatMap(path => suggestPathScene(table, path));
    const existing = destination === 'append' ? base.storyboard.scenes : [];
    if (existing.length + suggestions.length > 50) throw new Error('Choose fewer scenes or review Replace. A story can contain at most 50 scenes.');
    const orphans = destination === 'append' ? base.identity.orphans : base.identity.orphans.flatMap(orphan => {
      if (!orphan.retained.sceneReferences?.length) return [orphan];
      const { sceneReferences: removed, ...retained } = orphan.retained;
      return retained.style || retained.role || retained.componentIds?.length ? [{ ...orphan, retained }] : [];
    });
    const suffix = ' — story copy';
    const projectFields = destination === 'duplicate' ? {
      id: crypto.randomUUID(),
      title: (base.title.trim() || 'Untitled diagram').slice(0, 120 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix,
      revision: 0,
    } : { revision: base.revision + 1 };
    const next = freezeSnapshot(validateMermaidProject({
      ...base, ...projectFields, identity: { ...base.identity, orphans },
      storyboard: { ...base.storyboard, scenes: [...existing, ...suggestions.map(item => item.scene)] },
      updatedAt: new Date().toISOString(),
    }));
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    stories.set(proposal, { base, next, suggestions: freezeSnapshot(suggestions), rendered, destination, savingCopy: false });
    return proposal;
  }

  function readStoryPreview(proposal: ReadyProposal) {
    const change = stories.get(proposal);
    return !closed && change?.base === current.document
      ? { next: change.next, suggestions: change.suggestions, rendered: change.rendered } : undefined;
  }

  async function prepareStoryScene(sceneId: string | null, details: StorySceneDetails, base: MermaidProjectV3,
    signal?: AbortSignal, selected?: readonly string[]) {
    if (closed || base !== current.document) throw new Error('The project changed. Open the current story again.');
    if (!Number.isFinite(details.duration) || details.duration < 0.5 || details.duration > 120
      || !Number.isFinite(details.transition) || details.transition < 0 || details.transition > Math.min(10, details.duration)) {
      throw new Error('Set duration from 0.5 to 120 seconds and entrance from 0 to 10 seconds within the scene duration.');
    }
    if (!Number.isFinite(details.padding) || details.padding < 8 || details.padding > 240) {
      throw new Error('Set camera padding from 8 to 240 diagram units.');
    }
    const { scenes } = base.storyboard;
    if (sceneId === null && scenes.length >= 50) throw new Error('A storyboard can contain at most 50 scenes.');
    const scene = sceneId === null ? createScene(scenes.length) : scenes.find(item => item.id === sceneId);
    if (!scene) throw new Error('Choose a scene in the current story.');
    const edited: StoryScene = {
      ...scene, title: details.title, duration: details.duration, transition: details.transition,
      easing: details.easing, reveal: details.reveal, camera: { ...scene.camera, padding: details.padding },
    };
    if (sceneId !== null && canonicalJson(scene) === canonicalJson(edited)) throw new Error('Change a scene property before previewing.');
    const selection = sceneId === null && selected ? [...selected] : undefined;
    const rendered = await renderMermaidProject(base, signal);
    signal?.throwIfAborted();
    if (closed || base !== current.document || !rendered.targetTable) throw new Error('The scene could not be verified against the current diagram.');
    const scope = selection && resolveManualStoryScope(rendered.targetTable, selection);
    if (scope) {
      edited.visible = scope.visible;
      edited.camera = { ...edited.camera, mode: 'elements', keys: scope.cameraKeys };
    }
    const next = freezeSnapshot(validateMermaidProject({
      ...base, revision: base.revision + 1, updatedAt: new Date().toISOString(),
      storyboard: { ...base.storyboard, scenes: sceneId === null ? [...scenes, edited] : scenes.map(item => item === scene ? edited : item) },
    }));
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    stories.set(proposal, { base, next, suggestions: scope ? [{ scene: edited, coverage: scope.coverage }] : [],
      rendered, destination: 'edit', savingCopy: false });
    return proposal;
  }

  function applyStory(proposal: ReadyProposal) {
    const change = stories.get(proposal);
    if (closed || !change || change.destination === 'duplicate') return 'invalid';
    return change.base === current.document ? commit(change.next) : 'stale';
  }

  function editStorySceneOrder(sceneId: string, action: StorySceneOrderEdit, base: MermaidProjectV3) {
    if (closed) return 'invalid';
    if (base !== current.document) return 'stale';
    const scenes = [...base.storyboard.scenes];
    const index = scenes.findIndex(scene => scene.id === sceneId);
    if (index < 0) return 'invalid';
    if (action === 'remove') scenes.splice(index, 1);
    else {
      const destination = index + (action === 'earlier' ? -1 : 1);
      if (destination < 0 || destination >= scenes.length) return 'invalid';
      [scenes[destination], scenes[index]] = [scenes[index], scenes[destination]];
    }
    return commit(freezeSnapshot(validateMermaidProject({ ...base, revision: base.revision + 1, updatedAt: new Date().toISOString(),
      storyboard: { ...base.storyboard, scenes } })));
  }

  async function saveStoryCopy(proposal: ReadyProposal) {
    const change = stories.get(proposal);
    if (closed || !change || change.destination !== 'duplicate' || change.savingCopy || change.base !== current.document) {
      throw new Error('The project changed. Prepare the story preview again.');
    }
    change.savingCopy = true;
    try {
      await queue.flush();
      if (closed || change.base !== current.document) throw new Error('The project changed. Prepare the story preview again.');
      if (queue.state().phase !== 'saved') throw new Error('Save the original project before opening a separate story copy.');
      await writeWorkspaceProject(db, change.next, null);
      stories.delete(proposal);
      return change.next.id;
    } finally {
      change.savingCopy = false;
    }
  }

  function commit(document: MermaidProjectV3) {
    if (savingSuggestion) return 'invalid';
    if (document === current.document) return 'unchanged';
    const next = historyEntry(document);
    if (current.bytes + next.bytes > historyByteLimit) return 'history-limit';
    advanceHistory(next);
    return 'applied';
  }

  function advanceHistory(next: typeof current, anchor?: SavedAnchor) {
    past.push(current);
    future.length = 0;
    let bytes = next.bytes;
    let start = past.length;
    while (start > 0 && past.length - start < historyEntryLimit && bytes + past[start - 1].bytes <= historyByteLimit) {
      bytes += past[--start].bytes;
    }
    past.splice(0, start);
    current = next;
    if (anchor) queue.adoptSaved(next.document, anchor);
    else queue.edit(next.document);
  }

  function restore(from: typeof past, to: typeof past) {
    const previous = from.at(-1);
    if (closed || savingSuggestion || !previous) return false;
    const document = Object.freeze({ ...previous.document, revision: current.document.revision + 1, updatedAt: new Date().toISOString() });
    validateMermaidProject(document);
    to.push(current);
    from.pop();
    current = historyEntry(document);
    queue.edit(document);
    return true;
  }

  return {
    snapshot: () => current.document,
    prepareHeading,
    applyHeading,
    prepareStructure,
    prepareOrphanCleanup,
    prepareSource,
    readStructurePreview,
    readStructureImpact,
    applyStructure,
    prepareInsertion,
    applyInsertion,
    prepareAssistSuggestion,
    applyAssistSuggestion,
    detachComponentInstance,
    prepareDesign,
    readDesignPreview,
    applyDesign,
    prepareDesignReset,
    applyDesignReset,
    prepareLayout,
    prepareContrast,
    prepareBulkText,
    applyBulkText,
    readContrastPreview,
    applyContrast,
    readLayoutPreview,
    applyLayout,
    prepareStory,
    readStoryPreview,
    prepareStoryScene,
    applyStory,
    editStorySceneOrder,
    saveStoryCopy,
    undo: () => restore(past, future),
    redo: () => restore(future, past),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    saveState: queue.state,
    flush: queue.flush,
    retrySave: queue.retry,
    close() {
      closed = true;
      queue.dispose();
    },
  };
}
