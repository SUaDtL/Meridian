import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  FilePlus2,
  GalleryHorizontalEnd,
  Layers3,
  Search,
  ShieldCheck,
  ListTree,
  Upload,
} from "lucide-react";
import type { StudioDocument } from "../types";
import { getTheme } from "../lib/themes";
import Brand from "./Brand";

export interface StartActions {
  onGuided: () => void;
  onBlank: () => void;
  onExamples: () => void;
  onImport: () => void;
}
export function StartChoices({ onGuided, onBlank, onExamples, onImport }: StartActions) {
  return (
    <div className="start-choices">
      <button className="start-card start-blank start-guided" onClick={onGuided} aria-label="Build with guidance">
        <span className="start-icon"><ListTree size={25} /></span>
        <h2>Build with guidance</h2>
        <p>Turn process steps or a relationship table into a flowchart.</p>
        <span className="start-cta">Build a flowchart <ArrowRight size={17} /></span>
      </button>
      <button
        className="start-card"
        onClick={onBlank}
        aria-label="Start from scratch"
      >
        <span className="start-icon">
          <FilePlus2 size={25} />
        </span>
        <h2>Start from scratch</h2>
        <p>An empty canvas for your own Mermaid source.</p>
        <span className="start-cta">
          Create a diagram
          <ArrowRight size={17} />
        </span>
      </button>
      <button
        className="start-card"
        onClick={onExamples}
        aria-label="Browse examples"
      >
        <span className="start-icon">
          <GalleryHorizontalEnd size={25} />
        </span>
        <h2>Start from an example</h2>
        <p>Explore architectures, workflows, timelines, and more.</p>
        <span className="start-cta">
          Browse examples
          <ArrowRight size={17} />
        </span>
      </button>
      <button
        className="start-card"
        onClick={onImport}
        aria-label="Import a project or Mermaid file"
      >
        <span className="start-icon">
          <Upload size={25} />
        </span>
        <h2>Bring your own</h2>
        <p>Open a Meridian project or import a Mermaid file.</p>
        <span className="start-cta">
          Import a file
          <ArrowRight size={17} />
        </span>
      </button>
    </div>
  );
}

export default function Home({
  documents,
  activeId,
  onOpen,
  onManage,
  onGuide,
  ...actions
}: StartActions & {
  documents: StudioDocument[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onManage: () => void;
  onGuide: () => void;
}) {
  const [search, setSearch] = useState("");
  const recent = useMemo(
    () => [...documents].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [documents],
  );
  const last =
    documents.find((project) => project.id === activeId) ?? recent[0];
  const visible = recent
    .filter((project) =>
      `${project.title} ${project.subtitle}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, 6);
  return (
    <div className="home-screen">
      <header className="home-header">
        <Brand />
        <button className="button quiet" onClick={onGuide}>
          <BookOpen size={16} />
          Quick guide
        </button>
      </header>
      <main className="home-main">
        <section className="home-intro">
          <span className="eyebrow">YOUR DIAGRAM STUDIO</span>
          <h1>Make the complex clear.</h1>
          <p>
            Turn Mermaid into diagrams worth sharing.
            <br />
            Choose your starting point, then make it yours.
          </p>
        </section>
        {last && (
          <section className="continue-project" aria-label="Continue working">
            <span className="continue-icon">
              <Layers3 size={25} />
            </span>
            <div>
              <small>PICK UP WHERE YOU LEFT OFF</small>
              <h2>{last.title || "Untitled diagram"}</h2>
              <p>
                {last.subtitle ||
                  `${getTheme(last.settings.theme).name} · Saved in this browser`}
              </p>
            </div>
            <button
              className="button primary"
              aria-label={`Continue project: ${last.title || "Untitled diagram"}`}
              onClick={() => onOpen(last.id)}
            >
              Continue
              <ArrowRight size={16} />
            </button>
          </section>
        )}
        <StartChoices {...actions} />
        {recent.length > 0 && (
          <section className="recent-projects">
            <div className="section-heading">
              <div>
                <h2>Recent projects</h2>
                <span>{documents.length} saved in this browser</span>
              </div>
              <button className="button quiet" onClick={onManage}>
                Manage projects
                <ArrowRight size={15} />
              </button>
            </div>
            {recent.length > 3 && (
              <label className="search-field">
                <Search size={16} />
                <input
                  aria-label="Search recent projects"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a project…"
                />
              </label>
            )}
            <div className="recent-grid">
              {visible.map((project) => (
                <button
                  key={project.id}
                  className="recent-card"
                  onClick={() => onOpen(project.id)}
                >
                  <span
                    className="project-icon"
                    style={{
                      background: getTheme(project.settings.theme).canvas,
                      color: getTheme(project.settings.theme).accent,
                    }}
                  >
                    <Layers3 size={20} />
                  </span>
                  <span>
                    <strong>{project.title || "Untitled diagram"}</strong>
                    <small>
                      {new Date(project.updatedAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}{" "}
                      · {getTheme(project.settings.theme).name}
                      {project.storyboard?.scenes.length
                        ? ` · ${project.storyboard.scenes.length} scenes`
                        : ""}
                    </small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
            {visible.length === 0 && (
              <p className="muted-note">No projects match “{search}”.</p>
            )}
          </section>
        )}
        <footer className="home-footer">
          <span>
            <ShieldCheck size={16} />
            Your work stays in this browser.
          </span>
          <span>
            No account needed. Export a project for a portable backup.
          </span>
          {recent.length === 0 && (
            <button className="button quiet" onClick={onManage}>Manage projects</button>
          )}
        </footer>
      </main>
    </div>
  );
}
