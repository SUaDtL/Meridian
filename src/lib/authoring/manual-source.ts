import { flowchartModelFor, renderDiagram } from '../render';
import { authoringLimits } from './flowchart-source';
import { reconcileIdentities } from './identities';
import { observeFlowchartIdentities } from './identity-observation';
import type { MermaidProjectV3 } from './mermaid-project';
import { explainMermaidSourceError, SourceDiagnosticError } from './source-diagnostics';
import { validateMermaidProject } from './validate-mermaid-project';

export function sourceLineEndings(source: string) {
  const rest = source.replace(/\r\n/g, '');
  if (rest.includes('\r') || (source.includes('\r\n') && rest.includes('\n'))) return 'mixed';
  return source.includes('\r\n') ? 'crlf' : 'lf';
}

/** Prepare authored source while preserving every previously accepted binding. */
export async function prepareManualSource(base: MermaidProjectV3, source: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!source.trim() || source.length > authoringLimits.sourceCodeUnits) throw new Error('Enter Mermaid source of up to 100,000 characters.');
  if (base.source === source) throw new Error('Change the Mermaid source before previewing it.');
  const candidate = await renderDiagram(source, base.settings, {}, undefined, { signal }).catch(reason => {
    throw explainMermaidSourceError(reason, source);
  });
  const model = flowchartModelFor(candidate);
  if (!model || model.vertices.size === 0) throw new SourceDiagnosticError('unsupported',
    'Mermaid rendered this diagram. Reviewed source edits require a flowchart with at least one node.');
  const observed = await observeFlowchartIdentities(model);
  signal?.throwIfAborted();
  const accepted = base.identity.elements;
  const prior = new Set(accepted.map(item => item.id));
  const elements = reconcileIdentities(accepted, observed, prior, base.identity.orphans.length);
  const byId = new Map(elements.map(item => [item.id, item]));
  if (accepted.some(item => byId.get(item.id) !== item)) {
    throw new SourceDiagnosticError('unsupported', 'This source change would lose an existing diagram binding. Use a reviewed deletion for supported elements or create a separate diagram from the revised source.');
  }
  const document = validateMermaidProject({
    ...base, source, identity: { ...base.identity, elements },
    revision: base.revision + 1, updatedAt: new Date().toISOString(),
  });
  return { document, added: elements.filter(item => !prior.has(item.id)).length, preserved: accepted.filter(item => item.status === 'resolved').length };
}
