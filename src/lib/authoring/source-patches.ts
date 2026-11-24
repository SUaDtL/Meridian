import { authoringLimits, encodeMermaidLabel, shapeDelimiters, writeContainedDeclarations, writeEdgeDeclaration, writeGroupDeclaration, writeNodeDeclaration, type ConnectionDirection, type FlowchartInput, type Shape } from './flowchart-source';

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

function readSubset(source: string, allowGroups = false, unrecognized: (record: RecordSpan) => Error = unsupported) {
  const [first, ...records] = scanRecords(source);
  const direction = first && header.exec(first.text)?.[1];
  if (!direction) throw unsupported();
  const nodes = new Map<string, RecordSpan & { shape: Shape; declaration: RecordSpan }>();
  const edges: { id?: string; from: string; to: string; direction: ConnectionDirection; record: RecordSpan; label: RecordSpan }[] = [];
  const edgeIds = new Set<string>();
  const styles: { record: RecordSpan; indices: string }[] = [];
  const groups = new Map<string, string[]>();
  const groupDeclarations = new Map<string, RecordSpan>();
  const groupEndings = new Map<string, RecordSpan>();
  const parents: string[] = [];

  for (const record of records) {
    const parent = parents.length ? groups.get(parents.at(-1)!) : undefined;
    const opening = allowGroups ? subgraph.exec(record.text) : null;
    if (opening) {
      const id = opening[1];
      if (reserved.has(id) || groups.has(id) || groups.size >= authoringLimits.graphGroups) throw unsupported();
      parent?.push(id);
      groups.set(id, []);
      groupDeclarations.set(id, record);
      parents.push(id);
      continue;
    }
    if (allowGroups && record.text === 'end') {
      if (!parent?.length) throw unsupported();
      groupEndings.set(parents.pop()!, record);
      continue;
    }
    let match = node.exec(record.text);
    if (match) {
      const [, name, open, label, close] = match;
      const notation = shapesByOpening.get(open);
      if (!notation || notation.close !== close || reserved.has(name) || nodes.has(name)) throw unsupported();
      const start = record.start + name.length + open.length;
      nodes.set(name, { start, end: start + label.length, text: label, shape: notation.shape, declaration: record });
      parent?.push(name);
      continue;
    }
    if (parents.length) throw unrecognized(record);
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
    if (!match) throw unrecognized(record);
    styles.push({ record, indices: match[1] });
  }

  const endpoint = (id: string) => nodes.has(id) || groups.has(id);
  if (parents.length || [...groups.keys()].some(id => nodes.has(id) || edgeIds.has(id))
    || edges.some(({ from, to, id }) => !endpoint(from) || !endpoint(to) || (id && endpoint(id)))) throw unsupported();
  for (const { indices } of styles) {
    if (indices === 'default') continue;
    if (indices.split(',').some(index => !Number.isSafeInteger(Number(index)) || Number(index) >= edges.length)) {
      throw unsupported();
    }
  }
  return { heading: first, records, direction: direction === 'TD' ? 'TB' : direction, nodes, edges, edgeIds, styles,
    groups, groupDeclarations, groupEndings };
}

function subsetTopology({ direction, nodes, edges }: ReturnType<typeof readSubset>) {
  return {
    direction,
    nodes: Array.from(nodes, ([id, node]) => ({ id, shape: node.shape })),
    edges: edges.map(({ id, from, to, direction }) => ({ id: id ?? null, from, to, direction })),
  };
}

/** The main visual editing subset covers explicit flat flowcharts. */
export function flowchartSubsetTopology(source: string) {
  return subsetTopology(readSubset(source));
}

export function groupedFlowchartTopology(source: string) {
  const subset = readSubset(source, true);
  return { topology: subsetTopology(subset), groups: subset.groups };
}

export function componentSourceIssue(source: string) {
  let location: { from: number; to: number; line: number } | undefined;
  try {
    readSubset(source, true, record => {
      const line = source.slice(0, record.start).split('\n').length;
      location = { from: record.start, to: record.end, line };
      if (/^click[ \t]/.test(record.text)) return new Error(`Component definitions do not include click links or callbacks. Review line ${line}.`);
      if (/^(?:class|classDef|style)[ \t]/.test(record.text)) return new Error(`Component definitions do not include source styling directives. Review line ${line}.`);
      return new Error(`Meridian cannot verify this statement for a reusable component. Review line ${line}.`);
    });
    return undefined;
  } catch (reason) {
    return { message: reason instanceof Error ? reason.message : unsupported().message, location };
  }
}

