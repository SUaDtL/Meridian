import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import BulkTextColorDialog from "./BulkTextColorDialog";
import HeadingEditor from "./HeadingEditor";
import CommandPalette from "./CommandPalette";
import Modal from "./Modal";
import V3ProjectOutline from "./V3ProjectOutline";
import ReadabilityDialog from "./ReadabilityDialog";
import V3ComparisonDialog from "./V3ComparisonDialog";
import V3GroupStoryDialog, { initialGroupStoryDraft } from "./V3GroupStoryDialog";
import V3StructureEditor from "./V3StructureEditor";
import V3SourceEditor, { type SourceDraft } from "./V3SourceEditor";
import DetachComponentDialog from "./DetachComponentDialog";
import { designResetFields } from "../lib/authoring/design-reset";
import type { MermaidProjectV3, SemanticRole } from "../lib/authoring/mermaid-project";
import { openStoredProjectEditor } from "../lib/authoring/project-editor";
import { renderMermaidProject } from "../lib/authoring/project-render";
import { projectOutline, type OutlineSourceLocation } from "../lib/authoring/project-outline";
import { flowchartSubsetTopology, supportedUngroupSourceId } from "../lib/authoring/source-patches";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { WorkspaceCommand } from "../lib/authoring/command-search";
import type { NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import { rolePaintFields, type FrameGeometry, type ReadabilityTarget, type RolePaintField, type ViewingProfile } from "../lib/authoring/readability";
import { buildExportFrame, buildMermaidProjectPresentation } from "../lib/export";
import type { ProjectSaveState } from "../lib/persistence/project-save-queue";
import { openWorkspaceDatabase, saveWorkspaceProjectCopy } from "../lib/persistence/workspace-db";
import { downloadText, safeFilename, serializeProject } from "../lib/storage";
import type { ProposalOutcome } from "../lib/workspace";

const SaveComponentDialog = lazy(() => import("./SaveComponentDialog"));
const ComponentProjectDialog = lazy(() => import("./ComponentProjectDialog"));
const AssistExchangeDialog = lazy(() => import("./AssistExchangeDialog"));
const SavedScenesDialog = lazy(() => import("./V3SavedScenesDialog"));
const DesignResetDialog = lazy(() => import("./DesignResetDialog"));

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Frame = { document: MermaidProjectV3; rendered: Awaited<ReturnType<typeof renderMermaidProject>>; geometry: FrameGeometry; url: string };

export default function V3ProjectSession({ id, onBack, onOpenCopy }: {
  id: string; onBack: () => void; onOpenCopy: (id: string) => void;
}) {
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
  const [assistOpen, setAssistOpen] = useState(false);
  const [editSource, setEditSource] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [detachOpen, setDetachOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [componentHidden, setComponentHidden] = useState<number>();
  const [bulkTextHidden, setBulkTextHidden] = useState<number>();
  const [designReset, setDesignReset] = useState<{ selection: ReadonlySet<string>; hidden: number; field?: RolePaintField }>();
  const [deleteConnections, setDeleteConnections] = useState<{ ids: string[]; hidden: number }>();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineSelection, setOutlineSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [editTarget, setEditTarget] = useState<string>();
  const [highlight, setHighlight] = useState<(OutlineSourceLocation & { source: string })>();
  const [dismissedReadability, setDismissedReadability] = useState<ReadonlySet<string>>(new Set());
  const [readabilityOpen, setReadabilityOpen] = useState(false);
  const [comparisonSelection, setComparisonSelection] = useState<{ ids: string[]; hidden: number }>();
  const [comparison, setComparison] = useState<"design" | "layout">();
  const [storyOpen, setStoryOpen] = useState(false);
  const [savedScenesOpen, setSavedScenesOpen] = useState(false);
  const [storyDraft, setStoryDraft] = useState(initialGroupStoryDraft);
  const [canvasProfile, setCanvasProfile] = useState<ViewingProfile>();
  const previewImage = useRef<HTMLImageElement>(null);
  const suggestScenesButton = useRef<HTMLButtonElement>(null);
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
  const selectedRoleCounts = useMemo(() => {
    const counts = new Map<SemanticRole, number>();
    for (const item of project?.roles ?? []) counts.set(item.role, (counts.get(item.role) ?? 0) + 1);
    return [...counts];
  }, [project?.roles]);
  const ungroupSourceId = useMemo(() => source && !flatFlowchart ? supportedUngroupSourceId(source) : undefined, [source, flatFlowchart]);
  const outlineAvailable = !!targetTable?.targets.length;
  const outline = useMemo(() => outlineOpen && project && targetTable ? projectOutline(project, targetTable) : undefined,
    [outlineOpen, project, targetTable]);
  const resetFields = outline && project ? designResetFields(project, outlineSelection) : undefined;
  const canResetDesign = !busy && (resetFields?.hasRecipes || !!resetFields?.fields.length);
  const highlighted = highlight?.source === source ? highlight : undefined;
  const readabilityTargets = useMemo(() => {
    if (!readabilityOpen || !currentFrame || !targetTable) return undefined;
    const elements = new Map(currentFrame.rendered.result.elements?.map(element => [element.key, element]));
    const sourceIds = new Map(currentFrame.document.identity.elements.filter(item => item.status === "resolved")
      .map(item => [item.id, item.binding.sourceId]));
    const roles = new Map(currentFrame.document.roles.map(item => [item.elementId, item.role]));
    const { design } = currentFrame.document;
    return targetTable.targets.map((target): ReadabilityTarget => {
      const element = elements.get(target.id);
      const role = target.elementKind === "node" ? roles.get(target.id) : undefined;
      const policy = design.recipeElements[target.id]?.style;
      const paint = element?.appearance;
      const tokens = role && policy ? rolePaintFields.flatMap(field => {
        const expected = policy[field];
        if (!expected || !/^#[0-9a-f]{6}$/i.test(expected)) return [];
        const known = field !== "fill" || paint?.fillKind === "solid";
        const value = known ? paint?.[field] : undefined;
        const actual = value && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
        return [{ field, expected, actual, override: design.elements[target.id]?.[field] }];
      }) : [];
      return { id: target.id, kind: target.elementKind, label: target.label, sourceId: sourceIds.get(target.id), from: target.sourceId, to: target.targetId,
        typography: !!element?.capabilities.includes("typography"), measuredLabelSize: element?.appearance?.labelSizeInDiagram,
        solidTextPaint: element?.appearance?.solidTextPaint, labelOverflowInDiagram: element?.appearance?.labelOverflowInDiagram,
        measuredRoute: element?.measuredRoute, rolePaint: role && tokens.length ? { role, tokens } : undefined };
    });
  }, [readabilityOpen, currentFrame, targetTable]);
  const identities = project?.identity.elements;
  const nodes = useMemo(() => {
    const ids = new Map(identities?.map(record => [record.id, record.binding.sourceId]));
    return targetTable?.targets.filter(item => item.elementKind === "node")
      .map(item => ({ id: item.id, label: `${item.label} (${ids.get(item.id)})` })) ?? [];
  }, [identities, targetTable]);
  const edgeLabels = currentFrame?.rendered.edgeLabels;
  const edges = useMemo(() => {
    const ids = new Map(identities?.filter(record => record.status === "resolved" && record.binding.type === "edge-id")
      .map(record => [record.id, record.binding.sourceId]));
    return targetTable?.targets.flatMap(item => item.elementKind === "edge"
      ? [{ id: item.id, label: ids.has(item.id) ? `${item.label} (${ids.get(item.id)})` : item.label,
        sourceId: item.sourceId, targetId: item.targetId, direction: item.direction, explicit: ids.has(item.id), text: edgeLabels?.get(item.id) ?? "" }] : []) ?? [];
  }, [identities, targetTable, edgeLabels]);
  const selectedSource = outlineSelection.size === 1 ? nodes.find(node => outlineSelection.has(node.id))?.id : undefined;
  const removableGroup = useMemo(() => {
    const identity = identities?.find(record => record.status === "resolved" && record.elementKind === "group"
      && record.binding.sourceId === ungroupSourceId);
    const target = targetTable?.targets.find(item => item.id === identity?.id && item.elementKind === "group");
    return target ? { id: target.id, label: target.label || "Diagram group" } : undefined;
  }, [identities, targetTable, ungroupSourceId]);
  const needsRecovery = save?.phase === "conflict" || save?.phase === "error";
  const editingUnavailable = busy ? "Wait for the current action to finish."
    : !targetTable || !flatFlowchart ? "Open a rendered flat flowchart with explicit node declarations." : undefined;

  useEffect(() => {
    if (!project || busy || commandsOpen || outlineOpen || readabilityOpen || comparison || storyOpen || savedScenesOpen
      || editHeading || editFlowchart || editSource || detachOpen || insertOpen || assistOpen
      || bulkTextHidden !== undefined || componentHidden !== undefined) return;
    const openCommands = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey
        || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setCommandsOpen(true);
    };
    window.addEventListener("keydown", openCommands);
    return () => window.removeEventListener("keydown", openCommands);
  }, [project, busy, commandsOpen, outlineOpen, readabilityOpen, comparison, storyOpen, savedScenesOpen, editHeading,
    editFlowchart, editSource, detachOpen, insertOpen, assistOpen, bulkTextHidden, componentHidden]);

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
    setEditTarget(id);
    setEditFlowchart("setNodeLabel");
  }
  function openConnection() {
    if (editingUnavailable || !nodes.length) return;
    setEditTarget(selectedSource);
    setEditFlowchart("addEdge");
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
    { id: "external-assistant", title: "External assistant file exchange", category: "Advanced", synonyms: ["request file", "import AI proposal"],
      unavailable: busy ? "Wait for the current action to finish." : flatFlowchart && targetTable ? undefined : "Open a supported flat flowchart.",
      run: () => setAssistOpen(true) },
    { id: "edit-heading", title: "Edit heading", category: "Project", synonyms: ["title", "rename project"], run: openHeading },
    { id: "show-source", title: "Show Mermaid source", category: "Project", synonyms: ["open source", "code"], run: showSource },
    { id: "edit-source", title: "Edit Mermaid source", category: "Project", synonyms: ["update source", "code"],
      unavailable: busy ? "Wait for the current action to finish." : targetTable ? undefined : "Open a verified flowchart before editing its source.", run: () => setEditSource(true) },
    { id: "insert-component", title: "Insert component", category: "Diagram", synonyms: ["add reusable pattern", "component library"],
      unavailable: editingUnavailable, run: () => setInsertOpen(true) },
    { id: "detach-component", title: "Detach component", category: "Diagram", synonyms: ["component instance"],
      unavailable: busy ? "Wait for the current action to finish." : project?.componentInstances.length ? undefined : "This project has no component instances.",
      run: () => setDetachOpen(true) },
    { id: "find-element", title: "Find element", category: "Diagram", synonyms: ["outline", "relationships"],
      unavailable: outlineAvailable ? undefined : "A verified flowchart is needed to show its elements.", run: () => setOutlineOpen(true) },
    { id: "check-readability", title: "Check readability", category: "Design", synonyms: ["quality", "label size"],
      unavailable: targetTable?.targets.length ? undefined : "A verified flowchart is needed for readability checks.", run: openReadability },
    { id: "explore-designs", title: "Explore designs", category: "Design", synonyms: ["design recipes", "compare styles"],
      unavailable: outlineAvailable ? undefined : "A verified flowchart is needed to compare designs.", run: () => setComparison("design") },
    { id: "compare-layouts", title: "Compare layouts", category: "Design", synonyms: ["direction", "spacing", "layout alternatives"],
      unavailable: outlineAvailable ? undefined : "A verified flowchart is needed to compare layouts.", run: () => setComparison("layout") },
    { id: "suggest-scenes", title: "Suggest scenes", category: "Story", synonyms: ["group story", "storyboard"],
      unavailable: outlineAvailable ? undefined : "A verified flowchart is needed to suggest scenes.", run: () => setStoryOpen(true) },
    { id: "edit-saved-scenes", title: "Edit saved scenes", category: "Story", synonyms: ["scene properties", "storyboard"],
      unavailable: outlineAvailable && project?.storyboard.scenes.length ? undefined : "Open a verified diagram with saved scenes.",
      run: () => setSavedScenesOpen(true) },
    { id: "add-node", title: "Add node", category: "Diagram", unavailable: editingUnavailable, run: () => setEditFlowchart("addNode") },
    { id: "add-next", title: "Add next", category: "Diagram", synonyms: ["connected step", "new connected node"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Choose a current node to connect." : undefined), run: () => setEditFlowchart("addNext") },
    { id: "add-decision", title: "Add decision", category: "Diagram", synonyms: ["branch", "diamond"],
      unavailable: editingUnavailable, run: () => setEditFlowchart("addDecision") },
    { id: "rename-node", title: "Rename node", category: "Diagram", unavailable: editingUnavailable ?? (!nodes.length ? "Wait for the diagram's nodes." : undefined), run: () => setEditFlowchart("setNodeLabel") },
    { id: "connect-nodes", title: "Connect nodes", category: "Diagram", synonyms: ["add edge", "add connection"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Wait for the diagram's nodes." : undefined), run: openConnection },
    { id: "create-group", title: "Create group", category: "Diagram", synonyms: ["group nodes", "add subgraph"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Choose current node declarations." : undefined), run: () => setEditFlowchart("addGroup") },
    { id: "ungroup", title: "Ungroup", category: "Diagram", synonyms: ["remove container", "keep group members"],
      unavailable: busy ? "Wait for the current action to finish." : removableGroup ? undefined : "Open a rendered flowchart with one supported top-level group.",
      run: () => setEditFlowchart("removeGroup") },
    { id: "rename-connection", title: "Edit connection label", category: "Diagram", synonyms: ["rename edge", "label relationship"],
      unavailable: editingUnavailable ?? (!edges.some(edge => edge.explicit) ? "Choose a connection with an explicit source ID." : undefined),
      run: () => setEditFlowchart("setEdgeLabel") },
    { id: "remove-connection", title: "Delete connection", category: "Diagram", synonyms: ["remove edge", "delete edge"],
      unavailable: editingUnavailable ?? (!edges.some(edge => edge.explicit) ? "Choose a connection with an explicit source ID." : undefined), run: () => setEditFlowchart("removeEdge") },
    { id: "remove-node", title: "Delete node", category: "Diagram", synonyms: ["remove step", "delete step"],
      unavailable: editingUnavailable ?? (nodes.length < 2 ? "Keep at least one node in the diagram." : undefined), run: () => setEditFlowchart("removeNode") },
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
              <p className="muted-note">{removableGroup ? "Ungroup is available for this diagram. Other visual edits need a flat flowchart."
                : "Visual edits support flat flowcharts with explicit node declarations."}</p>
            )}
            <div className="recovery-actions">
              <button className="button secondary" disabled={busy} aria-keyshortcuts="Control+K Meta+K" onClick={() => setCommandsOpen(true)}>Commands</button>
              {outlineAvailable && <button className="button secondary" disabled={busy} onClick={() => setOutlineOpen(true)}>Outline</button>}
              {!!targetTable?.targets.length && <button className="button secondary" disabled={busy} onClick={openReadability}>Check readability</button>}
              {outlineAvailable && <button className="button secondary" disabled={busy} onClick={() => setComparison("design")}>Explore designs</button>}
              {outlineAvailable && <button className="button secondary" disabled={busy} onClick={() => setComparison("layout")}>Compare layouts</button>}
              {outlineAvailable && <button ref={suggestScenesButton} className="button secondary" disabled={busy} onClick={() => setStoryOpen(true)}>Suggest scenes</button>}
              {outlineAvailable && !!project.storyboard.scenes.length && <button className="button secondary"
                disabled={busy} onClick={() => setSavedScenesOpen(true)}>Edit saved scenes</button>}
              <button className="button secondary" disabled={busy} onClick={openHeading}>Edit heading</button>
              {targetTable && <button className="button secondary" disabled={busy} onClick={() => setEditSource(true)}>Edit Mermaid source</button>}
              {!!project.componentInstances.length && <button className="button secondary" disabled={busy} onClick={() => setDetachOpen(true)}>Detach component</button>}
              {targetTable && flatFlowchart && (
                <button className="button secondary" disabled={busy} onClick={() => setEditFlowchart("addNode")}>Edit flowchart</button>
              )}
              {removableGroup && <button className="button secondary" disabled={busy} onClick={() => setEditFlowchart("removeGroup")}>Ungroup</button>}
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
        onRename={renameFromOutline} onSource={jumpToSource} onBulkText={setBulkTextHidden}
        onConnect={!editingUnavailable && selectedSource ? openConnection : undefined}
        onDesign={flatFlowchart ? hidden => {
          setComparisonSelection({ ids: [...outlineSelection], hidden });
          setOutlineOpen(false);
          setComparison("design");
        } : undefined} onSaveComponent={flatFlowchart ? setComponentHidden : undefined}
        onResetDesign={canResetDesign ? hidden => setDesignReset({ selection: new Set(outlineSelection), hidden }) : undefined}
        onDeleteConnections={flatFlowchart && !editingUnavailable ? hidden => {
          setDeleteConnections({ ids: [...outlineSelection], hidden });
          setEditFlowchart("removeEdges");
        } : undefined} />}
      {componentHidden !== undefined && currentFrame && editor.current && connection.current && <Suspense>
        <SaveComponentDialog db={connection.current} editor={editor.current} frame={currentFrame.rendered}
          selection={outlineSelection} hidden={componentHidden} onClose={() => setComponentHidden(undefined)} />
      </Suspense>}
      {bulkTextHidden !== undefined && currentFrame && editor.current && <BulkTextColorDialog
        editor={editor.current} frame={currentFrame.rendered} selection={outlineSelection} hidden={bulkTextHidden}
        onClose={() => setBulkTextHidden(undefined)} onApply={proposal => {
          const current = editor.current!;
          const status = current.applyBulkText(proposal);
          if (status === "applied") {
            setOutlineOpen(false);
            setProject(current.snapshot());
          }
          return status;
        }} />}
      {designReset && targetTable && editor.current && <Suspense>
        <DesignResetDialog editor={editor.current} token={targetTable.baseToken} selection={designReset.selection} hidden={designReset.hidden} initialField={designReset.field}
          onClose={() => setDesignReset(undefined)} onApply={proposal => {
            const current = editor.current!;
            const status = current.applyDesignReset(proposal);
            if (status === "applied") {
              setOutlineOpen(false);
              setProject(current.snapshot());
            }
            return status;
          }} />
      </Suspense>}
      {readabilityTargets && currentFrame && targetTable && editor.current && <ReadabilityDialog frame={currentFrame.geometry} targets={readabilityTargets}
        token={targetTable.baseToken} editor={editor.current} canvas={canvasProfile}
        dismissed={dismissedReadability} onDismissed={setDismissedReadability}
        onCompareLayouts={() => { setReadabilityOpen(false); setComparison("layout"); }}
        onRename={!editingUnavailable ? id => { setReadabilityOpen(false); renameFromOutline(id); } : undefined}
        onResetRolePaint={(id, field) => {
          setReadabilityOpen(false);
          setDesignReset({ selection: new Set([id]), hidden: 0, field });
        }}
        onClose={() => setReadabilityOpen(false)} onApply={proposal => {
          const current = editor.current!;
          const status = current.applyContrast(proposal);
          if (status === "applied") setProject(current.snapshot());
          return status;
        }} />}
      {comparison && currentFrame && editor.current && <V3ComparisonDialog mode={comparison} allowDirection={flatFlowchart}
        editor={editor.current} currentUrl={currentFrame.url}
        currentSize={currentFrame.geometry} selection={comparisonSelection} selectedRoleCounts={selectedRoleCounts} onClose={() => {
          setComparisonSelection(undefined);
          setComparison(undefined);
        }} onApply={proposal => {
          const current = editor.current!;
          const status = comparison === "layout" ? current.applyLayout(proposal) : current.applyDesign(proposal);
          if (status === "applied") setProject(current.snapshot());
          return status;
        }} />}
      {storyOpen && targetTable && editor.current && connection.current && <V3GroupStoryDialog editor={editor.current} db={connection.current} table={targetTable}
        draft={storyDraft} onDraft={setStoryDraft} onOpenCopy={onOpenCopy} onClose={() => setStoryOpen(false)} onApply={proposal => {
          const current = editor.current!;
          const status = current.applyStory(proposal);
          if (status === "applied") {
            setProject(current.snapshot());
            setStoryDraft(initialGroupStoryDraft);
          }
          return status;
        }} />}
      {savedScenesOpen && editor.current && <Suspense>
        <SavedScenesDialog editor={editor.current} onClose={() => {
          setSavedScenesOpen(false);
          if (!editor.current?.snapshot().storyboard.scenes.length) requestAnimationFrame(() => suggestScenesButton.current?.focus());
        }} onOrderChange={(...args) => {
          const current = editor.current!;
          const status = current.editStorySceneOrder(...args);
          if (status === "applied") setProject(current.snapshot());
          return status;
        }} onApply={proposal => {
          const current = editor.current!;
          const status = current.applyStory(proposal);
          if (status === "applied") setProject(current.snapshot());
          return status;
        }} />
      </Suspense>}
      {project && editHeading && (
        <HeadingEditor document={project} field="title" revision={project.revision} outcome={outcome}
          prepare={(_base, envelope) => editor.current!.prepareHeading(envelope)}
          onApply={applyHeading} onClose={() => setEditHeading(false)} />
      )}
      {detachOpen && editor.current && <DetachComponentDialog editor={editor.current} table={targetTable}
        onClose={() => setDetachOpen(false)} onApplied={() => {
          setDetachOpen(false);
          setProject(editor.current!.snapshot());
        }} />}
      {insertOpen && editor.current && <Suspense>
        <ComponentProjectDialog onBack={() => setInsertOpen(false)} onClose={() => setInsertOpen(false)}
          insertion={{ editor: editor.current, nodes, onApplied: () => {
            setInsertOpen(false);
            setProject(editor.current!.snapshot());
          } }} />
      </Suspense>}
      {assistOpen && project && targetTable && edgeLabels && flatFlowchart && connection.current && editor.current && <Suspense>
        <AssistExchangeDialog db={connection.current} editor={editor.current} project={project} table={targetTable} edgeLabels={edgeLabels}
          onClose={() => setAssistOpen(false)} onApplied={() => {
            setAssistOpen(false);
            setProject(editor.current!.snapshot());
          }} />
      </Suspense>}
      {editSource && editor.current && <V3SourceEditor editor={editor.current} savedDraft={sourceDraft} onDraft={setSourceDraft}
        onClose={() => setEditSource(false)} onApply={proposal => {
          const current = editor.current!;
          const result = current.applyStructure(proposal);
          if (result.status === "applied") {
            setSourceDraft(undefined);
            setProject(current.snapshot());
          }
          return result.status;
        }} />}
      {editFlowchart && editor.current && (
        <V3StructureEditor editor={editor.current} nodes={nodes} edges={edges} group={removableGroup} initialOperation={editFlowchart} initialTarget={editTarget}
          deleteConnections={deleteConnections}
          onClose={() => { setEditFlowchart(undefined); setEditTarget(undefined); setDeleteConnections(undefined); }}
          onApply={proposal => {
            const current = editor.current!;
            const result = current.applyStructure(proposal);
            if (result.status === "applied") {
              if (deleteConnections) {
                setOutlineSelection(new Set());
                setOutlineOpen(false);
              }
              setProject(current.snapshot());
            }
            return result.status;
          }} />
      )}
    </>
  );
}
