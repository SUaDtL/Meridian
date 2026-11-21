import { sourceLineRange, type SourceDiagnosticError } from './source-diagnostics';
import { groupedFlowchartTopology } from './source-patches';

export function missingNodeBracket(draft: string, diagnosis: SourceDiagnosticError) {
  if (diagnosis.kind !== 'syntax' || diagnosis.line === undefined) return undefined;
  const line = diagnosis.line;
  const range = sourceLineRange(draft, line);
  if (!range) return undefined;
  const before = draft.slice(range.start, range.end);
  const declaration = before.trimEnd();
  if (!/^[ \t]*[A-Za-z_][A-Za-z0-9_-]*\[[A-Za-z0-9][A-Za-z0-9 _.,!?-]{0,255}$/.test(declaration)) return undefined;
  const insertAt = range.start + declaration.length;
  const repaired = draft.slice(0, insertAt) + ']' + draft.slice(insertAt);
  try {
    groupedFlowchartTopology(repaired);
  } catch { return undefined; }
  return { line, before, after: declaration + ']' + before.slice(declaration.length), insertAt };
}
