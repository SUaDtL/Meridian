import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import BulkTextColorDialog from "./BulkTextColorDialog";
import HeadingEditor from "./HeadingEditor";
import CommandPalette from "./CommandPalette";
import Modal from "./Modal";
import V3ProjectOutline, { type OutlineView } from "./V3ProjectOutline";
import ReadabilityDialog, { initialReadabilityProfile, type ReadabilityProfileChoice } from "./ReadabilityDialog";
import V3ComparisonDialog from "./V3ComparisonDialog";
import V3GroupStoryDialog, { initialGroupStoryDraft } from "./V3GroupStoryDialog";
import type { ManualSceneSelection } from "./V3SavedScenesDialog";
import V3StructureEditor from "./V3StructureEditor";
import type { SourceDraft } from "./V3SourceEditor";
import DetachComponentDialog from "./DetachComponentDialog";
import { designResetFields } from "../lib/authoring/design-reset";
import type { MermaidProjectV3, SemanticRole } from "../lib/authoring/mermaid-project";
import { openStoredProjectEditor } from "../lib/authoring/project-editor";
import { renderMermaidProject } from "../lib/authoring/project-render";
import { interactiveSelectionLimit, projectOutline, type OutlineSourceLocation } from "../lib/authoring/project-outline";
import { flowchartSubsetTopology, groupContentsDeletionScopes, planGroupCreation, supportedGroupMoveTargets, supportedGroupRemovals,
  supportedUngroupSourceId, supportsComponentInsertion } from "../lib/authoring/source-patches";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { WorkspaceCommand } from "../lib/authoring/command-search";
