import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import CodeMirror, { ExternalChange } from '@uiw/react-codemirror';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const mermaidLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/\b(flowchart|graph|subgraph|end|direction|sequenceDiagram|participant|actor|activate|deactivate|alt|else|opt|loop|par|and|rect|Note|note|over|stateDiagram-v2|state|classDiagram|class|erDiagram|mindmap|gantt|dateFormat|section|timeline|journey|pie|title|accTitle|accDescr|classDef|style|linkStyle|click)\b/)) return 'keyword';
    if (stream.match(/(?:[-.=]+[>|xo]?|<[-.=]+|\|[^|]*\|)/)) return 'operator';
    if (stream.match(/#[\da-fA-F]{3,8}\b/)) return 'color';
    if (stream.match(/[\[\]{}():]/)) return 'punctuation';
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return 'number';
    stream.next(); return null;
  },
});

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: '#c6d2d8', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.85', overflow: 'auto' },
  '.cm-content': { padding: '18px 0 100px', caretColor: '#a6e7cf' },
  '.cm-line': { padding: '0 16px 0 8px' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: '#59666f', fontSize: '11px', minWidth: '35px' },
  '.cm-activeLineGutter': { backgroundColor: '#1d2c2e', color: '#d0e1df' },
  '.cm-activeLine': { backgroundColor: '#1c292c66' },
  '.cm-cursor': { borderLeftColor: '#a6e7cf' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: '#31564f88 !important' },
  '.cm-foldGutter': { display: 'none' },
  '.cm-panels': { backgroundColor: '#1b272d', color: '#e1e9ec' },
  '.cm-searchMatch': { backgroundColor: '#8c713b55' },
}, { dark: true });

const highlighting = HighlightStyle.define([
  { tag: tags.keyword, color: '#adbbe9' },
  { tag: tags.string, color: '#acdac1' },
  { tag: tags.comment, color: '#71848a', fontStyle: 'italic' },
  { tag: tags.operator, color: '#d7b184' },
  { tag: tags.number, color: '#d3a7c7' },
  { tag: tags.punctuation, color: '#8aabb2' },
]);

const extensions = [mermaidLanguage, syntaxHighlighting(highlighting), EditorView.lineWrapping];
const basicSetup = { foldGutter: false, highlightActiveLine: true, lineNumbers: true, autocompletion: false, history: false, historyKeymap: false };

function syncSource(view: EditorView, source: string) {
  const insert = view.state.toText(source);
  if (!insert.eq(view.state.doc)) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert },
      annotations: ExternalChange.of(true),
    });
  }
}

interface SourceEditorProps {
  source: string;
  onChange: (source: string, group?: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  focusRequest?: number;
}

function SourceEditor({ source, onChange, onUndo, onRedo, focusRequest = 0 }: SourceEditorProps) {
  const actions = useRef({ onChange, onUndo, onRedo });
  actions.current = { onChange, onUndo, onRedo };
  const editor = useRef<EditorView | null>(null);
  const initialSource = useRef(source);
  const latestSource = useRef(source);
  latestSource.current = source;
  const requestedFocus = useRef(focusRequest);
  requestedFocus.current = focusRequest;
  const receiveEditor = useCallback((view: EditorView) => {
    editor.current = view;
    syncSource(view, latestSource.current);
    if (requestedFocus.current) view.focus();
  }, []);
  useLayoutEffect(() => {
    // Apply Undo/Redo without the wrapper's typing delay so a following
    // keystroke always starts from the accepted project's source.
    if (editor.current) syncSource(editor.current, source);
  }, [source]);
  useEffect(() => { if (focusRequest) editor.current?.focus(); }, [focusRequest]);
  const editorExtensions = useMemo(() => [...extensions, EditorView.domEventHandlers({
    keydown(event, view) {
      const key = event.key.toLowerCase();
      if (view.composing || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)
        || (key !== 'z' && key !== 'y')) return false;
      if (key === 'y' || event.shiftKey) actions.current.onRedo();
      else actions.current.onUndo();
      return true;
    },
    beforeinput(event, view) {
      if (view.composing || event.isComposing) return false;
      if (event.inputType === 'historyRedo') actions.current.onRedo();
      else if (event.inputType === 'historyUndo') actions.current.onUndo();
      else return false;
      return true;
    },
  })], []);
  const handleChange = useCallback((value: string, update: ViewUpdate) => {
    // UIW marks app-initiated changes and excludes them from this callback.
    // Keep paste, drop and replacements distinct from ordinary typing/deletion.
    const [transaction] = update.transactions;
    let group: string | undefined;
    if (update.transactions.length === 1) {
      if (transaction.isUserEvent('input.type')) group = 'source:type';
      else if (transaction.isUserEvent('delete.backward')) group = 'source:backspace';
      else if (transaction.isUserEvent('delete.forward')) group = 'source:delete';
    }
    actions.current.onChange(value, group);
  }, []);
  return <CodeMirror value={initialSource.current} height="100%" theme={editorTheme} extensions={editorExtensions} onChange={handleChange} onCreateEditor={receiveEditor}
    aria-label="Mermaid source code" basicSetup={basicSetup} />;
}

export default memo(SourceEditor);
