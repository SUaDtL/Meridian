import { authoringLimits, encodeMermaidLabel, shapeDelimiters, writeEdgeDeclaration, writeNodeDeclaration, type ConnectionDirection, type Shape } from './flowchart-source';

export interface SourcePatch {
  from: number;
  to: number;
  expectedText: string;
  replacement: string;
}

interface RecordSpan {
  start: number;
  end: number;
  text: string;
}

const unsupported = () => new Error('This source uses syntax outside the supported editing subset. Edit it in the source panel.');
const id = '[A-Za-z_][A-Za-z_0-9]*';
const header = /^(?:flowchart|graph)[ \t]+(TB|TD|BT|LR|RL)$/;
const edgeDirections = { '-->': 'forward', '<-->': 'both', '---': 'none' } as const;
const edge = new RegExp(`^(${id})[ \t]+(?:(${id})@)?(<-->|-->|---)(\\|"[^"]*"\\|)?([ \t]+)(${id})$`);
const subgraph = new RegExp(`^subgraph[ \t]+(${id})[ \t]+\\[(?:"[^"]*"|[A-Za-z0-9 _-]+)\\]$`);
const node = new RegExp(`^(${id})(\\(\\[|\\[\\(|\\(\\(|\\{\\{|\\[|\\(|\\{)("[^"]*"|[A-Za-z0-9 _-]+)(\\]\\)|\\)\\]|\\)\\)|\\}\\}|\\]|\\)|\\})$`);
const shapesByOpening = new Map(Object.entries(shapeDelimiters).map(([shape, [open, close]]) => [open, { shape: shape as Shape, close }]));
const reserved = new Set(['end', 'subgraph', 'flowchart', 'graph', 'class', 'classDef', 'style', 'click', 'linkStyle', 'direction']);
const indexedStyle = /^linkStyle[ \t]+(default|\d+(?:,\d+)*)(?=[ \t]|$)[ \t]+([^;%]+)$/;
const recordLimit = 40_000;

/**
 * Retain exact offsets while recognizing top-level separators only. This first
 * subset admits quoted literals, ASCII labels, and standalone/inline comments.
 */
function scanRecords(source: string): RecordSpan[] {
  if (source.length > authoringLimits.sourceCodeUnits) throw unsupported();
  const records: RecordSpan[] = [];
  let start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let quoted = false;
  let comment = false;
  let depth = 0;

  const finish = (end: number) => {
    let from = start;
    let to = end;
    while (from < to && (source[from] === ' ' || source[from] === '\t')) from++;
    while (to > from && (source[to - 1] === ' ' || source[to - 1] === '\t')) to--;
    if (from === to) return;
    if (records.length === recordLimit) throw unsupported();
    records.push({ start: from, end: to, text: source.slice(from, to) });
  };

  for (let position = start; position < source.length; position++) {
    const character = source[position];
    if (character === '\n' || (character === '\r' && source[position + 1] === '\n')) {
      if (quoted || depth) throw unsupported();
      if (!comment) finish(position);
      if (character === '\r') position++;
      start = position + 1;
      comment = false;
      continue;
    }
    if (comment) continue;
    if ('\r\u2028\u2029'.includes(character)) throw unsupported();
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (source.startsWith('%%', position) && depth === 0) {
      if (source[position + 2] === '{') throw unsupported();
      finish(position);
      comment = true;
    } else if ('([{'.includes(character)) {
      if (++depth > 2) throw unsupported();
    } else if (')]}'.includes(character)) {
      if (--depth < 0) throw unsupported();
    } else if (character === ';' && depth === 0) {
      finish(position);
      start = position + 1;
    }
  }
  if (quoted || depth) throw unsupported();
  if (!comment) finish(source.length);
  return records;
}

