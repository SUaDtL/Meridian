import { useEffect, useMemo, useRef, useState } from "react";
import HeadingEditor from "./HeadingEditor";
import CommandPalette from "./CommandPalette";
import Modal from "./Modal";
import V3ProjectOutline from "./V3ProjectOutline";
import ReadabilityDialog from "./ReadabilityDialog";
import V3StructureEditor from "./V3StructureEditor";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import { openStoredProjectEditor } from "../lib/authoring/project-editor";
import { renderMermaidProject } from "../lib/authoring/project-render";
import { projectOutline, type OutlineSourceLocation } from "../lib/authoring/project-outline";
import { flowchartSubsetTopology } from "../lib/authoring/source-patches";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { WorkspaceCommand } from "../lib/authoring/command-search";
import type { NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import type { FrameGeometry, ReadabilityTarget, ViewingProfile } from "../lib/authoring/readability";
import { buildExportFrame, buildMermaidProjectPresentation } from "../lib/export";
import type { ProjectSaveState } from "../lib/persistence/project-save-queue";
import { openWorkspaceDatabase, saveWorkspaceProjectCopy } from "../lib/persistence/workspace-db";
import { downloadText, safeFilename, serializeProject } from "../lib/storage";
import type { ProposalOutcome } from "../lib/workspace";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Frame = { document: MermaidProjectV3; rendered: Awaited<ReturnType<typeof renderMermaidProject>>; geometry: FrameGeometry; url: string };

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
  const [editFlowchart, setEditFlowchart] = useState<NativeFlowchartEdit["op"]>();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineSelection, setOutlineSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [renameTarget, setRenameTarget] = useState<string>();
  const [highlight, setHighlight] = useState<(OutlineSourceLocation & { source: string })>();
  const [readabilityOpen, setReadabilityOpen] = useState(false);
  const [canvasProfile, setCanvasProfile] = useState<ViewingProfile>();
  const previewImage = useRef<HTMLImageElement>(null);
  const sourceDetails = useRef<HTMLDetailsElement>(null);
  const sourceMark = useRef<HTMLElement>(null);
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
      const { svg, ...geometry } = buildExportFrame(rendered.result, project);
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setFrame({ document: project, rendered, geometry, url });
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
  const source = project?.source;
  const flatFlowchart = useMemo(() => {
    if (!source) return false;
    try {
      flowchartSubsetTopology(source);
      return true;
    } catch {
      return false;
    }
  }, [source]);
  const targetTable = currentFrame?.rendered.targetTable;
  const outlineAvailable = !!targetTable?.targets.length;
  const outline = useMemo(() => outlineOpen && project && targetTable ? projectOutline(project, targetTable) : undefined,
    [outlineOpen, project, targetTable]);
  const highlighted = highlight?.source === source ? highlight : undefined;
  const readabilityTargets = useMemo(() => {
    if (!readabilityOpen || !currentFrame || !targetTable) return undefined;
    const elements = new Map(currentFrame.rendered.result.elements?.map(element => [element.key, element]));
    return targetTable.targets.map((target): ReadabilityTarget => {
      const element = elements.get(target.id);
      return { id: target.id, kind: target.elementKind, label: target.label, from: target.sourceId, to: target.targetId,
        typography: !!element?.capabilities.includes("typography"), measuredLabelSize: element?.appearance?.labelSizeInDiagram };
    });
  }, [readabilityOpen, currentFrame, targetTable]);
  const identities = project?.identity.elements;
  const nodes = useMemo(() => {
    const ids = new Map(identities?.map(record => [record.id, record.binding.sourceId]));
    return targetTable?.targets.filter(item => item.elementKind === "node")
      .map(item => ({ id: item.id, label: `${item.label} (${ids.get(item.id)})` })) ?? [];
  }, [identities, targetTable]);
  const needsRecovery = save?.phase === "conflict" || save?.phase === "error";
  const editingUnavailable = busy ? "Wait for the current action to finish."
    : !targetTable || !flatFlowchart ? "Open a rendered flat flowchart with explicit node declarations." : undefined;

  useEffect(() => {
    if (!project || busy || commandsOpen || outlineOpen || readabilityOpen || editHeading || editFlowchart) return;
    const openCommands = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey
        || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setCommandsOpen(true);
    };
    window.addEventListener("keydown", openCommands);
    return () => window.removeEventListener("keydown", openCommands);
  }, [project, busy, commandsOpen, outlineOpen, readabilityOpen, editHeading, editFlowchart]);

  function openHeading() { setOutcome(undefined); setEditHeading(true); }
  function openReadability() {
    const bounds = previewImage.current?.getBoundingClientRect();
    setCanvasProfile(bounds && bounds.width >= 100 && bounds.height >= 100
      ? { width: Math.floor(bounds.width), height: Math.floor(bounds.height), padding: 0 } : undefined);
    setReadabilityOpen(true);
  }
  function showSource() {
    if (!sourceDetails.current) return;
    sourceDetails.current.open = true;
    requestAnimationFrame(() => sourceDetails.current?.querySelector("summary")?.focus());
  }
  function jumpToSource(location: OutlineSourceLocation) {
    if (!source || !sourceDetails.current) return;
    setOutlineOpen(false);
    setHighlight({ ...location, source });
    sourceDetails.current.open = true;
    requestAnimationFrame(() => sourceMark.current?.focus());
  }
  function renameFromOutline(id: string) {
    if (editingUnavailable || !nodes.some(node => node.id === id)) return;
    setOutlineOpen(false);
    setRenameTarget(id);
    setEditFlowchart("setNodeLabel");
  }
  function changeHistory(direction: "undo" | "redo") {
    void run(async () => {
      const current = editor.current;
      if (current?.[direction]()) setProject(current.snapshot());
    });
  }
  function downloadProject() {
    if (project) downloadText(serializeProject(project), `${safeFilename(title)}.meridian.json`);
  }
  function downloadPresentation() {
    if (!project || !currentFrame?.rendered.targetTable) return;
    void run(async () => {
      const html = await buildMermaidProjectPresentation(currentFrame.rendered, project);
      downloadText(html, `${safeFilename(title)}.html`, "text/html;charset=utf-8");
    });
  }
  const commands: WorkspaceCommand[] = [
    { id: "edit-heading", title: "Edit heading", category: "Project", synonyms: ["title", "rename project"], run: openHeading },
    { id: "show-source", title: "Show Mermaid source", category: "Project", synonyms: ["open source", "code"], run: showSource },
    { id: "find-element", title: "Find element", category: "Diagram", synonyms: ["outline", "relationships"],
      unavailable: outlineAvailable ? undefined : "A verified flowchart is needed to show its elements.", run: () => setOutlineOpen(true) },
    { id: "check-readability", title: "Check readability", category: "Design", synonyms: ["quality", "label size"],
      unavailable: targetTable?.targets.length ? undefined : "A verified flowchart is needed for readability checks.", run: openReadability },
    { id: "add-node", title: "Add node", category: "Diagram", unavailable: editingUnavailable, run: () => setEditFlowchart("addNode") },
    { id: "rename-node", title: "Rename node", category: "Diagram", unavailable: editingUnavailable ?? (!nodes.length ? "Wait for the diagram's nodes." : undefined), run: () => setEditFlowchart("setNodeLabel") },
    { id: "connect-nodes", title: "Connect nodes", category: "Diagram", synonyms: ["add edge", "add connection"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Wait for the diagram's nodes." : undefined), run: () => setEditFlowchart("addEdge") },
    { id: "undo", title: "Undo", category: "History", unavailable: editor.current?.canUndo() ? undefined : "There are no changes to undo.", run: () => changeHistory("undo") },
    { id: "redo", title: "Redo", category: "History", unavailable: editor.current?.canRedo() ? undefined : "There are no changes to redo.", run: () => changeHistory("redo") },
    { id: "download-project", title: "Download v3 project", category: "Export", synonyms: ["export", "backup", "save project"], run: downloadProject },
    { id: "download-presentation", title: "Download HTML presentation", category: "Export", synonyms: ["export", "offline story"],
      unavailable: currentFrame?.rendered.targetTable ? undefined : "A verified diagram is needed to export the presentation.", run: downloadPresentation },
  ];
  return (
    <>
      <Modal title={project ? title : "Open v3 project"} wide onClose={close} busy={busy}>
        {!project && !error && <p role="status">Checking the saved project…</p>}
        {project && (
          <>
            <div className="migration-preview">
              {currentFrame && <img ref={previewImage} src={currentFrame.url} alt={`Diagram preview for ${title}`} />}
              {!currentFrame && !renderError && <p role="status">Rendering the current diagram…</p>}
              {renderError && <p role="alert">{renderError}</p>}
              <details ref={sourceDetails}><summary>Mermaid source</summary>
                <pre>{highlighted ? <>{project.source.slice(0, highlighted.from)}
                  <mark ref={sourceMark} tabIndex={-1} aria-label={`Source line ${highlighted.line}`}>{project.source.slice(highlighted.from, highlighted.to)}</mark>
                  {project.source.slice(highlighted.to)}</> : project.source}</pre>
              </details>
            </div>
            <p role="status">{save?.phase === "saved" ? "Saved in this browser."
              : needsRecovery ? "Changes are only in this session."
              : "Saving changes…"}</p>
            {needsRecovery && <p role="alert">{save?.message}</p>}
            {targetTable && !flatFlowchart && (
              <p className="muted-note">Visual edits support flat flowcharts with explicit node declarations.</p>
            )}
            <div className="recovery-actions">
              <button className="button secondary" disabled={busy} aria-keyshortcuts="Control+K Meta+K" onClick={() => setCommandsOpen(true)}>Commands</button>
              {outlineAvailable && <button className="button secondary" disabled={busy} onClick={() => setOutlineOpen(true)}>Outline</button>}
              {!!targetTable?.targets.length && <button className="button secondary" disabled={busy} onClick={openReadability}>Check readability</button>}
              <button className="button secondary" disabled={busy} onClick={openHeading}>Edit heading</button>
              {targetTable && flatFlowchart && (
                <button className="button secondary" disabled={busy} onClick={() => setEditFlowchart("addNode")}>Edit flowchart</button>
              )}
              <button className="button quiet" disabled={busy || !editor.current?.canUndo()} onClick={() => changeHistory("undo")}>Undo</button>
              <button className="button quiet" disabled={busy || !editor.current?.canRedo()} onClick={() => changeHistory("redo")}>Redo</button>
              <button className="button secondary" disabled={busy} onClick={downloadProject}>
                {needsRecovery ? "Download my changes" : "Download v3 project"}
              </button>
              {currentFrame?.rendered.targetTable && (
                <button className="button secondary" disabled={busy} onClick={downloadPresentation}>Download HTML presentation</button>
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
      {commandsOpen && <CommandPalette commands={commands} onClose={() => setCommandsOpen(false)} />}
      {outline && <V3ProjectOutline items={outline} selected={outlineSelection} onSelection={setOutlineSelection}
        canRename={!editingUnavailable} onClose={() => setOutlineOpen(false)}
        onRename={renameFromOutline} onSource={jumpToSource} />}
      {readabilityTargets && currentFrame && <ReadabilityDialog frame={currentFrame.geometry} targets={readabilityTargets}
        revision={currentFrame.document.revision} canvas={canvasProfile} onClose={() => setReadabilityOpen(false)} />}
      {project && editHeading && (
        <HeadingEditor document={project} field="title" revision={project.revision} outcome={outcome}
          prepare={(_base, envelope) => editor.current!.prepareHeading(envelope)}
          onApply={applyHeading} onClose={() => setEditHeading(false)} />
      )}
      {editFlowchart && editor.current && (
        <V3StructureEditor editor={editor.current} nodes={nodes} initialOperation={editFlowchart} initialTarget={renameTarget}
          onClose={() => { setEditFlowchart(undefined); setRenameTarget(undefined); }}
          onApply={proposal => {
            const current = editor.current!;
            const result = current.applyStructure(proposal);
            if (result.status === "applied") setProject(current.snapshot());
            return result.status;
          }} />
      )}
    </>
  );
}