import type { NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import type { GuidedAttachment } from "../lib/authoring/guided-systems-insertion";
import { emptyGuidedAttachment } from "./GuidedAttachmentPicker";
import type { GuidedProcessDraft } from "./GuidedProcessDialog";
import type { ProcessStep } from "../lib/authoring/process-steps";
import type { ProcessConnections } from "../lib/authoring/process-connections";
import type { SystemsDraft } from "../lib/authoring/systems-draft";
import { emptySystemsSession } from "../lib/authoring/systems-session";
import { rolePaintFields, type ReadabilityTarget, type RolePaintField, type ViewingProfile } from "../lib/authoring/readability";
import { buildReadabilityHighlight } from "../lib/authoring/readability-highlight";
import { buildExportFrame, buildMermaidProjectPresentation, type ExportFrame, type ExportFrameOptions } from "../lib/export";
import type { ProjectSaveState } from "../lib/persistence/project-save-queue";
import { openWorkspaceDatabase, saveWorkspaceProjectCopy } from "../lib/persistence/workspace-db";
import { downloadText, safeFilename, serializeProject } from "../lib/storage";
import type { ProposalOutcome } from "../lib/workspace";

const SaveComponentDialog = lazy(() => import("./SaveComponentDialog"));
const ComponentProjectDialog = lazy(() => import("./ComponentProjectDialog"));
const AssistExchangeDialog = lazy(() => import("./AssistExchangeDialog"));
const SavedScenesDialog = lazy(() => import("./V3SavedScenesDialog"));
const DesignResetDialog = lazy(() => import("./DesignResetDialog"));
const OrphanReviewDialog = lazy(() => import("./OrphanReviewDialog"));
const V3SourceEditor = lazy(() => import("./V3SourceEditor"));
const ExportDialog = lazy(() => import("./ExportDialog"));
const GuidedSystemsDialog = lazy(() => import("./GuidedSystemsDialog"));
const GuidedProcessDialog = lazy(() => import("./GuidedProcessDialog"));

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Frame = { document: MermaidProjectV3; rendered: Awaited<ReturnType<typeof renderMermaidProject>>; geometry: Omit<ExportFrame, "svg">; url: string };

const emptyGuidedProcess: GuidedProcessDraft = { title: "Process draft", text: "" };

const workspacePanels = ["Build", "Canvas", "Design", "Story"] as const;
type WorkspacePanel = typeof workspacePanels[number];

function measureCanvas(image: HTMLImageElement | null): ViewingProfile | undefined {
  const bounds = image?.getBoundingClientRect();
  return bounds && bounds.width >= 100 && bounds.height >= 100
    ? { width: Math.floor(bounds.width), height: Math.floor(bounds.height), padding: 0 } : undefined;
}

export default function V3ProjectSession({ id, onBack, onOpenCopy }: {
  id: string; onBack: () => void; onOpenCopy: (id: string) => void;
}) {
  const connection = useRef<IDBDatabase | undefined>(undefined);
  const editor = useRef<Editor | undefined>(undefined);
  const inFlight = useRef(false);
  const [project, setProject] = useState<MermaidProjectV3>();
  const [save, setSave] = useState<ProjectSaveState>();
  const [frame, setFrame] = useState<Frame>();
  const [framedTargets, setFramedTargets] = useState<{ frame: Frame; url: string; count: number }>();
  const [error, setError] = useState("");
  const [renderError, setRenderError] = useState("");
  const [drawingAttempt, setDrawingAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editHeading, setEditHeading] = useState(false);
  const [editFlowchart, setEditFlowchart] = useState<NativeFlowchartEdit["op"]>();
  const [assistOpen, setAssistOpen] = useState(false);
  const [editSource, setEditSource] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [guidedKind, setGuidedKind] = useState<"systems" | "process">();
  const [guidedSystems, setGuidedSystems] = useState(emptySystemsSession);
  const [guidedSystemsAttachment, setGuidedSystemsAttachment] = useState(emptyGuidedAttachment);
  const [guidedProcess, setGuidedProcess] = useState(emptyGuidedProcess);
  const [guidedProcessAttachment, setGuidedProcessAttachment] = useState(emptyGuidedAttachment);
  const guidedNeedsRefresh = useRef(false);
  const [detachOpen, setDetachOpen] = useState(false);
  // The mounted source editor owns its draft. Retain a copy for reopening
  // without updating the workspace behind the dialog on every keystroke.
  const sourceDraft = useRef<SourceDraft | undefined>(undefined);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [componentHidden, setComponentHidden] = useState<number>();
  const [bulkTextHidden, setBulkTextHidden] = useState<number>();
  const [designReset, setDesignReset] = useState<{ selection: ReadonlySet<string>; hidden: number; field?: RolePaintField }>();
  const [deleteConnections, setDeleteConnections] = useState<{ ids: string[]; hidden: number }>();
  const [groupMembers, setGroupMembers] = useState<{ ids: string[]; hidden: number }>();
  const [mobilePanel, setMobilePanel] = useState<WorkspacePanel>("Canvas");
  const canvasPanelButton = useRef<HTMLButtonElement>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [restoredOutline, setRestoredOutline] = useState<OutlineView>();
  const [outlineReturn, setOutlineReturn] = useState<{ source: string; view: OutlineView }>();
  const [orphanReviewOpen, setOrphanReviewOpen] = useState(false);
  const [outlineSelection, setOutlineSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [canvasMessage, setCanvasMessage] = useState("");
  const [editTarget, setEditTarget] = useState<string>();
  const [highlight, setHighlight] = useState<(OutlineSourceLocation & { source: string })>();
  const [dismissedReadability, setDismissedReadability] = useState<ReadonlySet<string>>(new Set());
  const [readabilityOpen, setReadabilityOpen] = useState(false);
  const [readabilityViewing, setReadabilityViewing] = useState<ReadabilityProfileChoice>();
  const [comparisonSelection, setComparisonSelection] = useState<{ ids: string[]; hidden: number }>();
  const [comparison, setComparison] = useState<"design" | "layout">();
  const [storyOpen, setStoryOpen] = useState(false);
  const [savedScenesOpen, setSavedScenesOpen] = useState<"edit" | "create">();
  const [savedSceneScope, setSavedSceneScope] = useState<ManualSceneSelection>();
  const [storyDraft, setStoryDraft] = useState(initialGroupStoryDraft);
  const [canvasProfile, setCanvasProfile] = useState<ViewingProfile>();
  const previewImage = useRef<HTMLImageElement>(null);
  const measuredCanvas = useRef<{ profile: ViewingProfile; url: string; viewport: string }>(undefined);
  const fitDiagram = useRef<HTMLButtonElement>(null);
  const suggestScenesButton = useRef<HTMLButtonElement>(null);
  const outlineButton = useRef<HTMLButtonElement>(null);
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
    setFramedTargets(undefined);
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
  }, [project, drawingAttempt]);
  useEffect(() => () => { if (framedTargets) URL.revokeObjectURL(framedTargets.url); }, [framedTargets]);

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
  const focusedFrame = framedTargets?.frame === currentFrame ? framedTargets : undefined;
  const previewUrl = focusedFrame?.url ?? currentFrame?.url;
  useEffect(() => {
    const image = previewImage.current;
    if (!image || !previewUrl) return;
    const observer = new ResizeObserver(() => {
      const profile = measureCanvas(image);
      if (profile) measuredCanvas.current = { profile, url: previewUrl, viewport: `${window.innerWidth}x${window.innerHeight}` };
    });
    observer.observe(image);
    return () => observer.disconnect();
  }, [previewUrl]);
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
  const componentSourceSupported = useMemo(() => flatFlowchart || (!!source && supportsComponentInsertion(source)), [source, flatFlowchart]);
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
        solidTextPaint: paint?.solidTextPaint, solidConnectorPaint: paint?.solidConnectorPaint, labelOverflowInDiagram: paint?.labelOverflowInDiagram,
        measuredRoute: element?.measuredRoute, rolePaint: role && tokens.length ? { role, tokens } : undefined };
    });
  }, [readabilityOpen, currentFrame, targetTable]);
  const identities = project?.identity.elements;
  const nodes = useMemo(() => {
    const ids = new Map(identities?.map(record => [record.id, record.binding.sourceId]));
    return targetTable?.targets.filter(item => item.elementKind === "node")
      .map(item => ({ id: item.id, label: `${item.label} (${ids.get(item.id)})`, text: item.label })) ?? [];
  }, [identities, targetTable]);
  const edgeLabels = currentFrame?.rendered.edgeLabels;
  const edges = useMemo(() => {
    const ids = new Map(identities?.filter(record => record.status === "resolved" && record.binding.type === "edge-id")
      .map(record => [record.id, record.binding.sourceId]));
    return targetTable?.targets.flatMap(item => item.elementKind === "edge"
      ? [{ id: item.id, label: ids.has(item.id) ? `${item.label} (${ids.get(item.id)})` : item.label,
        sourceId: item.sourceId, targetId: item.targetId, direction: item.direction, explicit: ids.has(item.id), text: edgeLabels?.get(item.id) ?? "" }] : []) ?? [];
  }, [identities, targetTable, edgeLabels]);
  const selectedCanvasNode = outlineSelection.size === 1 ? nodes.find(node => outlineSelection.has(node.id)) : undefined;
  const selectedSource = selectedCanvasNode?.id;
  const selectedCanvasBounds = targetTable?.targets.filter(target => target.elementKind === "node" && outlineSelection.has(target.id)) ?? [];
  const canGroupWithinParent = useMemo(() => {
    if (!source || flatFlowchart || !componentSourceSupported || !outlineSelection.size) return false;
    const members = identities?.filter(record => outlineSelection.has(record.id) && record.elementKind === "node"
      && record.status === "resolved").map(record => record.binding.sourceId);
    if (members?.length !== outlineSelection.size) return false;
    try { planGroupCreation(source, members, "New group"); return true; }
    catch { return false; }
  }, [source, flatFlowchart, componentSourceSupported, identities, outlineSelection]);
  const removableGroup = useMemo(() => {
    const identity = identities?.find(record => record.status === "resolved" && record.elementKind === "group"
      && record.binding.sourceId === ungroupSourceId);
    const target = targetTable?.targets.find(item => item.id === identity?.id && item.elementKind === "group");
    return target ? { id: target.id, label: target.label || "Diagram group", members: target.members } : undefined;
  }, [identities, targetTable, ungroupSourceId]);
  const ungroupableGroups = useMemo(() => {
    const allowed = new Set(source && !flatFlowchart ? supportedGroupRemovals(source) : []);
    const ids = new Set(identities?.filter(record => record.status === "resolved" && record.elementKind === "group"
      && allowed.has(record.binding.sourceId)).map(record => record.id));
    return new Map(targetTable?.targets.filter(target => target.elementKind === "group" && ids.has(target.id))
      .map(target => [target.id, { id: target.id, label: target.label || "Diagram group" }]));
  }, [source, flatFlowchart, identities, targetTable]);
  const groupDeletions = useMemo(() => {
    const scopes = source && !flatFlowchart && targetTable ? [...groupContentsDeletionScopes(source)] : [];
    const targets = new Map(targetTable?.targets.map(item => [item.id, item]));
    const bindings = new Map(identities?.flatMap(record => {
      const target = targets.get(record.id);
      return record.status === "resolved" && target?.elementKind === record.elementKind
        && (record.elementKind !== "edge" || record.binding.type === "edge-id")
        ? [[`${record.elementKind}:${record.binding.sourceId}`, target] as const] : [];
    }));
    return new Map(scopes.flatMap(([sourceId, scope]) => {
      const target = bindings.get(`group:${sourceId}`);
      if (!target) return [];
      const members = scope.members.flatMap(id => {
        const member = bindings.get(`node:${id}`) ?? bindings.get(`group:${id}`);
        return member ? [{ id: member.id, label: member.label || id, kind: member.elementKind }] : [];
      });
      const connectionIds = scope.connections.flatMap(id => {
        const edge = bindings.get(`edge:${id}`);
        return edge ? [edge.id] : [];
      });
      const unavailable = scope.unavailable ?? (members.length !== scope.members.length || connectionIds.length !== scope.connections.length
        ? "The full diagram deletion could not be verified." : undefined);
      return [[target.id, { group: { id: target.id, label: target.label || "Diagram group" }, members, connectionIds, unavailable }] as const];
    }));
  }, [source, flatFlowchart, identities, targetTable]);
  const defaultGroupDeletion = removableGroup && groupDeletions.get(removableGroup.id);
  const groupMoveOptions = useMemo(() => {
    if (!source || flatFlowchart || !targetTable) return new Map<string, { group: { id: string; label: string }; nodes: typeof nodes }>();
    const allowed = supportedGroupMoveTargets(source);
    const bindings = new Map(identities?.filter(record => record.status === "resolved").map(record => [record.id, record.binding.sourceId]));
    return new Map(targetTable.targets.flatMap(target => {
      const valid = target.elementKind === "group" ? allowed.get(bindings.get(target.id) ?? "") : undefined;
      if (!valid) return [];
      const validIds = new Set(valid);
      const available = nodes.filter(item => validIds.has(bindings.get(item.id) ?? ""));
      return available.length ? [[target.id, {
        group: { id: target.id, label: target.label || "Diagram group" }, nodes: available,
      }] as const] : [];
    }));
  }, [source, flatFlowchart, targetTable, identities, nodes]);
  const currentMoveGroup = editFlowchart === "moveToGroup" && editTarget ? groupMoveOptions.get(editTarget) : undefined;
  const groupRemoval = editTarget ? (editFlowchart === "removeGroupContents" ? groupDeletions.get(editTarget) : undefined) : defaultGroupDeletion;
  const structureGroup = editFlowchart === "removeGroup" && editTarget
    ? ungroupableGroups.get(editTarget) : currentMoveGroup?.group ?? groupRemoval?.group ?? removableGroup;
  const movableNodes = groupMoveOptions.get(structureGroup?.id ?? "")?.nodes ?? [];
  const defaultMoveAvailable = !!removableGroup && groupMoveOptions.has(removableGroup.id);
  const needsRecovery = save?.phase === "conflict" || save?.phase === "error";
  const editingUnavailable = busy ? "Wait for the current action to finish."
    : !targetTable || !flatFlowchart ? "Open a rendered flat flowchart with explicit node declarations." : undefined;
  const labelEditingUnavailable = busy ? "Wait for the current action to finish."
    : !targetTable || !componentSourceSupported ? "Open a rendered flowchart with explicit node declarations." : undefined;

  useEffect(() => {
    if (!project || busy || commandsOpen || outlineOpen || orphanReviewOpen || readabilityOpen || comparison || storyOpen || savedScenesOpen
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
  }, [project, busy, commandsOpen, outlineOpen, orphanReviewOpen, readabilityOpen, comparison, storyOpen, savedScenesOpen, editHeading,
    editFlowchart, editSource, detachOpen, insertOpen, assistOpen, bulkTextHidden, componentHidden]);

  function openHeading() { setOutcome(undefined); setEditHeading(true); }
  function openReadability() {
    const previous = measuredCanvas.current;
    const fit = measureCanvas(previewImage.current) ?? (previous && previous.url === previewUrl
      && previous.viewport === `${window.innerWidth}x${window.innerHeight}` ? previous.profile : undefined);
    setCanvasProfile(fit);
    setReadabilityViewing(current => current ?? initialReadabilityProfile(fit));
    setReadabilityOpen(true);
  }
  function showSource() {
    if (!sourceDetails.current) return;
    setMobilePanel("Build");
    sourceDetails.current.open = true;
    requestAnimationFrame(() => sourceDetails.current?.querySelector("summary")?.focus());
  }
  function openOutline(view?: OutlineView) {
    setRestoredOutline(view);
    setOutlineOpen(true);
  }

  function jumpToSource(location: OutlineSourceLocation, view?: OutlineView) {
    if (!source || !sourceDetails.current) return;
    setOutlineOpen(false);
    setHighlight({ ...location, source });
    setOutlineReturn(view ? { source, view } : undefined);
    setMobilePanel("Build");
    sourceDetails.current.open = true;
    requestAnimationFrame(() => sourceMark.current?.focus());
  }
  function closeStructureEditor() {
    setEditFlowchart(undefined);
    setEditTarget(undefined);
    setDeleteConnections(undefined);
    setGroupMembers(undefined);
  }

  function openBlockedDeletionSource(id: string) {
    if (!project || !targetTable) return;
    const location = projectOutline(project, targetTable).find(item => item.id === id)?.source;
    closeStructureEditor();
    if (location) jumpToSource(location);
    else {
      setHighlight(undefined);
      setOutlineReturn(undefined);
      showSource();
    }
  }
  function frameOutlineTargets(ids: readonly string[], closeOutline: boolean) {
    if (!currentFrame) return "The current diagram is still rendering. Try framing again when it is ready.";
    try {
      const svg = buildReadabilityHighlight(currentFrame.rendered, currentFrame.document, ids, true);
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setFramedTargets({ frame: currentFrame, url, count: ids.length });
      if (closeOutline) {
        setMobilePanel("Canvas");
        setOutlineOpen(false);
        requestAnimationFrame(() => fitDiagram.current?.focus());
      }
      return undefined;
    } catch (reason) {
      return reason instanceof Error ? reason.message : "The selected elements could not be framed.";
    }
  }
  function selectCanvasNode(event: MouseEvent<HTMLImageElement>) {
    if (!currentFrame || !targetTable || focusedFrame || busy) return;
    const { width, height, diagramScale, diagramOrigin } = currentFrame.geometry;
    const box = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(box.width / width, box.height / height);
    if (scale <= 0 || !Number.isFinite(diagramOrigin.x) || !Number.isFinite(diagramOrigin.y)) return;
    const x = ((event.clientX - box.left - (box.width - width * scale) / 2) / scale - diagramOrigin.x) / diagramScale;
    const y = ((event.clientY - box.top - (box.height - height * scale) / 2) / scale - diagramOrigin.y) / diagramScale;
    const matches = targetTable.targets.filter(({ elementKind, bounds }) => elementKind === "node"
      && x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height);
    if (matches.length > 1) {
      setCanvasMessage("These nodes overlap here. Choose the exact node in Outline.");
      return;
    }
    const node = matches[0];
    const next = event.shiftKey ? new Set(outlineSelection) : new Set<string>();
    if (node) {
      if (event.shiftKey && next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
    }
    if (next.size > interactiveSelectionLimit) {
      setCanvasMessage(`The selection limit is ${interactiveSelectionLimit} elements. ${outlineSelection.size} are selected.`);
      return;
    }
    setCanvasMessage("");
    setOutlineSelection(next);
  }

  function renameNode(id: string) {
    if (labelEditingUnavailable || !nodes.some(node => node.id === id)) return;
    setOutlineOpen(false);
    setEditTarget(id);
    setEditFlowchart("setNodeLabel");
  }
  function openConnection() {
    if (editingUnavailable || !nodes.length) return;
    setEditTarget(selectedSource);
    setEditFlowchart("addEdge");
  }
  function applyHistory(direction: "undo" | "redo") {
    const current = editor.current;
    if (!current?.[direction]()) return undefined;
    const next = current.snapshot();
    setProject(next);
    return next;
  }
  function changeHistory(direction: "undo" | "redo") {
    void run(async () => { applyHistory(direction); });
  }
  function downloadProject() {
    if (project) downloadText(serializeProject(project), `${safeFilename(title)}.meridian.json`);
  }
  async function savePresentation(options?: ExportFrameOptions) {
    if (!project || !currentFrame?.rendered.targetTable) {
      throw new Error("Render the current project before exporting its presentation.");
    }
    const html = await buildMermaidProjectPresentation(currentFrame.rendered, project, options);
    downloadText(html, `${safeFilename(title)}.html`, "text/html;charset=utf-8");
  }
  function downloadPresentation() {
    void run(() => savePresentation());
  }
  async function reviewGuidedInsertion<T>(prepare: (target: Editor) => Promise<T>, signal: AbortSignal) {
    const current = editor.current;
    if (!current) throw new Error("Open the saved project before previewing your insertion.");
    if (!guidedNeedsRefresh.current) return prepare(current);
    if (current.saveState().phase !== "saved" || !connection.current) {
      throw new Error("Save your current changes before refreshing the insertion target.");
    }
    const refreshed = await openStoredProjectEditor(connection.current, id, setSave);
    try {
      return await prepare(refreshed);
    } finally {
      if (signal.aborted || editor.current !== current) refreshed.close();
      else {
        adoptEditor(refreshed);
        guidedNeedsRefresh.current = false;
      }
    }
  }

  function reviewGuidedSystems(values: SystemsDraft, attachment: GuidedAttachment | undefined, signal: AbortSignal) {
    return reviewGuidedInsertion(target => target.prepareGuidedSystems(values, attachment, signal), signal);
  }

  function reviewGuidedProcess(steps: readonly ProcessStep[], connections: ProcessConnections | undefined,
    attachment: GuidedAttachment | undefined, signal: AbortSignal) {
    return reviewGuidedInsertion(target => target.prepareGuidedProcess(steps, connections, attachment, signal), signal);
  }

  async function insertGuidedDiagram(proposal: ReadyProposal, signal?: AbortSignal) {
    const current = editor.current;
    if (!current) return "stale";
    const outcome = await current.applyGuidedInsertion(proposal, signal);
    if (outcome === "applied") setProject(current.snapshot());
    else guidedNeedsRefresh.current = true;
    return outcome;
  }

  const commands: WorkspaceCommand[] = [
    { id: "insert-guided-systems", title: "Insert systems diagram", category: "Diagram", synonyms: ["guided systems", "add systems"],
      unavailable: busy || !targetTable || !componentSourceSupported ? "Open a supported flowchart before inserting systems." : undefined,
      run: () => setGuidedKind("systems") },
    { id: "insert-guided-process", title: "Insert process diagram", category: "Diagram", synonyms: ["guided process", "add process steps"],
      unavailable: busy || !targetTable || !componentSourceSupported ? "Open a supported flowchart before inserting a process." : undefined,
      run: () => setGuidedKind("process") },
    { id: "export-diagram", title: "Export diagram", category: "Export", synonyms: ["PNG", "SVG", "Mermaid"],
      run: () => setExportOpen(true) },
    { id: "external-assistant", title: "External assistant file exchange", category: "Advanced", synonyms: ["request file", "import AI proposal"],
      unavailable: busy ? "Wait for the current action to finish." : flatFlowchart && targetTable ? undefined : "Open a supported flat flowchart.",
      run: () => setAssistOpen(true) },
    { id: "edit-heading", title: "Edit heading", category: "Project", synonyms: ["title", "rename project"], run: openHeading },
    { id: "show-source", title: "Show Mermaid source", category: "Project", synonyms: ["open source", "code"], run: showSource },
    { id: "edit-source", title: "Edit Mermaid source", category: "Project", synonyms: ["update source", "code"],
      unavailable: busy ? "Wait for the current action to finish." : targetTable ? undefined : "Open a verified flowchart before editing its source.", run: () => setEditSource(true) },
    { id: "insert-component", title: "Insert component", category: "Diagram", synonyms: ["add reusable pattern", "component library"],
      unavailable: busy ? "Wait for the current action to finish." : targetTable && componentSourceSupported ? undefined
        : "Open a rendered flowchart with supported declarations and group membership.",
      run: () => setInsertOpen(true) },
    { id: "detach-component", title: "Detach component", category: "Diagram", synonyms: ["component instance"],
      unavailable: busy ? "Wait for the current action to finish." : project?.componentInstances.length ? undefined : "This project has no component instances.",
      run: () => setDetachOpen(true) },
    { id: "review-orphan-annotations", title: "Review unresolved annotations", category: "Diagram",
      synonyms: ["retained annotations", "orphan records", "cleanup"],
      unavailable: project?.identity.orphans.length ? undefined : "This project has no unresolved annotations.",
      run: () => setOrphanReviewOpen(true) },
    { id: "find-element", title: "Find element", category: "Diagram", synonyms: ["outline", "relationships"],
      unavailable: outlineAvailable ? undefined : "A verified flowchart is needed to show its elements.", run: () => openOutline() },
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
      run: () => setSavedScenesOpen("edit") },
    { id: "create-scene", title: "Create overview scene", category: "Story", synonyms: ["new scene", "manual scene"],
      unavailable: !outlineAvailable ? "Open a verified diagram before creating a scene."
        : project && project.storyboard.scenes.length >= 50 ? "A storyboard can contain at most 50 scenes." : undefined,
      run: () => setSavedScenesOpen("create") },
    { id: "add-node", title: "Add node", category: "Diagram", unavailable: editingUnavailable, run: () => setEditFlowchart("addNode") },
    { id: "add-next", title: "Add next", category: "Diagram", synonyms: ["connected step", "new connected node"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Choose a current node to connect." : undefined), run: () => setEditFlowchart("addNext") },
    { id: "add-decision", title: "Add decision", category: "Diagram", synonyms: ["branch", "diamond"],
      unavailable: editingUnavailable, run: () => setEditFlowchart("addDecision") },
    { id: "rename-node", title: "Rename node", category: "Diagram", unavailable: labelEditingUnavailable ?? (!nodes.length ? "Wait for the diagram's nodes." : undefined), run: () => setEditFlowchart("setNodeLabel") },
    { id: "connect-nodes", title: "Connect nodes", category: "Diagram", synonyms: ["add edge", "add connection"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Wait for the diagram's nodes." : undefined), run: openConnection },
    { id: "create-group", title: "Create group", category: "Diagram", synonyms: ["group nodes", "add subgraph"],
      unavailable: editingUnavailable ?? (!nodes.length ? "Choose current node declarations." : undefined), run: () => setEditFlowchart("addGroup") },
    { id: "ungroup", title: "Ungroup", category: "Diagram", synonyms: ["remove container", "keep group members"],
      unavailable: busy ? "Wait for the current action to finish." : ungroupableGroups.size ? undefined : "Choose a supported group in a rendered flowchart.",
      run: () => removableGroup ? setEditFlowchart("removeGroup") : openOutline() },
    { id: "delete-group-contents", title: "Delete group and contents", category: "Diagram",
      unavailable: busy ? "Wait for the current action to finish." : groupDeletions.size ? undefined
        : "Choose a supported group in a rendered flowchart.",
      run: () => defaultGroupDeletion && !defaultGroupDeletion.unavailable ? setEditFlowchart("removeGroupContents") : openOutline() },
    { id: "move-into-group", title: "Move node into group", category: "Diagram",
      unavailable: busy ? "Wait for the current action to finish." : groupMoveOptions.size ? undefined
        : "Choose a group with an eligible standalone node to move into it.",
      run: () => defaultMoveAvailable ? setEditFlowchart("moveToGroup") : openOutline() },
    { id: "rename-connection", title: "Edit connection label", category: "Diagram", synonyms: ["rename edge", "label relationship"],
      unavailable: labelEditingUnavailable ?? (!edges.some(edge => edge.explicit) ? "Choose a connection with an explicit source ID." : undefined),
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
            <nav className="v3-panel-nav" aria-label="Workspace panels">
              {workspacePanels.map(panel => <button key={panel} type="button" className="button secondary"
                ref={panel === "Canvas" ? canvasPanelButton : undefined} aria-pressed={mobilePanel === panel}
                onClick={() => setMobilePanel(panel)}>{panel}</button>)}
            </nav>
            <div className="v3-panel-workspace" data-active-panel={mobilePanel}>
              <section data-v3-panel="Canvas" aria-label="Diagram canvas" className="migration-preview">
                {currentFrame && <div className="v3-canvas-image">
                  <img ref={previewImage} src={previewUrl} alt={`Diagram preview for ${title}`} draggable={false} onClick={selectCanvasNode} onError={event => {
                    if (event.currentTarget.src !== previewUrl) return;
                    URL.revokeObjectURL(event.currentTarget.src);
                    setFrame(undefined);
                    setFramedTargets(undefined);
                    setCanvasMessage("");
                    setRenderError("The browser could not display the drawing. You can still download the project.");
                  }} />
                  {!focusedFrame && selectedCanvasBounds.length > 0 && (
                    <svg aria-hidden="true" className="v3-canvas-selection" viewBox={`0 0 ${currentFrame.geometry.width} ${currentFrame.geometry.height}`}>
                      {selectedCanvasBounds.map(target => {
                        const { diagramScale, diagramOrigin } = currentFrame.geometry;
                        return <rect key={target.id} x={diagramOrigin.x + target.bounds.x * diagramScale}
                          y={diagramOrigin.y + target.bounds.y * diagramScale} width={target.bounds.width * diagramScale}
                          height={target.bounds.height * diagramScale} vectorEffect="non-scaling-stroke" rx={4} />;
                      })}
                    </svg>
                  )}
                </div>}
                {canvasMessage && <p role="status">{canvasMessage}</p>}
                {!canvasMessage && outlineSelection.size > 1 && <p role="status">{outlineSelection.size} selected</p>}
                {selectedCanvasNode && <div className="recovery-actions" role="group" aria-label="Selected diagram node">
                  <p>{selectedCanvasNode.text} selected</p>
                  <button className="button secondary" disabled={!!labelEditingUnavailable} onClick={() => renameNode(selectedCanvasNode.id)}>Rename selected node</button>
                  <button className="button secondary" disabled={!!editingUnavailable} onClick={openConnection}>Connect selected node</button>
                </div>}
                {focusedFrame && <div className="recovery-actions">
                  <p>Framed around {focusedFrame.count} {focusedFrame.count === 1 ? "element" : "elements"}.</p>
                  <button type="button" className="button quiet" ref={fitDiagram} onClick={() => {
                    setFramedTargets(undefined);
                    const focus = outlineButton.current?.getClientRects().length ? outlineButton.current : canvasPanelButton.current;
                    focus?.focus();
                  }}>Fit full diagram</button>
                </div>}
                {!currentFrame && !renderError && <p role="status">Rendering the current diagram…</p>}
                {renderError && <>
                  <p role="alert">{renderError}</p>
                  <button type="button" className="button secondary" onClick={() => setDrawingAttempt(count => count + 1)}>Retry drawing</button>
                </>}
              </section>
              <section data-v3-panel="Build" aria-label="Build tools">
                <div className="migration-preview">
                  <details ref={sourceDetails}><summary>Mermaid source</summary>
                    {outlineAvailable && outlineReturn && outlineReturn.source === source && <div className="recovery-actions">
                      <button className="button secondary" onClick={() => {
                        openOutline(outlineReturn.view);
                        setOutlineReturn(undefined);
                      }}>Return to outline</button>
                    </div>}
                    <pre>{highlighted ? <>{project.source.slice(0, highlighted.from)}
                      <mark ref={sourceMark} tabIndex={-1} aria-label={`Source line ${highlighted.line}`}>{project.source.slice(highlighted.from, highlighted.to)}</mark>
                      {project.source.slice(highlighted.to)}</> : project.source}</pre>
                  </details>
                </div>
                {targetTable && !flatFlowchart && (
                  <p className="muted-note">{removableGroup ? "Use the group actions below to edit this diagram."
                    : componentSourceSupported ? "Use Outline or Commands to edit labels in this grouped flowchart."
                    : "Open Mermaid source to edit this diagram."}</p>
                )}
                <div className="recovery-actions">
                  {outlineAvailable && <button ref={outlineButton} className="button secondary" disabled={busy} onClick={() => openOutline()}>Outline</button>}
                  {project.identity.orphans.length > 0 && <button className="button secondary" disabled={busy}
                    onClick={() => setOrphanReviewOpen(true)}>Review unresolved annotations</button>}
                  <button className="button secondary" disabled={busy} onClick={openHeading}>Edit heading</button>
                  {targetTable && <button className="button secondary" disabled={busy} onClick={() => setEditSource(true)}>Edit Mermaid source</button>}
                  {targetTable && componentSourceSupported && <button className="button secondary" disabled={busy}
                    onClick={() => setGuidedKind("systems")}>Insert systems diagram</button>}
                  {targetTable && componentSourceSupported && <button className="button secondary" disabled={busy}
                    onClick={() => setGuidedKind("process")}>Insert process diagram</button>}
                  {!!project.componentInstances.length && <button className="button secondary" disabled={busy} onClick={() => setDetachOpen(true)}>Detach component</button>}
                  {targetTable && flatFlowchart && (
                    <button className="button secondary" disabled={busy} onClick={() => setEditFlowchart("addNode")}>Edit flowchart</button>
                  )}
                  {removableGroup && <button className="button secondary" disabled={busy} onClick={() => setEditFlowchart("removeGroup")}>Ungroup</button>}
                  {defaultGroupDeletion && !defaultGroupDeletion.unavailable && <button className="button secondary" disabled={busy}
                    onClick={() => setEditFlowchart("removeGroupContents")}>Delete group and contents</button>}
                  {defaultMoveAvailable && <button className="button secondary" disabled={busy}
                    onClick={() => setEditFlowchart("moveToGroup")}>Move node into group</button>}
                </div>
              </section>
              <section data-v3-panel="Design" aria-label="Design tools" className="recovery-actions">
                {!!targetTable?.targets.length && <button className="button secondary" disabled={busy} onClick={openReadability}>Check readability</button>}
                {outlineAvailable && <button className="button secondary" disabled={busy} onClick={() => setComparison("design")}>Explore designs</button>}
                {outlineAvailable && <button className="button secondary" disabled={busy} onClick={() => setComparison("layout")}>Compare layouts</button>}
              </section>
              <section data-v3-panel="Story" aria-label="Story tools" className="recovery-actions">
                {outlineAvailable && <button ref={suggestScenesButton} className="button secondary" disabled={busy} onClick={() => setStoryOpen(true)}>Suggest scenes</button>}
                {outlineAvailable && <button className="button secondary" disabled={busy}
                  onClick={() => setSavedScenesOpen(project.storyboard.scenes.length ? "edit" : "create")}>
                  {project.storyboard.scenes.length ? "Edit saved scenes" : "Create overview scene"}
                </button>}
              </section>
            </div>
            <p role="status">{save?.phase === "saved" ? "Saved in this browser."
              : needsRecovery ? "Changes are only in this session."
              : "Saving changes…"}</p>
            {needsRecovery && <p role="alert">{save?.message}</p>}
            <div className="recovery-actions">
              <button className="button secondary" disabled={busy} aria-keyshortcuts="Control+K Meta+K" onClick={() => setCommandsOpen(true)}>Commands</button>
              <button className="button quiet" disabled={busy || !editor.current?.canUndo()} onClick={() => changeHistory("undo")}>Undo</button>
              <button className="button quiet" disabled={busy || !editor.current?.canRedo()} onClick={() => changeHistory("redo")}>Redo</button>
              <button className="button secondary" disabled={busy} onClick={downloadProject}>
                {needsRecovery ? "Download my changes" : "Download v3 project"}
              </button>
              <button className="button secondary" disabled={busy} onClick={() => setExportOpen(true)}>Export diagram</button>
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
      {exportOpen && project && (
        <Suspense fallback={<p role="status">Opening export…</p>}>
          <ExportDialog document={project} result={currentFrame?.rendered.result ?? null} stale={!currentFrame}
            rendering={!currentFrame && !!project.source.trim() && !renderError} renderError={renderError}
            onEditSource={showSource} onDownload={downloadProject} onClose={() => setExportOpen(false)}
            presentation={{
              sceneCount: project.storyboard.scenes.length,
              unavailable: currentFrame?.rendered.targetTable ? undefined : "A verified diagram is needed to export the presentation.",
              download: (_svg, options) => savePresentation(options),
            }} />
        </Suspense>
      )}
      {guidedKind === "systems" && project && <Suspense fallback={<p role="status">Opening systems editor…</p>}>
        <GuidedSystemsDialog session={guidedSystems} onSession={setGuidedSystems}
          onBack={() => setGuidedKind(undefined)} onClose={() => setGuidedKind(undefined)}
          target={{ title, nodes, attachment: guidedSystemsAttachment, onAttachment: setGuidedSystemsAttachment,
            prepare: reviewGuidedSystems, apply: insertGuidedDiagram, onCompleted: draftRetained => {
              setGuidedKind(undefined);
              setGuidedSystems(emptySystemsSession);
              setGuidedSystemsAttachment(emptyGuidedAttachment);
              guidedNeedsRefresh.current = false;
              if (draftRetained) setError("Systems inserted. The saved draft could not be cleared.");
            } }} />
      </Suspense>}
      {guidedKind === "process" && project && <Suspense fallback={<p role="status">Opening process editor…</p>}>
        <GuidedProcessDialog draft={guidedProcess} onDraft={setGuidedProcess} onClose={() => setGuidedKind(undefined)}
          target={{ title, nodes, attachment: guidedProcessAttachment, onAttachment: setGuidedProcessAttachment,
            prepare: reviewGuidedProcess, apply: insertGuidedDiagram, onCompleted: draftRetained => {
              setGuidedKind(undefined);
              setGuidedProcess(emptyGuidedProcess);
              setGuidedProcessAttachment(emptyGuidedAttachment);
              guidedNeedsRefresh.current = false;
              if (draftRetained) setError("Process inserted. The saved draft could not be cleared.");
            } }} />
      </Suspense>}
      {commandsOpen && <CommandPalette commands={commands} onClose={() => setCommandsOpen(false)} />}
      {outline && <V3ProjectOutline items={outline} selected={outlineSelection} restoredView={restoredOutline} onSelection={setOutlineSelection}
        canRename={!labelEditingUnavailable} onClose={() => setOutlineOpen(false)}
        onRename={renameNode} onSource={jumpToSource} onFrame={frameOutlineTargets} onBulkText={setBulkTextHidden}
        canUngroup={id => !busy && ungroupableGroups.has(id)} onUngroup={id => {
          setOutlineOpen(false);
          setEditTarget(id);
          setEditFlowchart("removeGroup");
        }}
        canReviewGroupDeletion={id => !busy && groupDeletions.has(id)} onReviewGroupDeletion={id => {
          setOutlineOpen(false);
          setEditTarget(id);
          setEditFlowchart("removeGroupContents");
        }}
        canMoveInto={id => !busy && groupMoveOptions.has(id)} onMoveInto={id => {
          setOutlineOpen(false);
          setEditTarget(id);
          setEditFlowchart("moveToGroup");
        }}
        onConnect={!editingUnavailable && selectedSource ? openConnection : undefined}
        onGroup={!busy && (!editingUnavailable || canGroupWithinParent) ? hidden => {
          setGroupMembers({ ids: [...outlineSelection], hidden });
          setEditFlowchart("addGroup");
        } : undefined}
        onDesign={componentSourceSupported ? hidden => {
          setComparisonSelection({ ids: [...outlineSelection], hidden });
          setOutlineOpen(false);
          setComparison("design");
        } : undefined} onSaveComponent={componentSourceSupported ? setComponentHidden : undefined}
        onResetDesign={canResetDesign ? hidden => setDesignReset({ selection: new Set(outlineSelection), hidden }) : undefined}
        onStory={!busy && project && project.storyboard.scenes.length < 50 ? hidden => {
          setSavedSceneScope({ ids: [...outlineSelection], hidden });
          setOutlineOpen(false);
          setSavedScenesOpen("create");
        } : undefined}
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
      {readabilityTargets && readabilityViewing && currentFrame && targetTable && editor.current && <ReadabilityDialog frame={currentFrame.geometry} targets={readabilityTargets}
        token={targetTable.baseToken} editor={editor.current} canvas={canvasProfile}
        viewing={readabilityViewing} onViewing={setReadabilityViewing}
        highlightTargets={ids => buildReadabilityHighlight(currentFrame.rendered, currentFrame.document, ids)}
        dismissed={dismissedReadability} onDismissed={setDismissedReadability}
        onCompareLayouts={() => { setReadabilityOpen(false); setComparison("layout"); }}
        onRename={!labelEditingUnavailable ? id => { setReadabilityOpen(false); renameNode(id); } : undefined}
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
        allowScopedDesign={componentSourceSupported}
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
        <SavedScenesDialog editor={editor.current} startNew={savedScenesOpen === "create"} initialScope={savedSceneScope} onClose={() => {
          setSavedScenesOpen(undefined);
          setSavedSceneScope(undefined);
          if (savedSceneScope) requestAnimationFrame(() => outlineButton.current?.focus());
          else if (!editor.current?.snapshot().storyboard.scenes.length) requestAnimationFrame(() => suggestScenesButton.current?.focus());
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
      {assistOpen && project && currentFrame && targetTable && edgeLabels && flatFlowchart && connection.current && editor.current && <Suspense>
        <AssistExchangeDialog db={connection.current} editor={editor.current} project={project} table={targetTable}
          elements={currentFrame.rendered.result.elements ?? []} edgeLabels={edgeLabels}
          onClose={() => setAssistOpen(false)} onApplied={() => {
            setAssistOpen(false);
            setProject(editor.current!.snapshot());
          }} />
      </Suspense>}
      {editSource && editor.current && <Suspense>
        <V3SourceEditor editor={editor.current} savedDraft={sourceDraft.current} onDraft={draft => { sourceDraft.current = draft; }}
          canUndo={!busy && editor.current.canUndo()} canRedo={!busy && editor.current.canRedo()}
          onHistory={direction => inFlight.current ? undefined : applyHistory(direction)}
          onClose={() => setEditSource(false)} onApply={proposal => {
            const current = editor.current!;
            const result = current.applyStructure(proposal);
            if (result.status === "applied") {
              sourceDraft.current = undefined;
              setProject(current.snapshot());
            }
            return result.status;
          }} />
      </Suspense>}
      {orphanReviewOpen && project && editor.current && <Suspense fallback={null}>
        <OrphanReviewDialog editor={editor.current} project={project} targets={targetTable ?? undefined} onClose={() => setOrphanReviewOpen(false)}
          onApply={proposal => {
            const current = editor.current!;
            const result = current.applyStructure(proposal);
            if (result.status === "applied") {
              setOrphanReviewOpen(false);
              setProject(current.snapshot());
            }
            return result.status;
          }} />
      </Suspense>}
      {editFlowchart && editor.current && (
        <V3StructureEditor onBlockedSource={openBlockedDeletionSource} editor={editor.current} nodes={nodes} edges={edges} group={structureGroup} movableNodes={movableNodes}
          canUngroup={!!structureGroup && ungroupableGroups.has(structureGroup.id)}
          flatFlowchart={flatFlowchart} canEditLabels={!labelEditingUnavailable}
          initialOperation={editFlowchart} initialTarget={editFlowchart === "moveToGroup" ? undefined : editTarget}
          deleteConnections={deleteConnections} groupMembers={groupMembers} groupRemoval={groupRemoval}
          onClose={closeStructureEditor}
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
