import type { ConnectionDirection, Shape } from './flowchart-source';
import {
  applySourcePatches, flowchartSubsetTopology, groupedFlowchartTopology, planAddNext, planEdgeAddition, planEdgeLabel,
  planEdgeRemoval, planEdgeSelectionRemoval, planFlowchartFragment, planGroupContentsRemoval, planGroupCreation, planGroupRemoval,
  planMoveToGroup, planNodeAddition, planNodeLabel, planNodeRemoval, type FlowchartFragment, type SourcePatch,
} from './source-patches';

export type SourceIntent =
  | { op: 'addNode'; label: string; shape?: Shape }
  | { op: 'addNext'; anchor: string; label: string; shape: Shape; edgeLabel?: string; incoming: boolean }
  | { op: 'setNodeLabel' | 'setEdgeLabel'; sourceId: string; label: string }
  | { op: 'addEdge'; from: string; to: string; label?: string; direction?: ConnectionDirection }
  | { op: 'addGroup'; members: readonly string[]; label: string }
  | { op: 'removeGroup'; sourceId: string }
  | { op: 'removeGroupContents'; sourceId: string; members: readonly string[]; incidentEdgeIds: readonly string[] }
  | { op: 'moveToGroup'; sourceId: string; groupId: string }
  | { op: 'removeNode'; sourceId: string; incidentEdgeIds: readonly string[] }
  | { op: 'removeEdges'; sourceIds: readonly string[] }
  | { op: 'removeEdge'; sourceId: string };

function planSourceEdit(source: string, intent: SourceIntent): {
  sourceId: string; patches: SourcePatch[]; edgeId?: string; from?: string; to?: string;
} {
  switch (intent.op) {
    case 'addNode': return planNodeAddition(source, intent.label, intent.shape);
    case 'addNext': return planAddNext(source, intent.anchor, intent.label, intent.shape, intent.edgeLabel, intent.incoming);
    case 'addEdge': return planEdgeAddition(source, intent.from, intent.to, intent.label, intent.direction);
    case 'addGroup': return planGroupCreation(source, intent.members, intent.label);
    case 'removeGroup': return planGroupRemoval(source, intent.sourceId);
    case 'removeGroupContents': return planGroupContentsRemoval(source, intent.sourceId, intent.members, intent.incidentEdgeIds);
    case 'moveToGroup': return planMoveToGroup(source, intent.sourceId, intent.groupId);
    case 'removeNode': return { sourceId: intent.sourceId, patches: planNodeRemoval(source, intent.sourceId, intent.incidentEdgeIds) };
    case 'removeEdge': return { sourceId: intent.sourceId, patches: planEdgeRemoval(source, intent.sourceId) };
    case 'removeEdges': return { sourceId: intent.sourceIds[0], patches: planEdgeSelectionRemoval(source, intent.sourceIds) };
    case 'setEdgeLabel': return { sourceId: intent.sourceId, patches: planEdgeLabel(source, intent.sourceId, intent.label) };
    case 'setNodeLabel': return { sourceId: intent.sourceId, patches: planNodeLabel(source, intent.sourceId, intent.label) };
  }
}

/** Compute source changes and the original topology before invoking the Mermaid renderer. */
export function planStructuralSource(source: string, intent: SourceIntent) {
  const { patches, ...plan } = planSourceEdit(source, intent);
  const revised = applySourcePatches(source, patches);
  const canReadGroups = intent.op === 'setNodeLabel' || intent.op === 'setEdgeLabel' || intent.op === 'removeGroup'
    || intent.op === 'removeGroupContents' || intent.op === 'moveToGroup' || intent.op === 'addGroup';
  const grouped = canReadGroups ? groupedFlowchartTopology(source) : undefined;
  return {
    ...plan, source: revised,
    topology: grouped?.topology ?? flowchartSubsetTopology(source), groups: grouped?.groups,
  };
}

export function planFragmentSource(source: string, fragment: FlowchartFragment) {
  const plan = planFlowchartFragment(source, fragment);
  return { ...plan, source: applySourcePatches(source, plan.patches) };
}
