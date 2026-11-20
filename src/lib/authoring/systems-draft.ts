import { encodeMermaidLabel, shapeDelimiters, type ConnectionDirection, type Shape } from './flowchart-source';
import { systemRoles } from './relationship-table';

type SystemRole = (typeof systemRoles)[number];
export type SystemRow = { id: string; label: string; role: SystemRole | null; shape: Shape };
export type SystemConnection = { id: string; sourceId: string; targetId: string; label: string; direction: ConnectionDirection };
export type SystemsDraft = { title: string; direction: 'LR' | 'TB'; nodes: SystemRow[]; edges: SystemConnection[] };

const draftId = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const directions = new Set<ConnectionDirection>(['forward', 'both', 'none']);
export function normalizeSystemsDraft(input: SystemsDraft) {
  if (typeof input.title !== 'string' || input.title.length > 120 || /[\uD800-\uDFFF]/u.test(input.title)
    || (input.direction !== 'LR' && input.direction !== 'TB')) throw new Error('Check the project title and layout direction.');
  if (!input.nodes.length || input.nodes.length > 200 || input.edges.length > 400) {
    throw new Error('Choose 1 to 200 systems and up to 400 relationships.');
  }
  const ids = new Set<string>();
  const nodes = input.nodes.map(({ id, label, role, shape }, index) => {
    if (typeof id !== 'string' || !draftId.test(id) || ids.has(id) || typeof label !== 'string' || !label.trim()
      || (role !== null && !systemRoles.includes(role)) || !Object.hasOwn(shapeDelimiters, shape)) {
      throw new Error(`Check the label, role and shape for system ${index + 1}.`);
    }
    try { encodeMermaidLabel(label); }
    catch (reason) { throw new Error(`System ${index + 1} ${reason instanceof Error ? reason.message : 'has an invalid label.'}`); }
    ids.add(id);
    return { id, label, role, shape };
  });
  const edgeIds = new Set<string>();
  const edges = input.edges.map(({ id, sourceId, targetId, label, direction }, index) => {
    if (typeof id !== 'string' || !draftId.test(id) || edgeIds.has(id) || !ids.has(sourceId) || !ids.has(targetId)
      || typeof label !== 'string' || !directions.has(direction)) {
      throw new Error(`Choose valid endpoints and direction for relationship ${index + 1}.`);
    }
    if (label) {
      try { encodeMermaidLabel(label); }
      catch (reason) { throw new Error(`Relationship ${index + 1} ${reason instanceof Error ? reason.message : 'has an invalid label.'}`); }
    }
    edgeIds.add(id);
    return { id, sourceId, targetId, label, direction };
  });
  return { title: input.title, direction: input.direction, nodes, edges };
}
