import { edgeIdentities, type FlowModel } from '../design';
import { canonicalDigest } from './base-token';
import type { SourceIdentity } from './identities';

export type ObservedIdentity = SourceIdentity & { legacyKey: string };

/** Produce migration evidence from the detached source graph, independent of SVG geometry. */
export async function observeFlowchartIdentities(model: FlowModel): Promise<ObservedIdentity[]> {
  const groups = model.groups.map(({ id }): ObservedIdentity =>
    ({ elementKind: 'group', binding: { type: 'source-id', sourceId: id }, legacyKey: `group:${id}` }));
  const groupIds = new Set(model.groups.map(({ id }) => id));
  const nodes = Array.from(model.vertices.values(), ({ id }): ObservedIdentity | null =>
    groupIds.has(id) ? null : ({ elementKind: 'node', binding: { type: 'source-id', sourceId: id }, legacyKey: `node:${id}` }))
    .filter((node): node is ObservedIdentity => node !== null);
  if (nodes.length + groups.length + model.edges.length > 2_000) throw new Error('The flowchart has too many identity targets.');

  const legacyKeys = edgeIdentities(model.edges);
  const occurrences = new Map<string, number>();
  const edges = await Promise.all(model.edges.map(async (edge, index): Promise<ObservedIdentity> => {
    const legacyKey = legacyKeys[index];
    if (edge.isUserDefinedId) {
      if (!edge.id) throw new Error('Mermaid did not return the authored connector ID.');
      return { elementKind: 'edge', binding: { type: 'edge-id', sourceId: edge.id }, legacyKey };
    }
    const label = edge.text ?? '';
    const key = JSON.stringify([edge.start, edge.end, label]);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const [labelHash, fingerprint] = await Promise.all([
      canonicalDigest('meridian-legacy-edge-label/v1', label),
      canonicalDigest('meridian-legacy-edge/v1', [edge.start, edge.end, label, edge.type ?? null, edge.stroke ?? null, edge.length ?? null]),
    ]);
    return {
      elementKind: 'edge', legacyKey,
      binding: { type: 'legacy-edge', sourceId: edge.start, targetId: edge.end, labelHash, occurrence, fingerprint },
    };
  }));
  return [...nodes, ...groups, ...edges];
}
