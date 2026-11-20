import type { ElementStyle } from '../../types/design';

export const authoringLimits = {
  sourceCodeUnits: 100_000,
  labelCodePoints: 200,
  graphNodes: 200,
  graphEdges: 500,
} as const;

export type Shape = NonNullable<ElementStyle['shape']>;
type Direction = 'TB' | 'BT' | 'LR' | 'RL';

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

export function writeEdgeDeclaration(id: string, from: string, to: string, label?: string): string {
  const labelToken = label ? `|${encodeMermaidLabel(label)}|` : '';
  return `${from} ${id}@-->${labelToken} ${to}`;
}

export interface FlowchartInput {
  direction: Direction;
  nodes: readonly { key: string; label: string; shape?: Shape }[];
  edges: readonly { from: string; to: string; label?: string }[];
}

export interface GeneratedFlowchart {
  source: string;
  nodeIds: ReadonlyMap<string, string>;
  edgeIds: readonly string[];
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

/** Write a new top-level graph from explicit topology. Existing source never passes through this writer. */
export function writeFlowchart(input: FlowchartInput): GeneratedFlowchart {
  if (!directions.has(input.direction)) throw new Error('Choose a flowchart direction.');
  if (!input.nodes.length || input.nodes.length > authoringLimits.graphNodes
    || input.edges.length > authoringLimits.graphEdges) {
    throw new Error('Create a flowchart with 1–200 nodes and up to 500 connections.');
  }

  const sourceLines = [`flowchart ${input.direction}`];
  const nodeIds = new Map<string, string>();
  const edgeIds: string[] = [];
  for (const node of input.nodes) {
    if (!node.key || nodeIds.has(node.key)) throw new Error('Every node needs a distinct input key.');
    const id = `m_n${nodeIds.size + 1}`;
    sourceLines.push('  ' + writeNodeDeclaration(id, node.label, node.shape ?? 'rect'));
    nodeIds.set(node.key, id);
  }
  for (const edge of input.edges) {
    const from = nodeIds.get(edge.from);
    const to = nodeIds.get(edge.to);
    if (!from || !to) throw new Error('Choose two existing nodes for each connection.');
    const id = `m_e${edgeIds.length + 1}`;
    sourceLines.push('  ' + writeEdgeDeclaration(id, from, to, edge.label));
    edgeIds.push(id);
  }
  const source = sourceLines.join('\n') + '\n';
  if (source.length > authoringLimits.sourceCodeUnits) throw new Error('Reduce the number or length of labels to fit the source limit.');
  return { source, nodeIds, edgeIds };
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
