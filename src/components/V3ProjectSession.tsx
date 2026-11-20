import { useEffect, useRef, useState } from "react";
import HeadingEditor from "./HeadingEditor";
import Modal from "./Modal";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import { openStoredProjectEditor } from "../lib/authoring/project-editor";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame, buildMermaidProjectPresentation } from "../lib/export";
import type { ProjectSaveState } from "../lib/persistence/project-save-queue";
import { openWorkspaceDatabase, saveWorkspaceProjectCopy } from "../lib/persistence/workspace-db";
import { downloadText, safeFilename, serializeProject } from "../lib/storage";
import type { ProposalOutcome } from "../lib/workspace";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Frame = { document: MermaidProjectV3; rendered: Awaited<ReturnType<typeof renderMermaidProject>>; url: string };

export default function V3ProjectSession({ id, onBack }: { id: string; onBack: () => void }) {
  const connection = useRef<IDBDatabase | undefined>(undefined);
  const editor = useRef<Editor | undefined>(undefined);
  const inFlight = useRef(false);
  const [project, setProject] = useState<MermaidProjectV3>();
  const [save, setSave] = useState<ProjectSaveState>();
  const [frame, setFrame] = useState<Frame>();
  const [error, setError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editHeading, setEditHeading] = useState(false);
  const [outcome, setOutcome] = useState<ProposalOutcome>();
  const [confirmReload, setConfirmReload] = useState(false);

  function adoptEditor(next: Editor) {
    editor.current?.close();
    editor.current = next;
    setProject(next.snapshot());
    setSave(next.saveState());
  }

  useEffect(() => {
    let closed = false;
    async function open() {
      try {
        const db = await openWorkspaceDatabase();
        if (closed) {
          db.close();
          return;
        }
        connection.current = db;
        const next = await openStoredProjectEditor(db, id, setSave);
        if (closed) next.close();
        else adoptEditor(next);
      } catch (reason) {
        if (!closed) setError(reason instanceof Error ? reason.message : "The project could not be opened.");
      }
    }
    const flush = () => { void editor.current?.flush(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    void open();
    return () => {
      closed = true;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      editor.current?.close();
      connection.current?.close();
      editor.current = undefined;
      connection.current = undefined;
    };
  }, [id]);

  useEffect(() => {
    if (!project) return;
    const controller = new AbortController();
    let url: string | undefined;
    setFrame(undefined);
    setRenderError("");
    void renderMermaidProject(project, controller.signal).then(rendered => {
      if (controller.signal.aborted) return;
      const svg = buildExportFrame(rendered.result, project).svg;
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setFrame({ document: project, rendered, url });
    }).catch(reason => {
      if (!controller.signal.aborted) setRenderError(reason instanceof Error ? reason.message : "The diagram could not be rendered.");
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [project]);

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Meridian could not complete the action.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function close() {
    void run(async () => {
      const current = editor.current;
      if (!current) {
        onBack();
        return;
      }
      await current.flush();
      if (current.saveState().phase === "saved") onBack();
      else setError("Your latest changes are still in this session. Download them or resolve the save before leaving.");
    });
  }

  function applyHeading(proposal: ReadyProposal) {
    const current = editor.current!;
    const status = current.applyHeading(proposal);
    setOutcome({ id: proposal.id, status });
    setProject(current.snapshot());
  }

  const title = project?.title || "Untitled diagram";
  const currentFrame = frame?.document === project ? frame : undefined;
  const needsRecovery = save?.phase === "conflict" || save?.phase === "error";
  return (
    <>
      <Modal title={project ? title : "Open v3 project"} wide onClose={close} busy={busy}>
        {!project && !error && <p role="status">Checking the saved project…</p>}
        {project && (
          <>
            <div className="migration-preview">
              {currentFrame && <img src={currentFrame.url} alt={`Diagram preview for ${title}`} />}
              {!currentFrame && !renderError && <p role="status">Rendering the current diagram…</p>}
              {renderError && <p role="alert">{renderError}</p>}
              <details><summary>Mermaid source</summary><pre>{project.source}</pre></details>
            </div>
            <p role="status">{save?.phase === "saved" ? "Saved in this browser."
              : needsRecovery ? "Changes are only in this session."
              : "Saving changes…"}</p>
            {needsRecovery && <p role="alert">{save?.message}</p>}
            <div className="recovery-actions">
              <button className="button secondary" disabled={busy} onClick={() => { setOutcome(undefined); setEditHeading(true); }}>Edit heading</button>
              <button className="button quiet" disabled={busy || !editor.current?.canUndo()} onClick={() => void run(async () => {
                const current = editor.current!;
                if (current.undo()) setProject(current.snapshot());
              })}>Undo</button>
              <button className="button quiet" disabled={busy || !editor.current?.canRedo()} onClick={() => void run(async () => {
                const current = editor.current!;
                if (current.redo()) setProject(current.snapshot());
              })}>Redo</button>
              <button className="button secondary" disabled={busy} onClick={() => downloadText(serializeProject(project), `${safeFilename(title)}.meridian.json`)}>
                {needsRecovery ? "Download my changes" : "Download v3 project"}
              </button>
              {currentFrame?.rendered.targetTable && (
                <button className="button secondary" disabled={busy} onClick={() => void run(async () => {
                  const html = await buildMermaidProjectPresentation(currentFrame.rendered, project);
                  downloadText(html, `${safeFilename(title)}.html`, "text/html;charset=utf-8");
                })}>Download HTML presentation</button>
              )}
            </div>
            {needsRecovery && (
              <div className="recovery-actions">
                {save?.phase === "error" && <button className="button secondary" disabled={busy}
                  onClick={() => void run(async () => {
                    setConfirmReload(false);
                    await editor.current?.retrySave();
                  })}>Retry save</button>}
                {!confirmReload && <button className="button secondary" disabled={busy}
                  onClick={() => setConfirmReload(true)}>Reload saved version</button>}
                {confirmReload && (
                  <>
                    <button className="button quiet" disabled={busy} onClick={() => setConfirmReload(false)}>Cancel reload</button>
                    <button className="button secondary" disabled={busy} onClick={() => void run(async () => {
                      const next = await openStoredProjectEditor(connection.current!, id, setSave);
                      adoptEditor(next);
                      setConfirmReload(false);
                    })}>Discard unsaved changes and reload</button>
                  </>
                )}
                <button className="button secondary" disabled={busy} onClick={() => void run(async () => {
                  await saveWorkspaceProjectCopy(connection.current!, editor.current!.snapshot());
                  onBack();
                })}>Save my changes as a new project</button>
              </div>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="recovery-actions">
          <button className="button quiet" disabled={busy} onClick={close}>Back to v3 projects</button>
        </div>
      </Modal>
      {project && editHeading && (
        <HeadingEditor document={project} field="title" revision={project.revision} outcome={outcome}
          prepare={(_base, envelope) => editor.current!.prepareHeading(envelope)}
          onApply={applyHeading} onClose={() => setEditHeading(false)} />
      )}
    </>
  );
}
