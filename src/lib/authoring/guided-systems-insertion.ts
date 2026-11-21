import type { MermaidProjectV3 } from './mermaid-project';
import { prepareProjectFragment } from './project-fragment';
import type { FlowchartFragment } from './source-patches';
import { normalizeSystemsDraft, type SystemsDraft } from './systems-draft';
import { validateMermaidProject } from './validate-mermaid-project';

export type GuidedSystemsAttachment = {
  existingElementId: string;
  draftNodeId: string;
  direction: 'from-existing' | 'to-existing';
};

export async function prepareGuidedSystemsInsertion(
  base: MermaidProjectV3, values: SystemsDraft, attachment?: GuidedSystemsAttachment, signal?: AbortSignal,
) {
  const input = normalizeSystemsDraft(values);
  const edges: FlowchartFragment['edges'][number][] = input.edges.map(item => ({
    key: item.id, from: { key: item.sourceId }, to: { key: item.targetId }, label: item.label, direction: item.direction,
  }));
  if (attachment) {
    if (input.edges.length >= 400) throw new Error('Leave room for the attachment within the 400-relationship limit.');
    const target = base.identity.elements.find(item => item.id === attachment.existingElementId &&
      item.status === 'resolved' && item.elementKind === 'node');
    if (!target || !input.nodes.some(item => item.id === attachment.draftNodeId) ||
        !['from-existing', 'to-existing'].includes(attachment.direction)) {
      throw new Error('Choose a current project node, a draft node and the attachment direction.');
    }
    const existing = { current: target.binding.sourceId };
    const inserted = { key: attachment.draftNodeId };
    const outgoing = attachment.direction === 'from-existing';
    edges.push({ key: 'meridian:guided-attachment', from: outgoing ? existing : inserted, to: outgoing ? inserted : existing,
      label: '', direction: 'forward' });
  }
  const fragment = { nodes: input.nodes.map(item => ({ key: item.id, label: item.label, shape: item.shape })), edges };
  const resolved = await prepareProjectFragment(base, fragment, signal);
  const roles = input.nodes.flatMap((item, index) => item.role
    ? [{ elementId: resolved.bind(resolved.nodes[index].sourceId), role: item.role }] : []);
  return validateMermaidProject({
    ...base, source: resolved.source, revision: base.revision + 1, updatedAt: new Date().toISOString(),
    identity: { ...base.identity, elements: resolved.elements }, roles: [...base.roles, ...roles],
  });
}
