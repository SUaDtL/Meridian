import type { DelimitedRow } from './delimited-input';
import { authoringLimits, encodeMermaidLabel } from './flowchart-source';
import type { SemanticRole } from './mermaid-project';

export const systemRoles = ['neutral', 'service', 'database', 'queue', 'external', 'person'] as const satisfies readonly SemanticRole[];
type SystemRole = (typeof systemRoles)[number];

export type RelationshipColumns = {
  label: number;
  id: number | null;
  source: number | null;
  target: number | null;
  role: number | null;
};
export type RelationshipGraph = ReturnType<typeof mapRelationshipTable>;

export function mapRelationshipTable(rows: readonly DelimitedRow[], columns: RelationshipColumns, hasHeader: boolean) {
  const [first] = rows;
  if (!first || (hasHeader && rows.length < 2)) throw new Error('Include at least one data row.');
  if (columns.label == null || Object.values(columns).some(column => column !== null
    && (!Number.isInteger(column) || column < 0 || column >= first.cells.length))) {
    throw new Error('Map the label and any relationship columns to existing fields.');
  }
  if ((columns.source === null) !== (columns.target === null) || (columns.source !== null && columns.id === null)) {
    throw new Error('Map the node ID, source and target together when importing relationships.');
  }

  const nodes: { key: string; label: string; role: SystemRole | null; sourceRow: number }[] = [];
  const ids = new Map<string, string>();
  const unresolved: { line: number; source: string; target: string }[] = [];
  for (let index = Number(hasHeader); index < rows.length; index++) {
    const { cells, line } = rows[index];
    if (cells.length !== first.cells.length) throw new Error(`Line ${line} has ${cells.length} fields. Expected ${first.cells.length}.`);
    const read = (column: number | null) => column === null ? '' : cells[column];
    const label = read(columns.label);
    const nodeId = read(columns.id);
    const role = read(columns.role);
    const source = read(columns.source);
    const target = read(columns.target);
    if (label.trim()) {
      try { encodeMermaidLabel(label); } catch (reason) {
        throw new Error(`Line ${line}: ${reason instanceof Error ? reason.message : 'Choose a valid label.'}`);
      }
      const chosenRole = systemRoles.find(option => option === role);
      if (role && !chosenRole) throw new Error(`Line ${line}: Choose a supported role such as service, database, or neutral.`);
      if (nodes.length >= authoringLimits.graphNodes) throw new Error('Map at most 200 systems.');
      const key = `row-${index + 1}`;
      if (nodeId.trim()) {
        if (ids.has(nodeId)) throw new Error(`Line ${line}: This node ID is already used.`);
        ids.set(nodeId, key);
      }
      nodes.push({ key, label, role: chosenRole ?? null, sourceRow: index + 1 });
    } else if (nodeId || role) throw new Error(`Line ${line}: Enter a label for this system.`);

    if (source.trim() || target.trim()) {
      if (!source.trim() || !target.trim()) throw new Error(`Line ${line}: Supply both relationship endpoints.`);
      if (unresolved.length >= 400) throw new Error('Map at most 400 relationships.');
      unresolved.push({ line, source, target });
    }
  }
  if (!nodes.length) throw new Error('Map at least one system with a label.');

  const edges = unresolved.map(({ line, source, target }) => {
    const from = ids.get(source);
    const to = ids.get(target);
    if (!from || !to) throw new Error(`Line ${line}: A relationship endpoint does not match a node ID.`);
    return { from, to };
  });
  return { nodes, edges };
}
