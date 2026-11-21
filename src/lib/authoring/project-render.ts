import type { RenderResult } from '../../types';
import type { DesignState, ElementKind, ElementStyle, RenderElement } from '../../types/design';
import { flowEdgeDirection, type FlowModel } from '../design';
import { flowchartModelFor, renderDiagram, renderFingerprint } from '../render';
import type { RenderPriority } from '../render-queue';
import { canonicalDigest, canonicalJson, projectBaseToken, type BaseToken } from './base-token';
import { sourceBindingKey } from './identities';
import { observeFlowchartIdentities, type ObservedIdentity } from './identity-observation';
import type { MermaidProjectV3 } from './mermaid-project';
import { presentationRoleShape } from './presentation-role-shape';

interface RenderTarget {
  id: string;
  elementKind: ElementKind;
  label: string;
  parentId: string | null;
  members: string[];
  sourceId: string | null;
  targetId: string | null;
  direction: 'forward' | 'both' | 'none' | null;
  bounds: NonNullable<RenderElement['bounds']>;
}

export interface RenderTargetTable {
  schema: 'meridian-targets/v1';
  baseToken: BaseToken;
  renderFingerprint: string;
  targets: RenderTarget[];
}

export function verifiedTopology(table: RenderTargetTable) {
  const topology = table.targets.map(({ id, elementKind, label, parentId, members, sourceId, targetId, direction }) =>
    ({ id, elementKind, label, parentId, members: [...members].sort(), sourceId, targetId, direction }));
  return canonicalJson(topology.sort((a, b) => a.id.localeCompare(b.id)));
}

const mismatchedTarget = () => new Error('The accepted flowchart could not be matched to its saved identities and geometry.');

function hasBounds(bounds: RenderElement['bounds']): bounds is RenderTarget['bounds'] {
  return !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)
    && bounds.width >= 0 && bounds.height >= 0;
}

