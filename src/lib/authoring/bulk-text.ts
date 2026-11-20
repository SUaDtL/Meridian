import { verifiedTopology, type renderMermaidProject } from './project-render';
import type { MermaidProjectV3 } from './mermaid-project';
import { validateMermaidProject } from './validate-mermaid-project';

type Frame = Awaited<ReturnType<typeof renderMermaidProject>>;

export function bulkTextSelection(frame: Frame, selected: ReadonlySet<string>) {
  const targets = frame.targetTable?.targets.filter(item => selected.has(item.id)) ?? [];
  const byId = new Map(frame.result.elements?.map(item => [item.key, item]));
  const eligible = targets.flatMap(item => {
    const element = byId.get(item.id);
    const color = element?.appearance?.color;
    return element?.capabilities.includes('text') && color ? [{ id: item.id, label: item.label, color }] : [];
  });
  const colors = new Set(eligible.map(item => item.color));
  return { eligible, color: colors.size === 1 ? eligible[0].color : null, total: selected.size };
}

export function buildBulkTextCandidate(document: MermaidProjectV3, ids: readonly string[], color: string) {
  if (!ids.length || !/^#[0-9a-f]{6}$/.test(color)) throw new Error('Choose a six-digit text color for the eligible labels.');
  if (ids.every(id => document.design.elements[id]?.color === color)) throw new Error('The selected labels already use this text override.');
  const elements = { ...document.design.elements };
  for (const id of ids) {
    elements[id] = { ...elements[id], color };
  }
  return validateMermaidProject({
    ...document, revision: document.revision + 1, updatedAt: new Date().toISOString(), design: { ...document.design, elements },
  });
}

export function verifyBulkTextCandidate(current: Frame, preview: Frame, ids: readonly string[], color: string) {
  if (!current.targetTable || !preview.targetTable || verifiedTopology(current.targetTable) !== verifiedTopology(preview.targetTable)) {
    throw new Error('The candidate did not preserve the verified diagram relationships.');
  }
  const measured = new Map(preview.result.elements?.map(item => [item.key, item.appearance?.color]));
  if (ids.some(id => measured.get(id) !== color)) throw new Error('Meridian could not verify the new color on every eligible label.');
}
