import type { MermaidProjectV3, OrphanSceneReference } from './mermaid-project';

type RemovedElement = { id: string; legacyKey: string };

/** Remove active references and retain the exact locations as unresolved annotations. */
export function retireElements(document: MermaidProjectV3, removed: readonly RemovedElement[]) {
  const removedIds = new Set(removed.map(item => item.id));
  if (removed.some(({ id }) => document.design.recipeElements[id])
    || document.provenance.some(record => removedIds.has(record.elementId))
    || document.componentInstances.some(instance => instance.bindings.some(binding => removedIds.has(binding.elementId)))) {
    throw new Error('The selection has a recipe, component, or import reference. Clear or detach that reference before deleting it.');
  }

  const elements = { ...document.design.elements };
  const roles = new Map(document.roles.filter(record => removedIds.has(record.elementId)).map(record => [record.elementId, record.role]));
  const references = new Map<string, OrphanSceneReference[]>();
  let sceneReferenceCount = 0;
  const sceneTitles: string[] = [];
  const scenes = document.storyboard.scenes.map(scene => {
    const start = sceneReferenceCount;
    function extract(keys: string[], field: OrphanSceneReference['field']) {
      const remaining = keys.filter((key, index) => {
        if (!removedIds.has(key)) return true;
        const record = references.get(key) ?? [];
        record.push({ sceneId: scene.id, field, index });
        references.set(key, record);
        sceneReferenceCount++;
        return false;
      });
      return keys.length === remaining.length ? keys : remaining;
    }
    const visible = scene.visible && extract(scene.visible, 'visible');
    const highlight = extract(scene.highlight, 'highlight');
    const flow = extract(scene.flow, 'flow');
    const keys = extract(scene.camera.keys, 'camera');
    if (sceneReferenceCount === start) return scene;
    sceneTitles.push(scene.title || 'Untitled scene');
    const camera = keys === scene.camera.keys ? scene.camera : { ...scene.camera, keys, mode: keys.length ? scene.camera.mode : 'fit' as const };
    return { ...scene, visible, highlight, flow, camera };
  });
  let styleCount = 0;
  const orphans = [...document.identity.orphans];
  for (const { id, legacyKey } of removed) {
    const style = elements[id];
    const role = roles.get(id);
    const sceneReferences = references.get(id);
    if (style) {
      delete elements[id];
      styleCount++;
    }
    if (style || role || sceneReferences) {
      const retained = { ...(style && { style }), ...(role && { role }), ...(sceneReferences && { sceneReferences }) };
      orphans.push({ id: crypto.randomUUID(), formerElementId: id, legacyKey, reason: 'retired', retained });
    }
  }
  return {
    design: { ...document.design, elements },
    roles: document.roles.filter(record => !removedIds.has(record.elementId)),
    storyboard: { ...document.storyboard, scenes },
    orphans,
    impact: { sceneTitles, sceneReferenceCount, styleCount, roleCount: roles.size },
  };
}

export type ElementRemovalImpact = ReturnType<typeof retireElements>['impact'];