function readSubset(source: string) {
  const [first, ...records] = scanRecords(source);
  const direction = first && header.exec(first.text)?.[1];
  if (!direction) throw unsupported();
  const nodes = new Map<string, RecordSpan & { shape: Shape; declaration: RecordSpan }>();
  const edges: { id?: string; from: string; to: string; direction: ConnectionDirection; record: RecordSpan; label: RecordSpan }[] = [];
  const edgeIds = new Set<string>();
  const styles: { record: RecordSpan; indices: string }[] = [];

  for (const record of records) {
    let match = node.exec(record.text);
    if (match) {
      const [, name, open, label, close] = match;
      const notation = shapesByOpening.get(open);
      if (!notation || notation.close !== close || reserved.has(name) || nodes.has(name)) throw unsupported();
      const start = record.start + name.length + open.length;
      nodes.set(name, { start, end: start + label.length, text: label, shape: notation.shape, declaration: record });
      continue;
    }
    match = edge.exec(record.text);
    if (match) {
      const [, from, edgeId, arrow, token = '', gap, to] = match;
      if (edgeId && (edgeIds.has(edgeId) || reserved.has(edgeId))) throw unsupported();
      if (edgeId) edgeIds.add(edgeId);
      const end = record.end - gap.length - to.length;
      edges.push({ id: edgeId, from, to, direction: edgeDirections[arrow as keyof typeof edgeDirections], record, label: { start: end - token.length, end, text: token } });
      continue;
    }
    match = indexedStyle.exec(record.text);
    if (!match) throw unsupported();
    styles.push({ record, indices: match[1] });
  }

  if (edges.some(({ from, to, id }) => !nodes.has(from) || !nodes.has(to) || (id && nodes.has(id)))) throw unsupported();
  for (const { indices } of styles) {
    if (indices === 'default') continue;
    if (indices.split(',').some(index => !Number.isSafeInteger(Number(index)) || Number(index) >= edges.length)) {
      throw unsupported();
    }
  }
  return { heading: first, records, direction: direction === 'TD' ? 'TB' : direction, nodes, edges, edgeIds, styles };
}

/** Only the source editor may handle undeclared nodes, groups or opaque directives. */
export function flowchartSubsetTopology(source: string) {
  const { direction, nodes, edges } = readSubset(source);
  return {
    direction,
    nodes: Array.from(nodes, ([id, node]) => ({ id, shape: node.shape })),
    edges: edges.map(({ id, from, to, direction }) => ({ id: id ?? null, from, to, direction })),
  };
}

export function flowchartSourceLocations(source: string) {
  const { nodes, edges } = readSubset(source);
  const location = ({ start, end }: RecordSpan) => ({ from: start, to: end });
  return {
    nodes: new Map(Array.from(nodes, ([id, record]) => [id, location(record)])),
    edges: new Map(edges.flatMap(({ id, record }) => id ? [[id, location(record)] as const] : [])),
  };
}

export type FlowchartDirection = 'TB' | 'BT' | 'LR' | 'RL';

export function planFlowchartDirection(source: string, direction: FlowchartDirection): SourcePatch[] {
  if (!['TB', 'BT', 'LR', 'RL'].includes(direction)) throw new Error('Choose a supported flowchart direction.');
  const parsed = readSubset(source);
  if (parsed.direction === direction) return [];
  const to = parsed.heading.end;
  return [{ from: to - 2, to, expectedText: source.slice(to - 2, to), replacement: direction }];
}

function replace(span: RecordSpan, replacement: string): SourcePatch {
  return { from: span.start, to: span.end, expectedText: span.text, replacement };
}

function appendStatements(source: string, ...statements: string[]): SourcePatch {
  const newline = source.match(/\r?\n/)?.[0] ?? '\n';
  const separator = source.endsWith('\n') ? '' : newline;
  return { from: source.length, to: source.length, expectedText: '', replacement: separator + statements.map(statement => '  ' + statement + newline).join('') };
}

function allocateSourceId(prefix: string, nodes: ReadonlyMap<string, RecordSpan>, edges: ReadonlySet<string>): string {
  let ordinal = 1;
  while (nodes.has(prefix + ordinal) || edges.has(prefix + ordinal)) ordinal++;
  return prefix + ordinal;
}

/** Candidate-only plans for the explicitly declared top-level subset. */
export function planNodeAddition(source: string, label: string, shape: Shape = 'rect') {
  const { nodes, edges, edgeIds } = readSubset(source);
  if (nodes.size >= authoringLimits.graphNodes || edges.length > authoringLimits.graphEdges) {
    throw new Error('The diagram is too large for a generated edit.');
  }
  const sourceId = allocateSourceId('m_n', nodes, edgeIds);
  return { sourceId, patches: [appendStatements(source, writeNodeDeclaration(sourceId, label, shape))] };
}

export function planEdgeAddition(source: string, from: string, to: string, label?: string, direction?: ConnectionDirection) {
  const { nodes, edges, edgeIds } = readSubset(source);
  if (!nodes.has(from) || !nodes.has(to)) throw new Error('Choose two declared nodes to connect.');
  if (edges.length >= authoringLimits.graphEdges || nodes.size > authoringLimits.graphNodes) {
    throw new Error('The diagram is too large for a generated edit.');
  }
  const sourceId = allocateSourceId('m_e', nodes, edgeIds);
  return { sourceId, patches: [appendStatements(source, writeEdgeDeclaration(sourceId, from, to, label, direction))] };
}

