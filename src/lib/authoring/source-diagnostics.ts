type SourceDiagnosticKind = 'syntax' | 'resource' | 'unsupported' | 'stale';

export class SourceDiagnosticError extends Error {
  constructor(
    readonly kind: SourceDiagnosticKind,
    message: string,
    readonly detail?: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = 'SourceDiagnosticError';
  }
}

export function explainMermaidSourceError(reason: unknown, source: string): unknown {
  if (!(reason instanceof Error) || reason instanceof SourceDiagnosticError) return reason;
  const syntax = /^(?:Parse|Lexical) error on line (\d+)\b/i.exec(reason.message);
  if (!syntax && reason.name !== 'UnknownDiagramError') return reason;
  const normalized = source.replace(/\r\n?/g, '\n');
  const afterLeadingSpace = normalized.trimStart();
  const text = afterLeadingSpace.trimEnd();
  // Mermaid removes these constructs before parsing. Omit location when the
  // engine's line cannot be mapped back to a line in the editable draft.
  const hasPreprocessing = /^(?:```|---\s*(?:\n|$))|%%\{|^[ \t]*(?:%%|click\s)/m.test(text);
  const parserLine = Number(syntax?.[1]);
  const prefixLines = (normalized.slice(0, normalized.length - afterLeadingSpace.length).match(/\n/g) ?? []).length;
  const lineCount = text.split('\n').length;
  // Mermaid's parser adds a final newline. A location on that synthetic line
  // maps to the end of the last authored statement.
  const inDraft = !hasPreprocessing && Number.isSafeInteger(parserLine) && parserLine > 0 && parserLine <= lineCount + 1;
  const line = inDraft ? prefixLines + Math.min(parserLine, lineCount) : undefined;
  const message = syntax
    ? 'Mermaid could not read this statement. Check that its labels and delimiters are complete, then preview again.'
    : 'Mermaid could not identify a diagram declaration. For a flowchart, begin with flowchart LR or flowchart TB.';
  return new SourceDiagnosticError('syntax', message, reason.message.slice(0, 2_000), line);
}

export function sourceLineRange(text: string, line: number) {
  if (!Number.isSafeInteger(line) || line < 1) return undefined;
  let start = 0;
  for (let index = 1; index < line; index++) {
    const newline = text.indexOf('\n', start);
    if (newline === -1) return undefined;
    start = newline + 1;
  }
  const newline = text.indexOf('\n', start);
  return { start, end: newline === -1 ? text.length : newline };
}
