import { encodeMermaidLabel, type FlowchartInput } from './flowchart-source';
import type { ProcessStep } from './process-steps';

export type ProcessConnection = {
  id: string;
  from: number;
  to: number;
  label: string;
  review: 'accepted' | 'needs-review';
};

export type ProcessConnections = {
  decisions: number[];
  terminal: number[];
  edges: ProcessConnection[];
};

export const maxProcessConnections = 400;

export function adjacentConnections(steps: readonly ProcessStep[]): ProcessConnection[] {
  return steps.slice(1).map((step, index) => ({
    id: `connection-${index + 1}`, from: steps[index].line, to: step.line, label: '', review: 'accepted',
  }));
}

/** Freeze row order's implications and require a human decision on every affected continuation. */
export function markProcessDecision(
  steps: readonly ProcessStep[], connections: ProcessConnections | undefined, line: number,
): ProcessConnections {
  const position = steps.findIndex(step => step.line === line);
  if (position < 0 || connections?.decisions.includes(line)) throw new Error('Choose a process step to turn into a decision.');
  const affected = new Set(connections ? [line] : steps.slice(position).map(step => step.line));
  return {
    decisions: [...(connections?.decisions ?? []), line],
    terminal: (connections?.terminal ?? []).filter(end => end !== line),
    edges: (connections?.edges ?? adjacentConnections(steps)).map(edge => (
      affected.has(edge.from) ? { ...edge, review: 'needs-review' } : edge
    )),
  };
}

export function reviewedProcessGraph(steps: readonly ProcessStep[], connections?: ProcessConnections): FlowchartInput {
  const labels = new Map(steps.map(step => [step.line, step.label]));
  const decisions = new Set(connections?.decisions);
  const terminal = new Set(connections?.terminal);
  const edges = connections?.edges ?? adjacentConnections(steps);
  if (edges.length > maxProcessConnections) throw new Error('Use at most 400 process connections.');
  const outgoing = new Map<number, ProcessConnection[]>();
  for (const edge of edges) {
    if (!labels.has(edge.from) || !labels.has(edge.to)) throw new Error('Choose a source and destination for every connection.');
    const from = labels.get(edge.from);
    const to = labels.get(edge.to);
    if (edge.review === 'needs-review') throw new Error(`Keep or remove the connection from ${from} to ${to}.`);
    if (terminal.has(edge.from)) throw new Error(`${from} is marked as an end and cannot connect to ${to}.`);
    if (edge.label) encodeMermaidLabel(edge.label);
    const sourceEdges = outgoing.get(edge.from) ?? [];
    sourceEdges.push(edge);
    outgoing.set(edge.from, sourceEdges);
  }
  if (connections) {
    for (const { line, label } of steps) {
      const next = outgoing.get(line) ?? [];
      if (decisions.has(line)) {
        const destinations = new Set(next.map(edge => edge.to));
        const branches = new Set(next.map(edge => edge.label.trim()));
        if (next.length < 2 || destinations.size !== next.length || branches.size !== next.length || branches.has('')) {
          throw new Error(`Give ${label} at least two distinctly labeled branches to different destinations.`);
        }
      } else if (!next.length && !terminal.has(line)) {
        throw new Error(`Give ${label} a continuation or mark it as an end.`);
      }
    }
  }
  return {
    direction: 'LR',
    nodes: steps.map(step => ({ key: String(step.line), label: step.label, shape: decisions.has(step.line) ? 'diamond' : 'rect' })),
    edges: edges.map(edge => ({ from: String(edge.from), to: String(edge.to), label: edge.label })),
  };
}