export function planAddNext(source: string, anchor: string, label: string, shape: Shape, edgeLabel: string | undefined, incoming: boolean) {
  const { nodes, edges, edgeIds } = readSubset(source);
  if (!nodes.has(anchor)) throw unsupported();
  if (nodes.size >= authoringLimits.graphNodes || edges.length >= authoringLimits.graphEdges) {
    throw new Error('The diagram is too large to add a step and connection together.');
  }
  const sourceId = allocateSourceId('m_n', nodes, edgeIds);
  const edgeId = allocateSourceId('m_e', nodes, edgeIds);
  const from = incoming ? sourceId : anchor;
  const to = incoming ? anchor : sourceId;
  return { sourceId, edgeId, from, to, patches: [appendStatements(source,
    writeNodeDeclaration(sourceId, label, shape), writeEdgeDeclaration(edgeId, from, to, edgeLabel))] };
}

/** Wrap a consecutive set of declarations without moving the existing source bytes. */
export function planGroupCreation(source: string, members: readonly string[], title: string) {
  const { nodes, edges, edgeIds, records } = readSubset(source);
  const selected = new Set(members);
  if (!members.length || selected.size !== members.length || members.some(member => !nodes.has(member))) {
    throw new Error('Choose current node declarations to include in the group.');
  }
  if (nodes.size > authoringLimits.graphNodes || edges.length > authoringLimits.graphEdges) {
    throw new Error('The diagram is too large for a generated group edit.');
  }
  const declarations = new Set([...nodes].filter(([key]) => selected.has(key)).map(([, record]) => record.declaration));
  const ordered = [...declarations];
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (records.some(record => record.start >= first.start && record.end <= last.end && !declarations.has(record))) {
    throw new Error('Choose consecutive node declarations without other statements between them.');
  }
  const lineStart = source.lastIndexOf('\n', first.start - 1) + 1;
  const indentation = source.slice(lineStart, first.start);
  const lastSeparator = source.indexOf('\n', last.end);
  const insertion = lastSeparator === -1 ? source.length : lastSeparator + 1;
  const trailing = source.slice(last.end, lastSeparator === -1 ? source.length : lastSeparator).trim();
  if (!/^[ \t]*$/.test(indentation) || !/^(?:;[ \t]*)?(?:%%[^\r\n]*)?$/.test(trailing)) {
    throw new Error('Choose consecutive declarations with the first and last declarations on their own lines.');
  }
  const newline = source.match(/\r?\n/)?.[0] ?? '\n';
  const sourceId = allocateSourceId('m_g', nodes, edgeIds);
  return { sourceId, patches: [
    { from: first.start, to: first.start, expectedText: '', replacement: `subgraph ${sourceId} [${encodeMermaidLabel(title)}]${newline}${indentation}` },
    { from: insertion, to: insertion, expectedText: '', replacement: `${lastSeparator === -1 ? newline : ''}${indentation}end${newline}` },
  ] };
}

function groupRemovalPlan(source: string) {
  const records = scanRecords(source);
  const openings = records.flatMap((record, position) => {
    const group = subgraph.exec(record.text);
    return group ? [{ sourceId: group[1], record, position }] : [];
  });
  const endings = records.flatMap((record, position) => record.text === 'end' ? [{ record, position }] : []);
  const [opening] = openings;
  const [ending] = endings;
  if (openings.length !== 1 || endings.length !== 1 || ending.position <= opening.position + 1) throw unsupported();
  const memberIds = records.slice(opening.position + 1, ending.position).map(record => node.exec(record.text)?.[1]);
  if (memberIds.some(member => !member)) throw unsupported();
  const patches = [opening.record, ending.record].map(record => {
    const from = source.lastIndexOf('\n', record.start - 1) + 1;
    const separator = source.indexOf('\n', record.end);
    const to = separator === -1 ? source.length : separator + 1;
    if (!/^[ \t]*$/.test(source.slice(from, record.start)) || source.slice(record.end, to).trim()) throw unsupported();
    return { from, to, expectedText: source.slice(from, to), replacement: '' };
  });
  const flat = readSubset(applySourcePatches(source, patches));
  if (flat.nodes.has(opening.sourceId) || flat.edgeIds.has(opening.sourceId)) throw unsupported();
  return { sourceId: opening.sourceId, patches, memberIds: memberIds as string[] };
}

export function supportedUngroupSourceId(source: string) {
  try { return groupRemovalPlan(source).sourceId; }
  catch { return undefined; }
}

/** Remove only a single, explicit top-level group's wrappers and verify all remaining statements. */
export function planGroupRemoval(source: string, sourceId: string) {
  const plan = groupRemovalPlan(source);
  if (plan.sourceId !== sourceId) throw unsupported();
  return plan;
}

