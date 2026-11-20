import { useMemo, useState } from "react";
import {
  Copy,
  Download,
  Layers3,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type { StudioDocument } from "../types";
import { getTheme } from "../lib/themes";
import Modal from "./Modal";

export default function ProjectManager({
  documents,
  activeId,
  onOpen,
  onNew,
  onImport,
  onDuplicate,
  onDownload,
  onRemove,
  onMigration,
  onClose,
}: {
  documents: StudioDocument[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onRemove: (id: string) => void;
  onMigration: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents],
  );
  const matches = sorted.filter((project) =>
    `${project.title} ${project.subtitle}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Modal
      title="Your projects"
      eyebrow="SAVED IN THIS BROWSER"
      wide
      onClose={onClose}
    >
      <div className="project-toolbar">
        <p>Pick up where you left off.</p>
        <button className="button secondary" onClick={onImport}>
          <Upload size={15} />
          Import
        </button>
        <button className="button primary" onClick={onNew}>
          <Plus size={16} />
          New diagram
        </button>
      </div>
      {documents.length > 3 && (
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a project…"
          />
        </label>
      )}
      <div className="project-list">
        {matches.map((project) => (
          <div
            key={project.id}
            className={`project-row ${activeId === project.id ? "current" : ""}`}
          >
            <button className="project-open" onClick={() => onOpen(project.id)}>
              <span
                className="project-icon"
                style={{
                  color: getTheme(project.settings.theme).accent,
                  background: getTheme(project.settings.theme).canvas,
                }}
              >
                <Layers3 size={22} />
              </span>
              <span>
                <strong>{project.title || "Untitled diagram"}</strong>
                <small>
                  {getTheme(project.settings.theme).name} ·{" "}
                  {new Date(project.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                  {project.id === activeId ? " · Current" : ""}
                </small>
              </span>
            </button>
            <button
              className="icon-button danger"
              aria-label={`Delete ${project.title || "Untitled diagram"}`}
              onClick={() => setPending(project.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      {!matches.length && (
        <p className="empty-search">
          {documents.length
            ? "No matching projects."
            : "Your workspace is empty. Start a new diagram or import a project."}
        </p>
      )}
      {pending && (
        <div className="delete-confirm" role="alert">
          <p>
            Remove “
            {documents.find((project) => project.id === pending)?.title ||
              "Untitled diagram"}
            ” from this browser?
          </p>
          <button className="button quiet" onClick={() => setPending(null)}>
            Keep it
          </button>
          <button
            className="button danger-button"
            onClick={() => {
              onRemove(pending);
              setPending(null);
            }}
          >
            Remove project
          </button>
        </div>
      )}
      <div className="project-modal-footer">
        <button
          className="button quiet"
          disabled={!activeId}
          onClick={onDuplicate}
        >
          <Copy size={15} />
          Duplicate current
        </button>
        <button
          className="button quiet"
          disabled={!activeId}
          onClick={onDownload}
        >
          <Download size={15} />
          Download current
        </button>
        <span>{documents.length} / 50 projects</span>
      </div>
      <p className="muted-note">
        Download .meridian.json projects for backups or to move between
        browsers. Project files include your source, styling, and presentation
        scenes.
      </p>
      <button className="button quiet" onClick={onMigration}>
        Project migration and recovery
      </button>
    </Modal>
  );
}
