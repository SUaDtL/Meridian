import type { ElementStyle } from '../../types/design';

export const authoringLimits = {
  sourceCodeUnits: 100_000,
  labelCodePoints: 200,
  graphNodes: 200,
  graphEdges: 500,
  graphGroups: 10,
} as const;

export type Shape = NonNullable<ElementStyle['shape']>;
type Direction = 'TB' | 'BT' | 'LR' | 'RL';
export type ConnectionDirection = 'forward' | 'both' | 'none';
const connectionNotation: Record<ConnectionDirection, string> = { forward: '-->', both: '<-->', none: '---' };
export const flowchartEngineConnections: Record<ConnectionDirection, string> = {
  forward: 'arrow_point', both: 'double_arrow_point', none: 'arrow_open',
};

export const shapeDelimiters: Record<Shape, readonly [string, string]> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  stadium: ['([', '])'],
  diamond: ['{', '}'],
  circle: ['((', '))'],
  cylinder: ['[(', ')]'],
  hexagon: ['{{', '}}'],
};
export const flowchartEngineShapes: Record<Shape, string> = {
  rect: 'square', rounded: 'round', stadium: 'stadium', diamond: 'diamond',
  circle: 'circle', cylinder: 'cylinder', hexagon: 'hexagon',
};
const delimiters = new Set('"\\#&<>[]{}()|`;%');
const directions = new Set<Direction>(['TB', 'BT', 'LR', 'RL']);

export function writeNodeDeclaration(id: string, label: string, shape: Shape): string {
  if (!Object.hasOwn(shapeDelimiters, shape)) throw new Error('Choose a supported node shape.');
  const [opening, closing] = shapeDelimiters[shape];
  return `${id}${opening}${encodeMermaidLabel(label)}${closing}`;
}

export function writeEdgeDeclaration(
  id: string, from: string, to: string, label?: string, direction: ConnectionDirection = 'forward',
): string {
  if (!Object.hasOwn(connectionNotation, direction)) throw new Error('Choose a supported connection direction.');
  const labelToken = label ? `|${encodeMermaidLabel(label)}|` : '';
  return `${from} ${id}@${connectionNotation[direction]}${labelToken} ${to}`;
}

export function writeGroupDeclaration(id: string, label: string) {
  return `subgraph ${id} [${encodeMermaidLabel(label)}]`;
}

type FlowchartGroup = { key: string; label: string; members: readonly string[] };
export interface FlowchartInput {
  direction: Direction;
  nodes: readonly { key: string; label: string; shape?: Shape }[];
  edges: readonly { from: string; to: string; label?: string; direction?: ConnectionDirection }[];
  groups?: readonly FlowchartGroup[];
}

export interface GeneratedFlowchart {
  source: string;
  nodeIds: ReadonlyMap<string, string>;
  edgeIds: readonly string[];
  groupIds: ReadonlyMap<string, string>;
}

/** A single pass is necessary to avoid re-encoding the entities we introduce. */
export function encodeMermaidLabel(value: string): string {
  let encoded = '"';
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (++length > authoringLimits.labelCodePoints) throw new Error('Use at most 200 characters in a label.');
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint === 0x2028 || codePoint === 0x2029) {
      throw new Error('Use one line of well-formed text without control characters.');
    }
    encoded += delimiters.has(character) ? `#${codePoint};` : character;
  }
  if (!length) throw new Error('Enter a label.');
  return encoded + '"';
}

