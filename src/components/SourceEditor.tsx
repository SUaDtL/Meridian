import { memo, useCallback, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
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
const basicSetup = { foldGutter: false, highlightActiveLine: true, lineNumbers: true, autocompletion: false };

function SourceEditor({ source, onChange, focusRequest = 0 }: { source: string; onChange: (source: string) => void; focusRequest?: number }) {
  const change = useRef(onChange);
  change.current = onChange;
  const editor = useRef<EditorView | null>(null);
  const requestedFocus = useRef(focusRequest);
  requestedFocus.current = focusRequest;
  const receiveEditor = useCallback((view: EditorView) => {
    editor.current = view;
    if (requestedFocus.current) view.focus();
  }, []);
  useEffect(() => { if (focusRequest) editor.current?.focus(); }, [focusRequest]);
  // Callback and extension identity changes reconfigure CodeMirror. Keep its
  // state, selection, and undo history stable through unrelated studio updates.
  const handleChange = useCallback((value: string) => change.current(value), []);
  return <CodeMirror value={source} height="100%" theme={editorTheme} extensions={extensions} onChange={handleChange} onCreateEditor={receiveEditor}
    aria-label="Mermaid source code" basicSetup={basicSetup} />;
}

export default memo(SourceEditor);
