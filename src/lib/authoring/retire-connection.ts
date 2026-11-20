import type { MermaidProjectV3, OrphanSceneReference } from './mermaid-project';

/** Remove active references and retain the exact locations as unresolved annotations. */
export function retireConnection(document: MermaidProjectV3, id: string, sourceId: string) {
  if (document.design.recipeElements[id] || document.provenance.some(record => record.elementId === id)
    || document.componentInstances.some(instance => instance.bindings.some(binding => binding.elementId === id))) {
    throw new Error('This connection has a recipe, component, or import reference. Clear or detach that reference before deleting it.');
  }

  const { [id]: style, ...elements } = document.design.elements;
  const role = document.roles.find(record => record.elementId === id)?.role;
  const sceneReferences: OrphanSceneReference[] = [];
  const sceneTitles: string[] = [];
  const scenes = document.storyboard.scenes.map(scene => {
    const start = sceneReferences.length;
    function extract(keys: string[], field: OrphanSceneReference['field']) {
      const index = keys.indexOf(id);
      if (index < 0) return keys;
      sceneReferences.push({ sceneId: scene.id, field, index });
      return keys.filter(key => key !== id);
    }
    const visible = scene.visible && extract(scene.visible, 'visible');
    const highlight = extract(scene.highlight, 'highlight');
    const flow = extract(scene.flow, 'flow');
    const keys = extract(scene.camera.keys, 'camera');
    if (sceneReferences.length === start) return scene;
    sceneTitles.push(scene.title || 'Untitled scene');
    const camera = keys === scene.camera.keys ? scene.camera : { ...scene.camera, keys, mode: keys.length ? scene.camera.mode : 'fit' as const };
    return { ...scene, visible, highlight, flow, camera };
  });
  const retained = { ...(style && { style }), ...(role && { role }), ...(sceneReferences.length && { sceneReferences }) };
  const orphans = style || role || sceneReferences.length ? [...document.identity.orphans, {
    id: crypto.randomUUID(), formerElementId: id, legacyKey: `edge:id:${sourceId}`, reason: 'retired' as const, retained,
  }] : document.identity.orphans;
  return {
    design: { ...document.design, elements },
    roles: document.roles.filter(record => record.elementId !== id),
    storyboard: { ...document.storyboard, scenes },
    orphans,
    impact: { sceneTitles, sceneReferenceCount: sceneReferences.length, retainsStyle: !!style, retainsRole: !!role },
  };
}

export type ConnectionRemovalImpact = ReturnType<typeof retireConnection>['impact'];