export function componentSelectionTopology(source: string) {
  const parsed = readSubset(source, true);
  return { nodes: subsetTopology(parsed).nodes, groups: parsed.groups };
}

// A single solid connector per statement, optionally with inline node declarations.
// Quoted labels can contain arrows. Only the captured arrow token can change.
const rankNode = String.raw`${id}(?:(?:\(\[|\[\(|\(\(|\{\{|\[|\(|\{)(?:"[^"]*"|[A-Za-z0-9 _-]+)(?:\]\)|\)\]|\)\)|\}\}|\]|\)|\}))?`;
const rankConnection = new RegExp(String.raw`^((${rankNode})[ \t]*(?:(${id})@)?)(<--+>|--+>|---+)(?:\|(?:"[^"]*"|[^|"\r\n]+)\|)?[ \t]*(${rankNode})$`);
const rankId = new RegExp('^' + id);

/** Return offsets only after all candidate rows agree with Mermaid's accepted edges in order. */
export function rankSpanOffsets(source: string, model: readonly { start: string; end: string; id?: string; isUserDefinedId?: boolean }[]) {
  if (!model.length) return [];
  try {
    const [first, ...records] = scanRecords(source);
    if (!first || !header.test(first.text)) return [];
    const offsets: (number | undefined)[] = [];
    for (const record of records) {
      const match = rankConnection.exec(record.text);
      if (!match) continue;
      const [, prefix, from, edgeId, arrow, to] = match;
      const edge = model[offsets.length];
      if (!edge || rankId.exec(from)?.[0] !== edge.start || rankId.exec(to)?.[0] !== edge.end
        || edgeId !== (edge.isUserDefinedId ? edge.id : undefined)) return [];
      offsets.push(edge.start === edge.end ? undefined : record.start + prefix.length + arrow.length - 1);
    }
    return offsets.length === model.length ? offsets : [];
  } catch { return []; }
}