/** Plan an exact label replacement for the explicit-declaration spike. The caller still needs the Mermaid oracle. */
export function planNodeLabel(source: string, nodeId: string, label: string): SourcePatch[] {
  const span = readSubset(source).nodes.get(nodeId);
  if (!span) throw unsupported();
  const replacement = encodeMermaidLabel(label);
  const literal = span.text.startsWith('"') ? span.text.slice(1, -1) : span.text;
  if (replacement === span.text || (label === literal && !literal.includes('#'))) return [];
  return [replace(span, replacement)];
}

/** Replace only the label token associated with the exact explicit edge ID. */
export function planEdgeLabel(source: string, edgeId: string, label: string): SourcePatch[] {
  const item = edgeId && readSubset(source).edges.find(edge => edge.id === edgeId);
  if (!item) throw new Error('Choose a connection with an explicit source ID.');
  const encoded = label ? `|${encodeMermaidLabel(label)}|` : '';
  return item.label.text === encoded ? [] : [replace(item.label, encoded)];
}

/** Remove one explicitly identified edge and repair affected linkStyle ordinals. */
export function planEdgeRemoval(source: string, edgeId: string): SourcePatch[] {
  const { edges, styles } = readSubset(source);
  const removed = edgeId ? edges.findIndex(edge => edge.id === edgeId) : -1;
  if (removed === -1) throw unsupported();
  return planEdgeRemovals(edges, styles, new Set([removed]));
}

/** Delete a declared node only when the supplied IDs cover every incident edge. */
export function planNodeRemoval(source: string, nodeId: string, incidentIds: readonly string[]): SourcePatch[] {
  const { nodes, edges, styles } = readSubset(source);
  const node = nodes.get(nodeId);
  if (!node) throw unsupported();
  if (nodes.size === 1) throw new Error('Keep at least one node in the diagram.');
  const expected = new Set(incidentIds);
  const removed = new Set<number>();
  edges.forEach((edge, index) => {
    if (edge.from !== nodeId && edge.to !== nodeId) return;
    if (!edge.id) throw new Error('An incident connection needs an explicit source ID before this node can be deleted.');
    if (!expected.delete(edge.id)) throw new Error('Review all incident connections before deleting this node.');
    removed.add(index);
  });
  if (expected.size || incidentIds.length !== removed.size) throw new Error('Review all incident connections before deleting this node.');
  return [replace(node.declaration, ''), ...planEdgeRemovals(edges, styles, removed)];
}

function planEdgeRemovals(
  edges: ReturnType<typeof readSubset>['edges'], styles: ReturnType<typeof readSubset>['styles'], removed: ReadonlySet<number>,
): SourcePatch[] {
  const patches: SourcePatch[] = [];
  const ordinals = edges.map(({ record }, index) => {
    if (!removed.has(index)) return index - patches.length;
    patches.push(replace(record, ''));
    return -1;
  });
  for (const { record, indices } of styles) {
    if (indices === 'default') continue;
    const remaining = indices.split(',').flatMap(value => {
      const index = Number(value);
      const next = ordinals[index];
      if (next === -1) return [];
      return [next === index ? value : String(next)];
    });
    const replacement = remaining.join(',');
    if (replacement === indices) continue;
    if (!replacement) {
      patches.push(replace(record, ''));
      continue;
    }
    const from = record.start + /^linkStyle[ \t]+/.exec(record.text)![0].length;
    patches.push({ from, to: from + indices.length, expectedText: indices, replacement });
  }
  return patches;
}

/** Check all preconditions against the original string before producing a candidate. */
export function applySourcePatches(source: string, patches: readonly SourcePatch[]): string {
  const ordered = [...patches].sort((left, right) => left.from - right.from);
  const parts: string[] = [];
  let last = 0;
  let previousStart = -1;
  let length = source.length;
  for (const patch of ordered) {
    if (!Number.isSafeInteger(patch.from) || !Number.isSafeInteger(patch.to)
      || patch.from < last || patch.from === previousStart || patch.to < patch.from || patch.to > source.length
      || source.slice(patch.from, patch.to) !== patch.expectedText) {
      throw new Error('The diagram changed. Rebuild the proposed source edit.');
    }
    length += patch.replacement.length - (patch.to - patch.from);
    parts.push(source.slice(last, patch.from), patch.replacement);
    previousStart = patch.from;
    last = patch.to;
  }
  if (length > authoringLimits.sourceCodeUnits) throw new Error('The proposed edit exceeds the source limit.');
  return parts.join('') + source.slice(last);
}
