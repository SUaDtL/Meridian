import type { ElementCapability, ElementStyle } from '../../types/design';
import type { MermaidProjectV3, OrphanAnnotation, OrphanSceneReference } from './mermaid-project';
import type { RenderTargetTable } from './project-render';
import { validateMermaidProject } from './validate-mermaid-project';

type Target = RenderTargetTable['targets'][number];

const capabilityFor: Record<keyof ElementStyle, ElementCapability> = {
  fill: 'fill', color: 'text', stroke: 'stroke', strokeWidth: 'stroke', lineStyle: 'stroke',
  font: 'typography', fontSize: 'typography', fontWeight: 'typography', shape: 'shape',
  shadow: 'effects', glow: 'effects', emphasis: 'effects', rankSpan: 'rankSpan', routing: 'routing', arrowhead: 'arrowhead',
};

export function retainedAnnotationKind(document: MermaidProjectV3, record: OrphanAnnotation) {
  if (record.formerElementId) return document.identity.elements.find(item => item.id === record.formerElementId)?.elementKind;
  const kind = record.legacyKey.split(':', 1)[0];
  if (kind === 'node' || kind === 'group' || kind === 'edge') return kind;
}

function insertReference(keys: string[], index: number, targetId: string) {
  if (index > keys.length || keys.includes(targetId)) {
    throw new Error('A scene target already exists at this destination or its original position is unavailable.');
  }
  return [...keys.slice(0, index), targetId, ...keys.slice(index)];
}

/** Move one selected record to a compatible, currently proven identity. */
export function buildAnnotationRemap(
  document: MermaidProjectV3, orphanId: string, target: Target, capabilities: readonly ElementCapability[],
) {
  const orphan = document.identity.orphans.find(item => item.id === orphanId);
  if (!orphan || retainedAnnotationKind(document, orphan) !== target.elementKind
    || !document.identity.elements.some(item => item.id === target.id && item.status === 'resolved' && item.elementKind === target.elementKind)) {
    throw new Error('Choose a current diagram element of the same kind as the former target.');
  }
  const { style, role, sceneReferences, componentIds } = orphan.retained;
  if (componentIds?.length) throw new Error('This annotation includes component references that cannot be reassigned here.');
  if (!style && !role && !sceneReferences?.length) throw new Error('There are no retained fields to reattach.');
  const activeStyle = document.design.elements[target.id] ?? {};
  if (style && (Object.keys(style) as (keyof ElementStyle)[]).some(key =>
    !capabilities.includes(capabilityFor[key]) || (activeStyle[key] !== undefined && activeStyle[key] !== style[key]))) {
    throw new Error('The destination has a conflicting or unsupported appearance setting.');
  }
  const activeRole = document.roles.find(item => item.elementId === target.id);
  if (role && (target.elementKind !== 'node' || (activeRole && activeRole.role !== role))) {
    throw new Error('The destination cannot receive the retained role.');
  }
  const references = new Map<string, OrphanSceneReference[]>();
  for (const slot of sceneReferences ?? []) {
    const slots = references.get(slot.sceneId) ?? [];
    slots.push(slot);
    references.set(slot.sceneId, slots);
  }
  const scenes = document.storyboard.scenes.map(scene => {
    const slots = references.get(scene.id);
    if (!slots) return scene;
    const next = { ...scene };
    for (const { field, index } of slots) {
      if (field === 'camera') {
        next.camera = { ...next.camera, mode: 'elements', keys: insertReference(next.camera.keys, index, target.id) };
      } else {
        if (field === 'visible' && next.visible === null) throw new Error('A scene already shows the entire diagram.');
        if (field === 'flow' && target.direction !== 'forward' && target.direction !== 'both') {
          throw new Error('A retained flow effect requires a directed connection.');
        }
        next[field] = insertReference(next[field]!, index, target.id);
      }
    }
    return next;
  });
  const orphans = document.identity.orphans.filter(item => item.id !== orphan.id);
  const next = validateMermaidProject({
    ...document, revision: document.revision + 1, updatedAt: new Date().toISOString(),
    identity: { ...document.identity, orphans },
    design: style ? { ...document.design, elements: { ...document.design.elements, [target.id]: { ...activeStyle, ...style } } } : document.design,
    roles: role && !activeRole ? [...document.roles, { elementId: target.id, role }] : document.roles,
    storyboard: references.size ? { ...document.storyboard, scenes } : document.storyboard,
  });
  return { next, orphan };
}