export function flowchartSourceLocations(source: string, allowGroups = false) {
  const { nodes, edges, groupDeclarations } = readSubset(source, allowGroups);
  const location = ({ start, end }: RecordSpan) => ({ from: start, to: end });
  return {
    nodes: new Map(Array.from(nodes, ([id, record]) => [id, location(record)])),
    groups: new Map(Array.from(groupDeclarations, ([id, record]) => [id, location(record)])),
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

function allocateSourceId(prefix: string, nodes: ReadonlyMap<string, unknown>, edges: ReadonlySet<string>): string {
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

export type FragmentEndpoint = { key: string } | { current: string };
export type FlowchartFragment = {
  nodes: readonly { key: string; label: string; shape: Shape }[];
  edges: readonly { key: string; from: FragmentEndpoint; to: FragmentEndpoint; label: string; direction?: ConnectionDirection }[];
  groups?: FlowchartInput['groups'];
};

/** Append verified fragment declarations while retaining all authored bytes and indices. */
export function planFlowchartFragment(source: string, fragment: FlowchartFragment) {
  const parsed = readSubset(source, true);
  const { nodes, edges, edgeIds, groups: existingGroups } = parsed;
  if (!fragment.nodes.length || nodes.size + fragment.nodes.length > authoringLimits.graphNodes
      || edges.length + fragment.edges.length > authoringLimits.graphEdges
      || existingGroups.size + (fragment.groups?.length ?? 0) > authoringLimits.graphGroups) {
    throw new Error('The combined project exceeds the supported node, connection, or group limit.');
  }
  const topology = subsetTopology(parsed);
  for (const id of existingGroups.keys()) edgeIds.add(id);
  const allocated = new Map<string, string>();
  const declarations = new Map<string, string>();
  const insertedNodes = fragment.nodes.map(item => {
    if (!item.key || allocated.has(item.key)) throw new Error('Each inserted node needs a distinct fragment key.');
    const sourceId = allocateSourceId('m_n', nodes, edgeIds);
    allocated.set(item.key, sourceId);
    edgeIds.add(sourceId);
    declarations.set(item.key, writeNodeDeclaration(sourceId, item.label, item.shape));
    return { ...item, sourceId };
  });
  const groups = (fragment.groups ?? []).map(item => {
    if (!item.key || allocated.has(item.key)) throw new Error('Each inserted group needs a distinct fragment key.');
    const sourceId = allocateSourceId('m_g', nodes, edgeIds);
    allocated.set(item.key, sourceId);
    edgeIds.add(sourceId);
    return { ...item, sourceId };
  });
  const statements = writeContainedDeclarations(declarations, groups);
  const endpoint = (item: FragmentEndpoint) => {
    const found = 'key' in item ? allocated.get(item.key) : nodes.has(item.current) ? item.current : undefined;
    if (!found) throw new Error('Choose a current node for every attachment.');
    return found;
  };
  const keys = new Set<string>();
  const insertedEdges = fragment.edges.map(item => {
    if (!item.key || keys.has(item.key)) throw new Error('Each inserted connection needs a distinct fragment key.');
    keys.add(item.key);
    const sourceId = allocateSourceId('m_e', nodes, edgeIds);
    edgeIds.add(sourceId);
    const from = endpoint(item.from);
    const to = endpoint(item.to);
    statements.push(writeEdgeDeclaration(sourceId, from, to, item.label, item.direction));
    return { ...item, sourceId, from, to };
  });
  return { topology, existingGroups, nodes: insertedNodes, edges: insertedEdges, groups: groups.map(group => ({
    ...group, members: group.members.map(key => allocated.get(key)!),
  })), patches: [appendStatements(source, ...statements)] };
}

/** Wrap a consecutive set of declarations without moving the existing source bytes. */
export function planGroupCreation(source: string, members: readonly string[], title: string) {
  const { nodes, groups, edges, edgeIds, records } = readSubset(source, true);
  const selected = new Set(members);
  if (!members.length || selected.size !== members.length || members.some(member => !nodes.has(member))) {
    throw new Error('Choose current node declarations to include in the group.');
  }
  if (nodes.size > authoringLimits.graphNodes || edges.length > authoringLimits.graphEdges || groups.size >= authoringLimits.graphGroups) {
    throw new Error('The diagram is too large for a generated group edit.');
  }
  const parentById = new Map([...groups].flatMap(([id, children]) => children.map(child => [child, id] as const)));
  const parent = parentById.get(members[0]);
  if (members.some(member => parentById.get(member) !== parent)) {
    throw new Error('Choose node declarations that share the same containing group.');
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
  for (const id of groups.keys()) edgeIds.add(id);
  const sourceId = allocateSourceId('m_g', nodes, edgeIds);
  return { sourceId, patches: [
    { from: first.start, to: first.start, expectedText: '', replacement: `${writeGroupDeclaration(sourceId, title)}${newline}${indentation}` },
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
  const flatSource = applySourcePatches(source, patches);
  const flat = readSubset(flatSource);
  if (flat.nodes.has(opening.sourceId) || flat.edgeIds.has(opening.sourceId)) throw unsupported();
  return { sourceId: opening.sourceId, patches, memberIds: memberIds as string[], flatSource };
}

export function supportedUngroupSourceId(source: string) {
  try { return groupRemovalPlan(source).sourceId; }
  catch { return undefined; }
}

function groupContents(parsed: ReturnType<typeof readSubset>, sourceId: string) {
  const children = parsed.groups.get(sourceId);
  if (!children) throw unsupported();
  const descendants = new Set<string>(children);
  for (const id of descendants) {
    for (const child of parsed.groups.get(id) ?? []) descendants.add(child);
  }
  const endpoints = new Set([sourceId, ...descendants]);
  const connections = parsed.edges.filter(edge => endpoints.has(edge.from) || endpoints.has(edge.to));
  return { descendants, endpoints, connections };
}

export function groupContentsDeletionScopes(source: string) {
  const scopes = new Map<string, { members: string[]; connections: string[]; unavailable?: string }>();
  try {
    const parsed = readSubset(source, true);
    for (const id of parsed.groups.keys()) {
      const { descendants, connections } = groupContents(parsed, id);
      try {
        groupContentsPatches(source, parsed, id, descendants);
        scopes.set(id, { members: [...descendants], connections: connections.map(item => item.id!) });
      } catch (error) {
        scopes.set(id, { members: [], connections: [], unavailable: error instanceof Error ? error.message : unsupported().message });
      }
    }
  } catch { /* Unsupported diagrams have no reviewed deletion targets. */ }
  return scopes;
}

function groupContentsPatches(source: string, parsed: ReturnType<typeof readSubset>, sourceId: string, descendants: ReadonlySet<string>) {
  const groups = [sourceId, ...[...descendants].filter(id => parsed.groups.has(id))];
  const leaves = [...descendants].filter(id => parsed.nodes.has(id));
  if (leaves.length === parsed.nodes.size) throw new Error('Keep at least one node in the diagram.');
  const parent = [...parsed.groups.values()].find(members => members.includes(sourceId));
  if (parent?.length === 1) throw new Error('Keep at least one member in the containing group.');
  const patches = groups.flatMap(id => groupWrapperPatches(source, parsed, id));
  const endpoints = new Set([sourceId, ...descendants]);
  const removed = new Set<number>();
  parsed.edges.forEach(({ id, from, to }, index) => {
    if (!endpoints.has(from) && !endpoints.has(to)) return;
    if (!id) throw new Error('An incident connection needs an explicit source ID before deleting this group and its contents.');
    removed.add(index);
  });
  return [...patches, ...leaves.map(id => replace(parsed.nodes.get(id)!.declaration, '')),
    ...planEdgeRemovals(parsed.edges, parsed.styles, removed)];
}

export function planGroupContentsRemoval(source: string, sourceId: string, memberIds: readonly string[], incidentIds: readonly string[]) {
  const parsed = readSubset(source, true);
  const { descendants, connections } = groupContents(parsed, sourceId);
  const members = new Set(memberIds);
  if (members.size !== memberIds.length || members.size !== descendants.size
    || [...descendants].some(id => !members.has(id))) throw new Error('Review every current group member before deleting its contents.');
  const patches = groupContentsPatches(source, parsed, sourceId, descendants);
  const reviewed = new Set(incidentIds);
  if (reviewed.size !== incidentIds.length || reviewed.size !== connections.length || connections.some(item => !reviewed.has(item.id!))) {
    throw new Error('Review all incident connections before deleting this group and its contents.');
  }
  return { sourceId, patches };
}

function standaloneDeclaration(source: string, declaration: RecordSpan) {
  const from = source.lastIndexOf('\n', declaration.start - 1) + 1;
  const separator = source.indexOf('\n', declaration.end);
  const to = separator === -1 ? source.length : separator + 1;
  if (!/^[ \t]*$/.test(source.slice(from, declaration.start))
    || !/^(?:;[ \t]*)?(?:%%[^\r\n]*)?$/.test(source.slice(declaration.end, to).trim())) return;
  return { from, to, separator };
}

function removeGroupWrappers(source: string, group: ReturnType<typeof readSubset>, sourceId: string) {
  if (group.edges.some(({ from, to }) => from === sourceId || to === sourceId)) {
    throw new Error('A group with a connection on its container cannot be ungrouped. Review that connection first.');
  }
  return groupWrapperPatches(source, group, sourceId);
}

function groupWrapperPatches(source: string, group: ReturnType<typeof readSubset>, sourceId: string) {
  const opening = group.groupDeclarations.get(sourceId);
  const ending = group.groupEndings.get(sourceId);
  if (!opening || !ending) throw unsupported();
  return [opening, ending].map(record => {
    const line = standaloneDeclaration(source, record);
    if (!line) throw unsupported();
    const tail = source.slice(record.end, line.to);
    const comment = tail.indexOf('%%');
    if (comment >= 0) {
      const to = record.end + tail.slice(0, comment).indexOf(';') + 1;
      return { from: record.start, to, expectedText: source.slice(record.start, to), replacement: '' };
    }
    return { from: line.from, to: line.to, expectedText: source.slice(line.from, line.to), replacement: '' };
  });
}

/** Remove a proven container while retaining all source inside it. */
export function planGroupRemoval(source: string, sourceId: string) {
  const parsed = readSubset(source, true);
  return { sourceId, patches: removeGroupWrappers(source, parsed, sourceId), memberIds: parsed.groups.get(sourceId)! };
}

export function supportedGroupRemovals(source: string) {
  try {
    const parsed = readSubset(source, true);
    return [...parsed.groups.keys()].filter(sourceId => {
      try { removeGroupWrappers(source, parsed, sourceId); return true; }
      catch { return false; }
    });
  } catch { return []; }
}

export function supportedGroupMoves(source: string, groupId: string) {
  return supportedGroupMoveTargets(source).get(groupId) ?? [];
}

export function supportedGroupMoveTargets(source: string): ReadonlyMap<string, string[]> {
  try {
    const parsed = readSubset(source, true);
    const nodes = [...parsed.nodes.keys()];
    return new Map([...parsed.groups.keys()].flatMap(groupId => {
      const eligible = nodes.filter(id => !!groupMoveLines(source, parsed, id, groupId));
      return eligible.length ? [[groupId, eligible] as const] : [];
    }));
  } catch { return new Map(); }
}

function groupMoveLines(source: string, parsed: ReturnType<typeof readSubset>, sourceId: string, groupId: string) {
  const ending = parsed.groupEndings.get(groupId);
  const closingLine = ending && standaloneDeclaration(source, ending);
  if (!closingLine) return;
  const currentGroup = [...parsed.groups].find(([, members]) => members.includes(sourceId));
  if (currentGroup?.[0] === groupId || currentGroup?.[1].length === 1) return;
  const declaration = parsed.nodes.get(sourceId)?.declaration;
  const nodeLine = declaration && standaloneDeclaration(source, declaration);
  if (nodeLine) return { nodeLine, insertion: closingLine.from };
}

/** Move a standalone declaration into an explicitly named group. */
export function planMoveToGroup(source: string, sourceId: string, groupId: string) {
  const parsed = readSubset(source, true);
  if (parsed.groups.get(groupId)?.includes(sourceId)) throw new Error('Choose an outside node or a different destination group.');
  const move = groupMoveLines(source, parsed, sourceId, groupId);
  if (!move) throw new Error('Choose a node declaration on its own source line and keep at least one member in its current group.');
  const { from, to, separator } = move.nodeLine;
  const text = source.slice(from, to);
  const newline = source.match(/\r?\n/)?.[0] ?? '\n';
  return { sourceId, patches: [
    { from, to, expectedText: text, replacement: '' },
    { from: move.insertion, to: move.insertion, expectedText: '', replacement: separator === -1 ? text + newline : text },
  ] };
}

/** Plan an exact label replacement for the explicit-declaration spike. The caller still needs the Mermaid oracle. */
export function planNodeLabel(source: string, nodeId: string, label: string): SourcePatch[] {
  const span = readSubset(source, true).nodes.get(nodeId);
  if (!span) throw unsupported();
  const replacement = encodeMermaidLabel(label);
  const literal = span.text.startsWith('"') ? span.text.slice(1, -1) : span.text;
  if (replacement === span.text || (label === literal && !literal.includes('#'))) return [];
  return [replace(span, replacement)];
}

/** Replace only the label token associated with the exact explicit edge ID. */
export function planEdgeLabel(source: string, edgeId: string, label: string): SourcePatch[] {
  const item = edgeId && readSubset(source, true).edges.find(edge => edge.id === edgeId);
  if (!item) throw new Error('Choose a connection with an explicit source ID.');
  const encoded = label ? `|${encodeMermaidLabel(label)}|` : '';
  return item.label.text === encoded ? [] : [replace(item.label, encoded)];
}

/** Remove one explicitly identified edge and repair affected linkStyle ordinals. */
export function planEdgeRemoval(source: string, edgeId: string): SourcePatch[] {
  return planEdgeSelectionRemoval(source, [edgeId]);
}

/** Resolve the complete selection before changing any source span. */
export function planEdgeSelectionRemoval(source: string, edgeIds: readonly string[]): SourcePatch[] {
  const { edges, styles } = readSubset(source);
  const selection = new Set(edgeIds);
  if (!selection.size || selection.size !== edgeIds.length) throw unsupported();
  const removed = new Set<number>();
  edges.forEach((edge, index) => { if (edge.id && selection.delete(edge.id)) removed.add(index); });
  if (selection.size) throw unsupported();
  return planEdgeRemovals(edges, styles, removed);
}

/** Delete a declared node only when the supplied IDs cover every incident edge. */
export function planNodeRemoval(source: string, nodeId: string, incidentIds: readonly string[]): SourcePatch[] {
  return planNodeRemovals(source, [nodeId], incidentIds);
}

function planNodeRemovals(source: string, nodeIds: readonly string[], incidentIds: readonly string[]): SourcePatch[] {
  const { nodes, edges, styles } = readSubset(source);
  const selection = new Set(nodeIds);
  if (!selection.size || selection.size !== nodeIds.length) throw unsupported();
  const declarations = nodeIds.map(id => {
    const node = nodes.get(id);
    if (!node) throw unsupported();
    return replace(node.declaration, '');
  });
  if (nodes.size === selection.size) throw new Error('Keep at least one node in the diagram.');
  const review = () => new Error('Review all incident connections before deleting this node.');
  const expected = new Set(incidentIds);
  const removed = new Set<number>();
  edges.forEach((edge, index) => {
    if (!selection.has(edge.from) && !selection.has(edge.to)) return;
    if (!edge.id) throw new Error('An incident connection needs an explicit source ID before deleting this node.');
    if (!expected.delete(edge.id)) throw review();
    removed.add(index);
  });
  if (expected.size || incidentIds.length !== removed.size) throw review();
  return [...declarations, ...planEdgeRemovals(edges, styles, removed)];
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
