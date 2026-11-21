import type { MermaidProjectV3, SemanticRole } from './mermaid-project';
import { prepareProjectFragment } from './project-fragment';
import type { FlowchartFragment } from './source-patches';
import { normalizeSystemsDraft, type SystemsDraft } from './systems-draft';
import { validateMermaidProject } from './validate-mermaid-project';

export type GuidedAttachment = {
  existingElementId: string;
  draftNodeId: string;
  direction: 'from-existing' | 'to-existing';
};

type GuidedNode = FlowchartFragment['nodes'][number] & { role?: SemanticRole | null };

export function prepareGuidedSystemsInsertion(
  base: MermaidProjectV3, values: SystemsDraft, attachment?: GuidedAttachment, signal?: AbortSignal,
) {
  const input = normalizeSystemsDraft(values);
  const nodes = input.nodes.map(({ id, ...item }) => ({ ...item, key: id }));
  const edges = input.edges.map(item => ({
    key: item.id, from: { key: item.sourceId }, to: { key: item.targetId }, label: item.label, direction: item.direction,
  }));
  return prepareGuidedFragmentInsertion(base, nodes, edges, attachment, signal);
}

export async function prepareGuidedFragmentInsertion(
  base: MermaidProjectV3, nodes: readonly GuidedNode[], relationships: FlowchartFragment['edges'],
  attachment?: GuidedAttachment, signal?: AbortSignal,
) {
  const edges = [...relationships];
  if (attachment) {
    if (edges.length >= 400) throw new Error('Leave room for the attachment within the 400-relationship limit.');
    const target = base.identity.elements.find(item => item.id === attachment.existingElementId &&
      item.status === 'resolved' && item.elementKind === 'node');
    if (!target || !nodes.some(item => item.key === attachment.draftNodeId) ||
        !['from-existing', 'to-existing'].includes(attachment.direction)) {
      throw new Error('Choose a current project node, a draft node and the attachment direction.');
    }
    const existing = { current: target.binding.sourceId };
    const inserted = { key: attachment.draftNodeId };
    const outgoing = attachment.direction === 'from-existing';
    edges.push({ key: 'meridian:guided-attachment', from: outgoing ? existing : inserted, to: outgoing ? inserted : existing,
      label: '', direction: 'forward' });
  }
  const resolved = await prepareProjectFragment(base, { nodes, edges }, signal);
  const roles = nodes.flatMap((item, index) => item.role
    ? [{ elementId: resolved.bind(resolved.nodes[index].sourceId), role: item.role }] : []);
  return validateMermaidProject({
    ...base, source: resolved.source, revision: base.revision + 1, updatedAt: new Date().toISOString(),
    identity: { ...base.identity, elements: resolved.elements }, roles: [...base.roles, ...roles],
  });
}
