import type { GuidedAttachment } from "../lib/authoring/guided-systems-insertion";

export type AttachmentDraft = Omit<GuidedAttachment, "direction"> & { direction: GuidedAttachment["direction"] | "" };
export const emptyGuidedAttachment: AttachmentDraft = { existingElementId: "", draftNodeId: "", direction: "" };

type AttachmentNode = { id: string; label: string };
export type GuidedAttachmentTarget = {
  nodes: readonly AttachmentNode[];
  attachment: AttachmentDraft;
  onAttachment: (attachment: AttachmentDraft) => void;
};

export function readyGuidedAttachment(draft: AttachmentDraft | undefined): GuidedAttachment | undefined {
  if (!draft?.existingElementId) return undefined;
  const { direction, draftNodeId, existingElementId } = draft;
  if (!draftNodeId || !direction) throw new Error("Choose the draft node and direction for the attachment.");
  return { existingElementId, draftNodeId, direction };
}

export default function GuidedAttachmentPicker({ target, draftNodes, disabled }: {
  target: GuidedAttachmentTarget; draftNodes: readonly AttachmentNode[]; disabled: boolean;
}) {
  const { attachment, onAttachment, nodes } = target;
  return (
    <fieldset disabled={disabled}>
      <legend>Attachment to this project</legend>
      <p>Choose the attachment for this project after opening a saved draft.</p>
      <label>Existing node<select value={attachment.existingElementId}
        onChange={event => onAttachment({ ...attachment, existingElementId: event.target.value })}>
        <option value="">Leave separate</option>
        {nodes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {attachment.existingElementId && <>
        <label>Draft node<select value={attachment.draftNodeId}
          onChange={event => onAttachment({ ...attachment, draftNodeId: event.target.value })}>
          <option value="">Choose a draft node</option>
          {draftNodes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <label>Attachment direction<select value={attachment.direction}
          onChange={event => onAttachment({ ...attachment, direction: event.target.value as AttachmentDraft["direction"] })}>
          <option value="">Choose the direction</option>
          <option value="from-existing">Existing node to draft node</option>
          <option value="to-existing">Draft node to existing node</option>
        </select></label>
      </>}
    </fieldset>
  );
}

export function GuidedAttachmentSummary({ target, draftNodes }: {
  target: GuidedAttachmentTarget; draftNodes: readonly AttachmentNode[];
}) {
  const { existingElementId, direction, draftNodeId } = target.attachment;
  const existing = target.nodes.find(item => item.id === existingElementId);
  const inserted = draftNodes.find(item => item.id === draftNodeId);
  if (!existing || !inserted || !direction) return null;
  const [source, destination] = direction === "from-existing" ? [existing, inserted] : [inserted, existing];
  return <p>Attachment {source.label} → {destination.label}</p>;
}
