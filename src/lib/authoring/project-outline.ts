import { flowchartSourceLocations } from './source-patches';
import type { MermaidProjectV3 } from './mermaid-project';
import type { RenderTargetTable } from './project-render';

export interface OutlineSourceLocation { from: number; to: number; line: number }

function provenSourceLocations(source: string) {
  try { return flowchartSourceLocations(source, true); } catch { return undefined; }
}

function lineOfOffset(lineStarts: number[], offset: number) {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Outline rows use the same resolved identities, endpoints and membership as the measured canvas. */
export function projectOutline(project: MermaidProjectV3, table: RenderTargetTable) {
  const targets = new Map(table.targets.map(target => [target.id, target]));
  const bindings = new Map(project.identity.elements.filter(record => record.status === 'resolved').map(record => [record.id, record.binding]));
  const roles = new Map(project.roles.map(role => [role.elementId, role.role]));
  const origins = new Map<string, MermaidProjectV3['provenance']>();
  for (const record of project.provenance) {
    const entries = origins.get(record.elementId) ?? [];
    entries.push(record);
    origins.set(record.elementId, entries);
  }
  const sourceLocations = provenSourceLocations(project.source);
  const lineStarts = sourceLocations ? [0, ...Array.from(project.source.matchAll(/\n/g), match => match.index + 1)] : [];
  const connectionCounts = new Map<string, number>();
  for (const edge of table.targets) {
    if (edge.elementKind !== 'edge') continue;
    for (const endpoint of new Set([edge.sourceId, edge.targetId])) {
      if (endpoint) connectionCounts.set(endpoint, (connectionCounts.get(endpoint) ?? 0) + 1);
    }
  }

  return table.targets.map(target => {
    const binding = bindings.get(target.id);
    const publicId = binding?.type === 'source-id' || binding?.type === 'edge-id' ? binding.sourceId : null;
    const span = binding?.type === 'edge-id' && target.elementKind === 'edge' ? sourceLocations?.edges.get(binding.sourceId)
      : binding?.type === 'source-id' && target.elementKind !== 'edge'
        ? (target.elementKind === 'group' ? sourceLocations?.groups : sourceLocations?.nodes)?.get(binding.sourceId) : undefined;
    const source = span ? { ...span, line: lineOfOffset(lineStarts, span.from) } : null;
    const sourceName = target.sourceId ? targets.get(target.sourceId)?.label : undefined;
    const targetName = target.targetId ? targets.get(target.targetId)?.label : undefined;
    const direction = target.direction === 'both' ? '↔' : target.direction === 'forward' ? '→' : '–';
    const endpoints = sourceName !== undefined && targetName !== undefined ? `${sourceName} ${direction} ${targetName}` : null;
    return {
      id: target.id, kind: target.elementKind, label: target.label, parentId: target.parentId,
      role: roles.get(target.id) ?? null, endpoints, sourceId: publicId, source,
      connections: connectionCounts.get(target.id) ?? 0, provenance: origins.get(target.id) ?? [],
    };
  });
}

export type ProjectOutlineItem = ReturnType<typeof projectOutline>[number];
