import { autocompletion, snippetCompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { authoringLimits } from './flowchart-source';
import { flowchartSourceLocations } from './source-patches';

const startOfStatement = /^[ \t]*([A-Za-z_][A-Za-z_0-9-]*)?$/;
const diagramHeader = /^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|classDiagram|erDiagram|mindmap|gantt|timeline|journey|pie)(?:\s|$)/m;
const targetPosition = /^[ \t]*([A-Za-z_][A-Za-z_0-9]*)[ \t]+(?:[A-Za-z_][A-Za-z_0-9]*@)?-->(?:\|"[^"]*"\|)?[ \t]+([A-Za-z_][A-Za-z_0-9]*)?$/;
const openingStatements = [
  snippetCompletion('flowchart ${LR}', { label: 'flowchart', detail: 'Flowchart direction', type: 'keyword' }),
  { label: 'sequenceDiagram', detail: 'Sequence diagram', type: 'keyword' },
  { label: 'stateDiagram-v2', detail: 'State diagram', type: 'keyword' },
  { label: 'classDiagram', detail: 'Class diagram', type: 'keyword' },
  { label: 'erDiagram', detail: 'Entity relationship diagram', type: 'keyword' },
];
const flowchartStatements = [
  snippetCompletion('${NodeId}["${Label}"]', { label: 'node', detail: 'Node declaration', type: 'keyword' }),
  snippetCompletion('subgraph ${GroupId} ["${Title}"]\n\t${}\nend', { label: 'subgraph', detail: 'Group with a label', type: 'keyword' }),
  snippetCompletion('linkStyle ${default} stroke:${#556677}', { label: 'linkStyle', detail: 'Connection appearance', type: 'keyword' }),
];

function atPrefix(options: readonly Completion[], prefix: string, position: number, explicit: boolean) {
  if (!explicit && prefix.length < 2) return null;
  const needle = prefix.toLowerCase();
  const matching = options.filter(option => option.label.toLowerCase().startsWith(needle));
  return matching.length ? { from: position - prefix.length, options: matching, filter: false } as const : null;
}

function emptyOrComments(text: string) {
  return text.split('\n').every(line => /^[ \t]*(?:%%(?!\{).*)?$/.test(line));
}

function sourceCompletions(context: CompletionContext) {
  const { state, pos, explicit } = context;
  if (context.aborted || context.view?.composing || state.selection.ranges.length !== 1
    || state.doc.length > authoringLimits.sourceCodeUnits) return null;
  const line = state.doc.lineAt(pos);
  if (state.doc.sliceString(pos, line.to).trim()) return null;
  const prefix = state.doc.sliceString(line.from, pos);
  const statement = startOfStatement.exec(prefix);
  const endpoint = targetPosition.exec(prefix);
  if (!statement && !endpoint) return null;
  const before = state.doc.sliceString(0, line.from);
  const after = state.doc.sliceString(Math.min(line.to + 1, state.doc.length));
  if (statement && emptyOrComments(before) && !diagramHeader.test(after.trim())) {
    return atPrefix(openingStatements, statement[1] ?? '', pos, explicit);
  }
  const accepted = before + after;
  try {
    const { nodes } = flowchartSourceLocations(accepted);
    if (endpoint) {
      if (!nodes.has(endpoint[1])) return null;
      const choices = Array.from(nodes, ([label, span]): Completion => ({
        label, detail: accepted.slice(span.from, span.to).replace(/^"|"$/g, ''), type: 'variable',
      }));
      return atPrefix(choices, endpoint[2] ?? '', pos, explicit);
    }
    return atPrefix(flowchartStatements, statement?.[1] ?? '', pos, explicit);
  } catch {
    return null;
  }
}

export const mermaidSourceSuggestions = autocompletion({
  override: [sourceCompletions],
  activateOnTypingDelay: 120,
  maxRenderedOptions: 30,
});