/** Bind resolved UUIDs and presentation styles to the measured render of an accepted snapshot. */
export async function renderMermaidProject(snapshot: MermaidProjectV3, signal?: AbortSignal, priority: RenderPriority = 'foreground'): Promise<{
  result: RenderResult;
  targetTable: RenderTargetTable | null;
  flowDirection?: string;
  edgeLabels?: ReadonlyMap<string, string>;
}> {
  signal?.throwIfAborted();
  const live = snapshot.identity.elements.filter(record => record.status === 'resolved');
  const kinds = new Map(live.map(record => [record.id, record.elementKind]));
  const byBinding = new Map(live.map(record => [sourceBindingKey(record), record.id]));
  const overrides: DesignState = { preset: snapshot.design.preset, elements: {} };
  const shapeRoles = new Map(snapshot.design.applyRoleShapes ? snapshot.roles.map(item => [item.elementId, item.role]) : []);
  for (const record of live) {
    const shape = record.elementKind === 'node' ? presentationRoleShape(snapshot.design.recipe, shapeRoles.get(record.id)) : undefined;
    const recipe = snapshot.design.recipeElements[record.id]?.style;
    const manual = snapshot.design.elements[record.id];
    if (shape || recipe || manual) overrides.elements[record.id] = { ...(shape ? { shape } : {}), ...recipe, ...manual };
  }
  const [baseToken, projectionKey] = await Promise.all([
    projectBaseToken(snapshot), canonicalDigest('meridian-render-bindings/v1', [...byBinding].sort()),
  ]);
  const observations = new WeakMap<FlowModel, Promise<ObservedIdentity[]>>();
  function observe(model: FlowModel) {
    const cached = observations.get(model);
    if (cached) return cached;
    const pending = observeFlowchartIdentities(model);
    observations.set(model, pending);
    return pending;
  }

  const result = await renderDiagram(snapshot.source, snapshot.settings, {}, overrides, {
    signal, priority,
    projection: {
      key: projectionKey,
      async resolve(model) {
        const elements: Record<string, ElementStyle> = {};
        if (model) for (const binding of await observe(model)) {
          const id = byBinding.get(sourceBindingKey(binding));
          if (id && overrides.elements[id]) elements[binding.legacyKey] = overrides.elements[id];
        }
        return { preset: overrides.preset, elements };
      },
    },
  });
  const model = flowchartModelFor(result);
  if (!model) return { result, targetTable: null };
  const observed = await observe(model);
  signal?.throwIfAborted();
  const bound = new Map(observed.flatMap(item => {
    const id = byBinding.get(sourceBindingKey(item));
    return id ? [[item.legacyKey, id] as const] : [];
  }));
  const rawElements = new Map(result.elements?.map(item => [item.key, item]));
  if (bound.size !== live.length) throw mismatchedTarget();
  const directions = new Map<string, RenderTarget['direction']>();
  const edgeLabels = new Map<string, string>();
  let edgeIndex = 0;
  for (const item of observed) {
    if (item.elementKind !== 'edge') continue;
    const edge = model.edges[edgeIndex++];
    const id = bound.get(item.legacyKey);
    if (id) edgeLabels.set(id, edge.text ?? '');
    directions.set(item.legacyKey, flowEdgeDirection(edge));
  }
  const idFor = (key: string) => {
    const id = bound.get(key);
    if (!id) throw mismatchedTarget();
    return id;
  };
  const targets: RenderTarget[] = [];
  const elements: RenderElement[] = [];
  for (const [key, id] of bound) {
    const raw = rawElements.get(key);
    if (!raw || raw.kind !== kinds.get(id) || !hasBounds(raw.bounds) || (raw.kind === 'edge' && (!raw.from || !raw.to))) {
      throw mismatchedTarget();
    }
    const parentId = raw.parentKey ? idFor(raw.parentKey) : null;
    const members = Array.from(new Set(raw.members?.map(idFor)));
    const sourceId = raw.from ? idFor(raw.from) : null;
    const targetId = raw.to ? idFor(raw.to) : null;
    const direction = directions.get(key) ?? null;
    const label = Array.from(raw.label).slice(0, 1000).join('');
    targets.push({ id, elementKind: raw.kind, label, parentId, members, sourceId, targetId, direction, bounds: { ...raw.bounds } });
    elements.push({ ...raw, key: id, label, parentKey: parentId ?? undefined, members, from: sourceId ?? undefined, to: targetId ?? undefined });
  }
  const targetsById = new Map(targets.map(target => [target.id, target]));
  for (const target of targets) {
    if (target.members.some(id => targetsById.get(id)?.parentId !== target.id)) throw mismatchedTarget();
    const ancestors = new Set([target.id]);
    for (let parent = target.parentId; parent; parent = targetsById.get(parent)?.parentId ?? null) {
      if (ancestors.has(parent)) throw mismatchedTarget();
      ancestors.add(parent);
    }
  }

  const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;
  if (svg.localName !== 'svg') throw mismatchedTarget();
  for (const target of svg.querySelectorAll('[data-element-key], [data-element-owner]')) {
    for (const attribute of ['data-element-key', 'data-element-owner']) {
      const key = target.getAttribute(attribute);
      if (!key) continue;
      const id = bound.get(key);
      if (id) {
        target.setAttribute(attribute, id);
        if (target.hasAttribute('data-node-key')) target.setAttribute('data-node-key', id);
      } else {
        if (target.hasAttribute('data-edge-hit')) {
          target.remove();
          break;
        }
        target.removeAttribute(attribute);
        for (const interaction of ['data-element-kind', 'data-node-key', 'tabindex', 'role', 'aria-label']) target.removeAttribute(interaction);
      }
    }
  }
  const fingerprint = await canonicalDigest('meridian-render/v1', [projectionKey, renderFingerprint(snapshot.source, snapshot.settings, {}, overrides)]);
  signal?.throwIfAborted();
  return {
    result: {
      ...result,
      elements,
      nodes: result.nodes.flatMap(node => {
        const id = bound.get(`node:${node.key}`);
        return id ? [{ ...node, key: id }] : [];
      }),
      svg: new XMLSerializer().serializeToString(svg),
    },
    targetTable: { schema: 'meridian-targets/v1', baseToken, renderFingerprint: fingerprint, targets },
    flowDirection: model.direction,
    edgeLabels,
  };
}
