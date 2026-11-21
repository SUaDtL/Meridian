import { prepareGuidedFlowchart } from './guided-flowchart';
import type { MermaidProjectV3 } from './mermaid-project';
import type { TerraformFacts } from './terraform-facts';
import { validateMermaidProject } from './validate-mermaid-project';

export function terraformScope(facts: TerraformFacts, selected: ReadonlySet<string>, includeReferences: boolean) {
  const resources = facts.resources.filter(item => selected.has(item.address));
  const references = includeReferences ? facts.references.filter(item => selected.has(item.source) && selected.has(item.target)) : [];
  return { resources, references };
}

export async function prepareTerraformProject(facts: TerraformFacts, selected: ReadonlySet<string>, includeReferences: boolean, signal: AbortSignal) {
  const { resources, references } = terraformScope(facts, selected, includeReferences);
  if (!resources.length || resources.length !== selected.size || resources.length > 100 || references.length > 200) {
    throw new Error('Choose up to 100 available resources and 200 declared references.');
  }
  const title = facts.planned ? 'Terraform planned resource inventory' : 'Terraform state resource inventory';
  const prepared = await prepareGuidedFlowchart(title, {
    direction: 'LR',
    // The pinned Mermaid renderer can display these bracket glyphs as literal text.
    nodes: resources.map(item => ({ key: item.address, label: item.address.replaceAll('[', '［').replaceAll(']', '］') })),
    edges: references.map(item => ({ from: item.source, to: item.target, label: 'Declared reference' })),
  }, signal);
  signal.throwIfAborted();
  const ids = new Map(prepared.document.identity.elements.map(item => [item.binding.sourceId, item.id]));
  function provenance(sourceId: string | undefined, pointer: string, relationship: string): MermaidProjectV3['provenance'][number] {
    const elementId = sourceId && ids.get(sourceId);
    if (!elementId) throw new Error('A Terraform fact could not be matched to its diagram element.');
    return { elementId, adapter: 'terraform-show', adapterVersion: '1.0.0', virtualPath: facts.virtualPath, pointer, relationship };
  }
  return {
    ...prepared,
    document: validateMermaidProject({ ...prepared.document, provenance: [
      ...resources.map(item => provenance(prepared.generated.nodeIds.get(item.address), item.pointer,
        item.module ? 'Resource in child module' : 'Resource in root module')),
      ...references.map((item, index) => provenance(prepared.generated.edgeIds[index], item.pointer, 'Declared Terraform configuration reference')),
    ] }),
  };
}