/** Emit containment using reviewed local keys, writing each declaration once. */
export function writeContainedDeclarations(
  nodes: ReadonlyMap<string, string>, groups: readonly (FlowchartGroup & { sourceId: string })[],
) {
  if (groups.length > authoringLimits.graphGroups) throw new Error('Create a flowchart with up to 10 groups.');
  const byGroup = new Map(groups.map(group => [group.key, group]));
  const keys = new Set([...nodes.keys(), ...byGroup.keys()]);
  if (groups.some(group => !group.key) || keys.size !== nodes.size + groups.length) {
    throw new Error('Nodes and groups need distinct input keys.');
  }
  const parents = new Set<string>();
  for (const group of groups) {
    if (!group.members.length) throw new Error('Every group needs at least one member.');
    for (const member of group.members) {
      if (!keys.has(member) || parents.has(member)) throw new Error('Every group member must exist and have one parent.');
      parents.add(member);
    }
  }
  const statements: string[] = [];
  let emitted = 0;
  function emit(key: string, depth: number) {
    const indentation = '  '.repeat(depth);
    const node = nodes.get(key);
    if (node) {
      statements.push(indentation + node);
      return;
    }
    const group = byGroup.get(key)!;
    emitted++;
    statements.push(indentation + writeGroupDeclaration(group.sourceId, group.label));
    for (const member of group.members) emit(member, depth + 1);
    statements.push(indentation + 'end');
  }
  for (const key of keys) if (!parents.has(key)) emit(key, 0);
  if (emitted !== groups.length) throw new Error('Group membership must be acyclic.');
  return statements;
}

/** Write a new top-level graph from explicit topology. Existing source never passes through this writer. */
export function writeFlowchart(input: FlowchartInput): GeneratedFlowchart {
  if (!directions.has(input.direction)) throw new Error('Choose a flowchart direction.');
  const groups = input.groups ?? [];
  if (!input.nodes.length || input.nodes.length > authoringLimits.graphNodes
    || input.edges.length > authoringLimits.graphEdges) {
    throw new Error('Create a flowchart with 1–200 nodes and up to 500 connections.');
  }

  const sourceLines = [`flowchart ${input.direction}`];
  const nodeIds = new Map<string, string>();
  const declarations = new Map<string, string>();
  const edgeIds: string[] = [];
  for (const node of input.nodes) {
    if (!node.key || nodeIds.has(node.key)) throw new Error('Every node needs a distinct input key.');
    const id = `m_n${nodeIds.size + 1}`;
    declarations.set(node.key, writeNodeDeclaration(id, node.label, node.shape ?? 'rect'));
    nodeIds.set(node.key, id);
  }
  const boundGroups = groups.map((group, index) => ({ ...group, sourceId: `m_g${index + 1}` }));
  const groupIds = new Map(boundGroups.map(({ key, sourceId }) => [key, sourceId]));
  const endpoints = new Map([...nodeIds, ...groupIds]);
  for (const statement of writeContainedDeclarations(declarations, boundGroups)) sourceLines.push('  ' + statement);
  for (const edge of input.edges) {
    const from = endpoints.get(edge.from);
    const to = endpoints.get(edge.to);
    if (!from || !to) throw new Error('Choose two existing nodes or groups for each connection.');
    const id = `m_e${edgeIds.length + 1}`;
    sourceLines.push('  ' + writeEdgeDeclaration(id, from, to, edge.label, edge.direction));
    edgeIds.push(id);
  }
  const source = sourceLines.join('\n') + '\n';
  if (source.length > authoringLimits.sourceCodeUnits) throw new Error('Reduce the number or length of labels to fit the source limit.');
  return { source, nodeIds, edgeIds, groupIds };
}

/** Compare logical input to the exact labels read from the sanitized candidate. */
export function verifyNodeLabels(
  input: FlowchartInput,
  candidate: GeneratedFlowchart,
  visibleLabels: ReadonlyMap<string, string>,
): void {
  if (visibleLabels.size !== input.nodes.length) {
    throw new Error('The preview did not contain the expected nodes. Keep your draft and check the diagram.');
  }
  for (const [index, node] of input.nodes.entries()) {
    const sourceId = candidate.nodeIds.get(node.key);
    if (!sourceId || visibleLabels.get(sourceId) !== node.label) {
      throw new Error(`The renderer could not display node ${index + 1}'s label exactly. Change that label and preview again.`);
    }
  }
}
