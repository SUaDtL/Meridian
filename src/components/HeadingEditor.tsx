import { useState } from "react";
import { Check } from "lucide-react";
import type { StudioDocument } from "../types";
import type { DocumentPatch } from "../lib/workspace";
import Modal from "./Modal";

export default function HeadingEditor({
  document,
  field,
  onApply,
  onClose,
}: {
  document: StudioDocument;
  field: "title" | "subtitle";
  onApply: (patch: DocumentPatch) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [subtitle, setSubtitle] = useState(document.subtitle);
  const [show, setShow] = useState(document.settings.showTitle);
  return (
    <Modal
      title="Edit heading"
      eyebrow="ON YOUR CANVAS"
      onClose={onClose}
      initialFocus={`[name="${field}"]`}
    >
      <form
        className="heading-form"
        onSubmit={(event) => {
          event.preventDefault();
          onApply({
            title: title.trim() || "Untitled diagram",
            subtitle,
            settings: { ...document.settings, showTitle: show },
          });
          onClose();
        }}
      >
        <label>
          Title
          <input
            name="title"
            aria-label="Title"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={(event) => event.target.select()}
            placeholder="Untitled diagram"
          />
          <small>{title.length} / 120</small>
        </label>
        <label>
          Subtitle
          <input
            name="subtitle"
            aria-label="Subtitle"
            value={subtitle}
            maxLength={240}
            onChange={(event) => setSubtitle(event.target.value)}
            placeholder="Optional context for your audience"
          />
          <small>{subtitle.length} / 240</small>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={show}
            onChange={(event) => setShow(event.target.checked)}
          />
          <span>
            Show heading on canvas
            <small>Your title also names this project and its exports.</small>
          </span>
        </label>
        <p className="muted-note">
          Click the heading on your canvas to edit it again.
        </p>
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            <Check size={16} />
            Apply heading
          </button>
        </div>
      </form>
    </Modal>
  );
}
