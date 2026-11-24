import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  Clapperboard,
  Code2,
  Copy,
  FilePlus2,
  FolderOpen,
  GalleryHorizontalEnd,
  HelpCircle,
  Home as HomeIcon,
  LoaderCircle,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Pencil,
  Play,
  Redo2,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Square,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import Brand from "./components/Brand";
import CommandPalette from "./components/CommandPalette";
import DiagramStage from "./components/DiagramStage";
import Inspector from "./components/Inspector";
import { explainMermaidSourceError, SourceDiagnosticError } from "./lib/authoring/source-diagnostics";
import { missingNodeBracket } from "./lib/authoring/source-diagnostic-repair";
import { cacheThumbnail } from "./lib/persistence/project-thumbnail";
import { buildExportFrame } from "./lib/export";
import PresenterView from "./components/PresenterView";
import SceneFilmstrip from "./components/SceneFilmstrip";
import PanelSplitter from "./components/PanelSplitter";
import Storyboard from "./components/Storyboard";
import HeadingEditor from "./components/HeadingEditor";
import { prepareHeadingProposal } from "./lib/authoring/proposals";
import { authoringCommands } from "./lib/authoring/command-catalog";
import type { WorkspaceCommand } from "./lib/authoring/command-search";
import { useDiagram } from "./hooks/useDiagram";
import { createDesign } from "./lib/design";
import { DEFAULT_SETTINGS } from "./lib/themes";
import { storyboardDuration } from "./lib/storyboard";
import type { RenderTargetTable } from "./lib/authoring/project-render";
import type { Workspace } from "./hooks/useWorkspace";
import type { StudioDocument } from "./types";
import type { DesignState, ElementStyle } from "./types/design";
import type {
  StoryboardController,
  StoryboardState,
  StoryPlaybackAction,
  StoryPlaybackState,
} from "./types/storyboard";
import type { DocumentPatch } from "./lib/workspace";
import type { Notify } from "./App";

const SavedVersions = lazy(() => import("./components/SavedVersions"));
const SourceEditor = lazy(() => import("./components/SourceEditor"));
const ExportDialog = lazy(() => import("./components/ExportDialog"));
const MemoInspector = memo(Inspector);
type WorkspaceTab = "canvas" | "source" | "style" | "story";
export interface StudioNavigation {
  notify: Notify;
  onHome: () => void;
  onProjects: () => void;
  onGuide: () => void;
  onNew: () => void;
  onImport: () => void;
  onExamples: () => void;
}
interface Props extends StudioNavigation {
  document: StudioDocument;
  workspace: Pick<Workspace, "patch" | "settings" | "undo" | "redo" | "undoLabel" | "redoLabel" | "saveState" | "autosave" | "revision" | "proposalOutcome" | "applyProposal">;
  onAuthoring?: (command: string) => void;
  extraCommands?: WorkspaceCommand[];
  native?: { original: import("./lib/authoring/mermaid-project").MermaidProjectV3; restore: (snapshot: import("./lib/authoring/mermaid-project").MermaidProjectV3) => void; editSource?: () => void; editHeading: () => void; export: () => void; tools: () => void; table?: RenderTargetTable | null; select: (key: string | null) => void; rename: (key: string) => void };
  onDownload: () => void;
}
function applyStoryAction(
  controller: StoryboardController,
  action: StoryPlaybackAction,
  value?: number,
) {
  if (action === "seek") {
    controller.pause();
    controller.seek(value ?? 0);
  } else if (action === "preview") controller.preview(value ?? 0);
  else if (action !== "stop") controller[action]();
}

function panelVisible(side: string) {
  try { return localStorage.getItem("meridian:visible:" + side) !== "false"; } catch { return true; }
}
export default function Studio(props: Props) {
  const diagram = useDiagram(props.document);
  return <StudioWorkspace {...props} diagram={diagram} />;
}

export function StudioWorkspace({
  document: doc,
  diagram, native, onAuthoring, extraCommands = [],
  workspace,
  notify,
  onHome,
  onNew,
  onExamples,
  onProjects,
  onGuide,
  onImport,
  onDownload,
}: Props & { diagram: ReturnType<typeof useDiagram> }) {
  const {
    result,
    error,
    rendering,
    stale,
    blank,
    fingerprint,
    stageDocument,
    live,
    setLive,
    renderNow,
  } = diagram;
  const stageFrame = useMemo(() => {
    if (!result) return { svg: "", width: 900, height: 700, template: null };
    let template: SVGSVGElement | null = null;
    const frame = buildExportFrame(result, stageDocument, { animated: true, includeFrame: true }, root => { template = root; });
    return { ...frame, template: template as SVGSVGElement | null };
  }, [result, stageDocument.title, stageDocument.subtitle, stageDocument.settings.theme, stageDocument.settings.font,
    stageDocument.settings.padding, stageDocument.settings.frame, stageDocument.settings.showTitle, stageDocument.settings.showBrand,
    stageDocument.settings.background, stageDocument.settings.ambient]);
  const { patch, settings, undo, redo, undoLabel, redoLabel } = workspace;
  const [tab, setTab] = useState<WorkspaceTab>("canvas");
  const [manual, setManual] = useState(false);
  const [cleanAudience, setCleanAudience] = useState(false);
  const presentationFullscreen = useRef(false);
  const [present, setPresent] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(() => panelVisible("source"));
  const [jumpLine, setJumpLine] = useState<number>();
  const [focusRequest, setFocusRequest] = useState(0);
  const [inspectorVisible, setInspectorVisible] = useState(() => panelVisible("inspector"));
  useEffect(() => {
    try { localStorage.setItem("meridian:visible:source", String(sourceVisible)); localStorage.setItem("meridian:visible:inspector", String(inspectorVisible)); } catch { /* session only */ }
  }, [sourceVisible, inspectorVisible]);
  const [inspectorMode, setInspectorMode] = useState<"design" | "story">(
    "design",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [storyPreview, setStoryPreview] = useState(false);
  const [storyPlayback, setStoryPlayback] = useState<StoryPlaybackState | null>(
    null,
  );
  const [heading, setHeading] = useState<"title" | "subtitle" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [versions, setVersions] = useState<"checkpoints" | "styles">();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [selectionRequest, setSelectionRequest] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [motionPaused, setMotionPaused] = useState(false);
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 800px)").matches,
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const storyController = useRef<StoryboardController | null>(null);
  const pendingStoryAction = useRef<{
    action: StoryPlaybackAction;
    value?: number;
  } | null>(null);
  const current = useRef({ doc, result, stale, error, storyPlayback });
  current.current = { doc, result, stale, error, storyPlayback };

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    const narrow = window.matchMedia("(max-width: 800px)");
    const resize = () => setCompact(narrow.matches);
    media.addEventListener("change", update);
    narrow.addEventListener("change", resize);
    return () => {
      media.removeEventListener("change", update);
      narrow.removeEventListener("change", resize);
    };
  }, []);
  useEffect(() => {
    if (
      selectedKey &&
      !(result?.elements || []).some((element) => element.key === selectedKey)
    )
      setSelectedKey(null);
  }, [result, selectedKey]);
  const stopStory = useCallback(() => {
    pendingStoryAction.current = null;
    storyController.current?.pause();
    setStoryPreview(false);
    setStoryPlayback(null);
  }, []);
  useEffect(stopStory, [fingerprint, stopStory]);
  const receiveStoryController = useCallback(
    (controller: StoryboardController | null) => {
      storyController.current = controller;
      if (controller && pendingStoryAction.current) {
        const pending = pendingStoryAction.current;
        pendingStoryAction.current = null;
        applyStoryAction(controller, pending.action, pending.value);
      }
    },
    [],
  );
  const playbackAction = useCallback(
    (action: StoryPlaybackAction, value?: number) => {
      if (action === "stop") {
        stopStory();
        return;
      }
      const state = current.current;
      if (
        !state.doc.storyboard?.scenes.length ||
        !state.result ||
        state.stale ||
        state.error
      )
        return;
      if (storyController.current)
        applyStoryAction(storyController.current, action, value);
      else {
        pendingStoryAction.current = { action, value };
        setStoryPreview(true);
      }
    },
    [stopStory],
  );
  const startPresentation = useCallback((manual: boolean) => {
    const state = current.current;
    if (!state.result || state.stale || state.error) {
      notify("Render a valid diagram before presenting.", "error");
      return;
    }
    setCleanAudience(false);
    setPresent(true);
    setFitRequest((value) => value + 1);
    if (state.doc.storyboard?.scenes.length) playbackAction(manual ? "preview" : "restart", 0);
  }, [playbackAction, notify]);
  const beginPresentation = useCallback(() => startPresentation(manual), [startPresentation, manual]);
  const leavePresentation = useCallback(() => {
    setPresent(false);
    if (presentationFullscreen.current && globalThis.document.fullscreenElement) void globalThis.document.exitFullscreen().catch(() => {});
    presentationFullscreen.current = false;
    stopStory();
  }, [stopStory]);
  const showCanvas = useCallback(() => setTab("canvas"), []);
  const showSource = useCallback(() => {
    setSourceVisible(true);
    setTab("source");
    setFocusRequest((value) => value + 1);
  }, []);
  const openStoryboard = useCallback(() => {
    setInspectorMode("story");
    setInspectorVisible(true);
    setTab("story");
  }, []);
  const openDesign = useCallback(() => {
    setInspectorMode("design");
    setInspectorVisible(true);
    setTab("style");
  }, []);
  const openExport = native?.export ?? (() => setExportOpen(true));
  const selectElement = useCallback(
    (key: string | null) => {
      setSelectedKey(key);
      setSelectionRevision(value => value + 1);
      native?.select(key);
      if (key) {
        setInspectorVisible(true);
        if (window.innerWidth <= 800)
          setTab(inspectorMode === "story" ? "story" : "style");
      }
    },
    [inspectorMode, native?.select],
  );
  const clearSelection = useCallback(() => setSelectedKey(null), []);
  const replay = useCallback(() => setReplayKey((value) => value + 1), []);
  const editHeading = useCallback(
    (field: "title" | "subtitle" = "title") => setHeading(field),
    [],
  );
  const editTitle = native?.editHeading ?? (() => setHeading("title"));
  const closeHeading = useCallback(() => setHeading(null), []);
  const changeSource = useCallback(
    (source: string, group?: string) => {
      if (source.length <= 100_000) patch({ source }, "Edit source", group);
      else notify("Source is limited to 100,000 characters.", "error");
    },
    [patch, notify],
  );
  const changeDesign = useCallback(
    (design: DesignState) => {
      const previous = current.current.doc.design;
      const changed = [
        ...new Set([
          ...Object.keys(previous.elements),
          ...Object.keys(design.elements),
        ]),
      ].filter((key) => previous.elements[key] !== design.elements[key]);
      let group: string | undefined;
      if (changed.length === 1) {
        const key = changed[0],
          before = previous.elements[key] || {},
          after = design.elements[key] || {};
        const properties = [
          ...new Set([...Object.keys(before), ...Object.keys(after)]),
        ]
          .filter(
            (property) =>
              before[property as keyof ElementStyle] !==
              after[property as keyof ElementStyle],
          )
          .sort();
        group = `design:${key}:${properties.join(",")}`;
      }
      patch({ design }, "Style an element", group);
    },
    [patch],
  );
  const changeDocument = useCallback(
    (value: DocumentPatch) => patch(value, "Apply design"),
    [patch],
  );
  const changeStoryboard = useCallback(
    (storyboard: StoryboardState) => {
      const previous =
        current.current.doc.storyboard?.scenes
          .map((scene) => scene.id)
          .join("|") ?? "";
      const next = storyboard.scenes.map((scene) => scene.id).join("|");
      patch(
        { storyboard },
        "Edit storyboard",
        previous === next ? "storyboard" : undefined,
      );
    },
    [patch],
  );
  const elementIndex = useMemo(
    () =>
      new Map(
        (result?.elements || []).map((element) => [element.key, element]),
      ),
    [result],
  );
  const nodeIndex = useMemo(
    () => new Map((result?.nodes || []).map((node) => [node.key, node])),
    [result],
  );
  const selectedElement = selectedKey
    ? (elementIndex.get(selectedKey) ?? null)
    : null;
  const selectedNode =
    selectedElement?.kind === "node"
      ? (nodeIndex.get(selectedElement.key) ?? nodeIndex.get(selectedElement.sourceId) ?? null)
      : null;
  const changeAccent = useCallback(
    (color: string | null) => {
      if (!selectedNode) return;
      const nodeAccents = { ...current.current.doc.nodeAccents };
      if (color) nodeAccents[selectedNode.key] = color;
      else delete nodeAccents[selectedNode.key];
      patch({ nodeAccents }, "Change node accent");
    },
    [selectedNode, patch],
  );
  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(doc.source);
      notify("Mermaid source copied.");
    } catch {
      notify(
        "Clipboard access is unavailable. Select the source to copy it, or export Mermaid.",
        "error",
      );
    }
  };
  const resetStyle = () => {
    patch(
      {
        settings: { ...DEFAULT_SETTINGS },
        nodeAccents: {},
        design: createDesign(),
      },
      "Reset styling",
    );
    notify("Style reset. Use Undo to restore your previous appearance.");
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (globalThis.document.querySelector("dialog[open]")) return;
      const target = event.target instanceof Element ? event.target : null;
      const editing = !!target?.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === "k" && !event.altKey && !event.shiftKey) {
        if (!present && !exportOpen && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          setCommandsOpen(true);
        }
        return;
      }
      if (command && key === "s") {
        event.preventDefault();
        onDownload();
        return;
      }
      if (command && event.key === "Enter") {
        event.preventDefault();
        renderNow();
        return;
      }
      if (command && !editing && (key === "z" || key === "y")) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === "Escape") {
        if (present) leavePresentation();
        else if (storyPreview) stopStory();
        else clearSelection();
        return;
      }
      if (editing || command || event.altKey) return;
      if (present && key === "h") { event.preventDefault(); setCleanAudience(value => !value); }
      if (key === "f") {
        event.preventDefault();
        setFitRequest((value) => value + 1);
      }
      if (key === "p") {
        event.preventDefault();
        if (present) leavePresentation();
        else beginPresentation();
      }
      if (present && current.current.doc.storyboard?.scenes.length) {
        if (event.code === "Space" && !target?.closest("button")) {
          event.preventDefault();
          playbackAction(
            current.current.storyPlayback?.playing ? "pause" : "play",
          );
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          playbackAction("next");
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          playbackAction("previous");
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    present,
    exportOpen,
    storyPreview,
    onDownload,
    renderNow,
    undo,
    redo,
    leavePresentation,
    stopStory,
    clearSelection,
    beginPresentation,
    playbackAction,
  ]);

  const diagnosis = useMemo(() => error ? explainMermaidSourceError(new Error(error), doc.source) : undefined, [error, doc.source]);
  const repair = useMemo(() => diagnosis instanceof SourceDiagnosticError ? missingNodeBracket(doc.source, diagnosis) : undefined, [diagnosis, doc.source]);
  useEffect(() => {
    if (!result || stale || rendering || error) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void cacheThumbnail((native ? "mermaid/" : "") + doc.id, doc.updatedAt, result.svg, controller.signal).catch(() => {});
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [result, stale, rendering, error, doc.id, doc.updatedAt, !!native]);
  const sourceLines = useMemo(
    () => doc.source.split("\n").length,
    [doc.source],
  );
  const disabledReason = blank
    ? "Add a diagram before previewing scenes."
    : error
      ? "Correct the source to preview scenes."
      : stale
        ? "Render the current diagram to preview scenes."
        : undefined;
  const commands: WorkspaceCommand[] = [
    { id: "source-workspace", title: "Source-focused workspace", category: "Workspace", run: () => { setInspectorVisible(false); showSource(); } },
    { id: "canvas-workspace", title: "Canvas-focused workspace", category: "Workspace", run: () => { setSourceVisible(false); setInspectorVisible(false); showCanvas(); } },
    { id: "editing-workspace", title: "Show both editing panels", category: "Workspace", run: () => { setSourceVisible(true); openDesign(); } },
    { id: "checkpoints", title: "Named checkpoints", category: "History", synonyms: ["save version", "restore", "alternatives"], run: () => setVersions("checkpoints") },
    { id: "style-profiles", title: "Style profiles", category: "Design", synonyms: ["reusable styles", "save style"], run: () => setVersions("styles") },
    { id: "edit-heading", title: "Edit heading", category: "Project", synonyms: ["title", "rename project"], run: editTitle },
    { id: "show-source", title: "Show Mermaid source", category: "Diagram", synonyms: ["open source", "code"], run: showSource },
    { id: "render-now", title: "Render diagram", category: "Diagram", synonyms: ["refresh"], shortcut: "Ctrl/⌘ Enter",
      unavailable: blank ? "Enter Mermaid source to render a diagram." : undefined, run: renderNow },
    { id: "copy-source", title: "Copy Mermaid source", category: "Diagram", unavailable: blank ? "There is no source to copy." : undefined, run: () => { void copySource(); } },
    { id: "open-design", title: "Open design options", category: "Diagram", synonyms: ["style", "theme"], run: openDesign },
    { id: "open-story", title: "Open storyboard", category: "Diagram", synonyms: ["scenes", "timeline"], run: openStoryboard },
    { id: "present-manually", title: "Present with manual advance", category: "Story", synonyms: ["hold slide", "presenter"], unavailable: !doc.storyboard?.scenes.length ? "Create a scene first." : undefined, run: () => startPresentation(true) },
    { id: "present", title: "Present diagram", category: "Diagram", shortcut: "P",
      unavailable: !result || stale || error ? "Render a valid diagram before presenting." : undefined, run: beginPresentation },
    { id: "undo", title: "Undo", category: "History", shortcut: "Ctrl/⌘ Z", unavailable: undoLabel ? undefined : "There are no changes to undo.", run: undo },
    { id: "redo", title: "Redo", category: "History", shortcut: "Ctrl/⌘ Shift Z", unavailable: redoLabel ? undefined : "There are no changes to redo.", run: redo },
    { id: "export", title: "Export diagram", category: "Export", synonyms: ["download", "presentation", "png", "svg"], run: openExport },
    { id: "download-project", title: "Download project", category: "Export", synonyms: ["backup", "save project"], shortcut: "Ctrl/⌘ S", run: onDownload },
  ];
  const commandMap = new Map(commands.map(command => [command.id, command]));
  if (onAuthoring) for (const command of Object.values(authoringCommands)) {
    if (!commandMap.has(command.id) && !["download-project", "export-diagram", "download-presentation"].includes(command.id)) {
      commandMap.set(command.id, { ...command, unavailable: !result?.diagramType.startsWith("flowchart") || stale || error
        ? "Render a current flowchart to use this authoring command." : undefined, run: () => onAuthoring(command.id) });
    }
  }
  for (const command of extraCommands) {
    if (!commandMap.has(command.id)) commandMap.set(command.id, command);
  }
  return (
    <div
      className={`studio ${present ? "is-presenting" : ""} ${sourceVisible ? "" : "source-hidden"} ${inspectorVisible ? "" : "inspector-hidden"}`}
    >
      {!present && (
        <>
          <header className="app-bar">
            <Brand />
            <span className="bar-divider" />
            <nav
              className="workspace-navigation"
              aria-label="Project navigation"
            >
              <button
                className="button quiet"
                onClick={onHome}
                aria-label="Home"
              >
                <HomeIcon size={16} />
                <span>Home</span>
              </button>
              <button
                className="button quiet"
                onClick={onProjects}
                aria-label="Open projects"
              >
                <FolderOpen size={16} />
                <span>Projects</span>
                <ChevronDown size={12} />
              </button>
            </nav>
            <div
              className="saved-state"
              title="Saved in this browser. Download a project for a portable backup."
              aria-live="polite"
            >
              {workspace.saveState === "saving" ? (
                <LoaderCircle className="spin" size={12} />
              ) : workspace.saveState === "error" || !workspace.autosave ? (
                <CircleAlert size={13} />
              ) : (
                <Check size={13} />
              )}
              <span>
                {!workspace.autosave
                  ? "Autosave paused"
                  : workspace.saveState === "saving"
                    ? "Saving"
                    : workspace.saveState === "error"
                      ? "Save unavailable"
                      : "Saved locally"}
              </span>
            </div>
            <div className="app-actions">
              <button className="button quiet commands-top" aria-label="Commands" aria-keyshortcuts="Control+K Meta+K"
                title="Commands (Ctrl/⌘ K)" onClick={() => setCommandsOpen(true)}>
                <Search size={16} /><span>Commands</span>
              </button>
              <button
                className="button quiet new-top"
                onClick={onNew}
                aria-label="New diagram"
              >
                <FilePlus2 size={16} />
                <span>New</span>
              </button>
              <button
                className="button quiet examples-top"
                onClick={onExamples}
                aria-label="Examples"
              >
                <GalleryHorizontalEnd size={16} />
                <span>Examples</span>
              </button>
              {!!doc.storyboard?.scenes.length && <select className="delivery-mode" aria-label="Presentation advance" value={manual ? "manual" : "auto"}
                onChange={event => setManual(event.target.value === "manual")}><option value="auto">Timed</option><option value="manual">Manual</option></select>}
              <button
                className="button quiet present-top"
                onClick={beginPresentation}
                disabled={!result || stale || !!error}
                aria-label="Present"
                title={
                  !result || stale || error
                    ? "Render your diagram before presenting"
                    : "Present (P)"
                }
              >
                <Play size={15} />
                <span>Present</span>
              </button>
              <button
                className="button primary export-top"
                onClick={openExport}
              >
                <ArrowDownToLine size={16} />
                <span>Export</span>
              </button>
            </div>
          </header>
          <div className="workspace-toolbar">
            <div className="workspace-path">
              <button
                className="icon-button desktop-only"
                aria-label={
                  sourceVisible ? "Hide source panel" : "Show source panel"
                }
                title={sourceVisible ? "Hide source" : "Show source"}
                onClick={() => setSourceVisible((value) => !value)}
              >
                {sourceVisible ? (
                  <PanelLeftClose size={16} />
                ) : (
                  <PanelLeftOpen size={16} />
                )}
              </button>
              <button
                className="heading-button"
                onClick={editTitle}
                aria-label="Edit heading"
                title="Edit title and subtitle"
              >
                <strong>{doc.title || "Untitled diagram"}</strong>
                <Pencil size={13} />
              </button>
            </div>
            <div className="workspace-tools">
              {native && <button className="button quiet" onClick={native.tools}>Authoring tools</button>}
              <div
                className="history-controls"
                role="group"
                aria-label="Project history"
              >
                <button
                  className="icon-button"
                  aria-label="Undo"
                  title={
                    undoLabel
                      ? `Undo: ${undoLabel} (Ctrl/⌘ Z)`
                      : "Nothing to undo"
                  }
                  disabled={!undoLabel}
                  onClick={undo}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Redo"
                  title={
                    redoLabel
                      ? `Redo: ${redoLabel} (Ctrl/⌘ Shift Z)`
                      : "Nothing to redo"
                  }
                  disabled={!redoLabel}
                  onClick={redo}
                >
                  <Redo2 size={16} />
                </button>
              </div>
              <button
                className="icon-button"
                onClick={onGuide}
                aria-label="Open guide"
                title="Guide & shortcuts"
              >
                <HelpCircle size={17} />
              </button>
              <button
                className={`icon-button desktop-only ${inspectorVisible ? "active" : ""}`}
                onClick={() => setInspectorVisible((value) => !value)}
                aria-label={
                  inspectorVisible ? "Hide style panel" : "Show style panel"
                }
                title="Design & storyboard panel"
              >
                <Settings2 size={17} />
              </button>
            </div>
          </div>
        </>
      )}
      <main className={`workspace mobile-${tab}`}>
        {!present && (
          <aside
            className="source-panel"
            aria-label="Source editor"
            inert={compact ? tab !== "source" : !sourceVisible}
          >
            <PanelSplitter side="source" />
            <div className="panel-heading">
              <div>
                <Code2 size={16} />
                <strong>Source</strong>
                <span className="language-badge">.mmd</span>
              </div>
              <button
                hidden={!!native}
                className={`live-button ${live ? "on" : ""}`}
                onClick={() => setLive((value) => !value)}
                aria-pressed={live}
                title="Toggle live rendering"
              >
                <span />
                {live ? "Live" : "Paused"}
              </button>
            </div>
            <div className="source-intro">
              <p>
                {blank
                  ? "Paste Mermaid here to begin."
                  : "Mermaid source"}
              </p>
              <button onClick={onGuide}>
                Syntax guide
                <BookOpen size={12} />
              </button>
            </div>
            <div className="editor-wrap">
              <Suspense
                fallback={
                  <p className="editor-loading" role="status">
                    Loading source editor…
                  </p>
                }
              >
                {native ? <div className="accepted-source">
                  <button className="button primary" disabled={!native.editSource} onClick={native.editSource}>Edit Mermaid source</button>
                  <pre>{doc.source}</pre>
                </div> : <SourceEditor
                  source={doc.source}
                  onChange={changeSource}
                  onUndo={undo}
                  onRedo={redo}
                  jumpLine={jumpLine}
                  focusRequest={focusRequest}
                />}
              </Suspense>
            </div>
            {error && (
              <section className="source-error" role="alert">
                <div>
                  <CircleAlert size={16} />
                  <strong>Check your syntax</strong>
                </div>
                {diagnosis instanceof SourceDiagnosticError && <p>{diagnosis.message}</p>}
                {diagnosis instanceof SourceDiagnosticError && diagnosis.line && <button onClick={() => {
                  setJumpLine(diagnosis.line); showSource();
                }}>Go to line {diagnosis.line}</button>}
                {repair && <div><p>Proposed line {repair.line}</p><code>{repair.after}</code>
                  <button onClick={() => changeSource(doc.source.slice(0,repair.insertAt) + "]" + doc.source.slice(repair.insertAt))}>Apply bracket fix</button></div>}
                <details><summary>Renderer details</summary><pre>{error}</pre></details>
                <p>
                  {result
                    ? "Your last valid diagram stays on the canvas."
                    : "Your source is safe. Fix the error to render it."}
                </p>
              </section>
            )}
            <div className="source-actions">
              <button
                className="button quiet"
                onClick={copySource}
                disabled={blank}
                title="Copy Mermaid source"
              >
                <Copy size={14} />
                <span>Copy</span>
              </button>
              <button
                className="button quiet"
                onClick={onImport}
                title="Import Mermaid or a saved project"
              >
                <Upload size={14} />
                <span>Import</span>
              </button>
              <button
                className="icon-button"
                aria-label="Render now"
                title="Render now (Ctrl/⌘ Enter)"
                disabled={blank}
                onClick={renderNow}
              >
                <RefreshCw size={14} className={rendering ? "spin" : ""} />
              </button>
            </div>
            <div className="source-footer">
              <span>{sourceLines} lines</span>
              <span>
                <kbd>⌘ / Ctrl</kbd> <kbd>↵</kbd> render
              </span>
            </div>
          </aside>
        )}
        <section
          className="canvas-panel"
          aria-label="Diagram canvas"
          inert={compact && !present && tab !== "canvas"}
        >
          {blank ? (
            <div className="empty-canvas">
              <span className="empty-canvas-icon">
                <FilePlus2 size={28} />
              </span>
              <span className="eyebrow">A FRESH START</span>
              <h1>Your canvas is ready.</h1>
              <p>
                Write or paste Mermaid in the source editor.
                <br />
                Your diagram will appear here as you work.
              </p>
              <div>
                <button className="button primary" onClick={showSource}>
                  <Code2 size={16} />
                  Write Mermaid
                </button>
                <button className="button secondary" onClick={onExamples}>
                  Browse examples
                </button>
              </div>
              <button className="empty-guide" onClick={onGuide}>
                New to Mermaid? Open the quick guide
                <BookOpen size={14} />
              </button>
            </div>
          ) : (
            <>
              {storyPreview && !present && (
                <button className="story-preview-banner" onClick={stopStory}>
                  <Square size={12} />
                  <span>End scene preview</span>
                </button>
              )}
              <DiagramStage
                frame={stageFrame}
                result={result}
                document={stageDocument}
                selectedKey={selectedKey}
                onSelect={selectElement}
                replayKey={replayKey}
                present={present}
                motionPaused={(!storyPreview && motionPaused) || reducedMotion}
                selectionRequest={selectionRequest}
                fitRequest={fitRequest}
                storyPreview={storyPreview}
                reducedMotion={reducedMotion}
                onStoryController={receiveStoryController}
                onStoryPlayback={setStoryPlayback}
                onEditHeading={native?.editHeading ?? editHeading}
                onRename={native?.rename}
                targetTable={native?.table}
                loading={rendering}
                error={error}
              />
              {(error || stale || rendering) && (
                <div
                  className={`render-status ${error && !rendering ? "error" : ""}`}
                  role="status"
                >
                  {rendering ? (
                    <>
                      <LoaderCircle size={14} className="spin" />
                      Rendering diagram
                    </>
                  ) : error ? (
                    <>
                      <CircleAlert size={14} />
                      {result
                        ? "Showing last valid diagram"
                        : "Source needs a correction"}
                      <button onClick={showSource}>Open source</button>
                    </>
                  ) : (
                    <>
                      <Pause size={14} />
                      Canvas paused
                      <button onClick={renderNow}>Render now</button>
                    </>
                  )}
                </div>
              )}
              {result?.warnings.length ? (
                <details className="render-notes">
                  <summary>
                    <CircleAlert size={13} />
                    {result.warnings.length} rendering{" "}
                    {result.warnings.length === 1 ? "note" : "notes"}
                  </summary>
                  <ul>
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </section>
        {!present && (
          <aside
            className="inspector-panel"
            aria-label={
              inspectorMode === "story"
                ? "Presentation planning"
                : "Diagram styling"
            }
            inert={
              compact ? tab !== "style" && tab !== "story" : !inspectorVisible
            }
          >
            <PanelSplitter side="inspector" />
            <div
              className="inspector-mode"
              role="group"
              aria-label="Inspector mode"
            >
              <button
                className={inspectorMode === "design" ? "active" : ""}
                aria-pressed={inspectorMode === "design"}
                onClick={openDesign}
              >
                <Settings2 size={15} />
                Design
              </button>
              <button
                className={inspectorMode === "story" ? "active" : ""}
                aria-pressed={inspectorMode === "story"}
                onClick={openStoryboard}
                aria-label="Storyboard"
              >
                <Clapperboard size={15} />
                Storyboard<span>{doc.storyboard?.scenes.length || 0}</span>
              </button>
            </div>
            {inspectorMode === "story" ? (
              <Storyboard
                key={doc.id}
                storyboard={doc.storyboard}
                elements={result?.elements || EMPTY_ELEMENTS}
                selectedKey={selectedKey}
                selectedSceneId={selectedSceneId}
                onSelectScene={setSelectedSceneId}
                onChange={changeStoryboard}
                playback={storyPlayback}
                onPlayback={playbackAction}
                disabledReason={disabledReason}
                onShowCanvas={showCanvas}
              />
            ) : (
              <>
                <div className="panel-heading">
                  <div>
                    <Settings2 size={16} />
                    <strong>Make it yours</strong>
                  </div>
                  <button
                    className="icon-button"
                    onClick={resetStyle}
                    title="Reset all styling (can be undone)"
                    aria-label="Reset all styling"
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
                <MemoInspector
                  document={doc}
                  result={result}
                  onSettings={settings}
                  onDocument={changeDocument}
                  onDesign={changeDesign}
                  selectionRevision={selectionRevision}
                  selectedElement={selectedElement}
                  selectedNode={selectedNode}
                  onSelectElement={key => { selectElement(key); if (key) setSelectionRequest(count => count + 1); }}
                  onAccent={changeAccent}
                  onClearSelection={clearSelection}
                  onReplay={replay}
                  reducedMotion={reducedMotion}
                  onEditHeading={editTitle}
                />
              </>
            )}
          </aside>
        )}
      </main>
      {!present && inspectorMode === "story" && inspectorVisible && stageFrame.template && !!doc.storyboard?.scenes.length &&
        <SceneFilmstrip doc={doc} template={stageFrame.template} selected={selectedSceneId} targets={native?.table}
          onSelect={(scene,index) => { setSelectedSceneId(scene.id); playbackAction("preview",index); }}
          onReorder={scenes => changeStoryboard({ ...doc.storyboard!, scenes })} />}
      {!present && (
        <>
          <footer className="status-bar">
            <span>
              <ShieldCheck size={13} />
              Local workspace
              <span className="status-sub">
                {" "}
                Download a project for a portable backup.
              </span>
            </span>
            <div>
              {result && (
                <>
                  <span>{result.diagramType.replace(/[-_]/g, " ")}</span>
                  {result.nodes.length > 0 && (
                    <span>{result.nodes.length} nodes</span>
                  )}
                  {result.edgeCount > 0 && (
                    <span>{result.edgeCount} connections</span>
                  )}
                </>
              )}
              <button onClick={onGuide}>
                Guide & shortcuts
                <BookOpen size={12} />
              </button>
            </div>
          </footer>
          <nav className="mobile-nav" aria-label="Workspace panels">
            {(
              [
                ["canvas", Scan, "Canvas"],
                ["source", Code2, "Source"],
                ["style", Settings2, "Style"],
                ["story", Clapperboard, "Story"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => {
                  setTab(id);
                  if (id === "story") setInspectorMode("story");
                  else if (id === "style") setInspectorMode("design");
                }}
                aria-current={tab === id ? "page" : undefined}
              >
                <Icon size={19} />
                {label}
              </button>
            ))}
          </nav>
        </>
      )}
      {present && (
        <div
          hidden={cleanAudience}
          className={`presentation-controls ${doc.storyboard?.scenes.length ? "has-storyboard" : ""}`}
        >
          <span className="presentation-label">
            Meridian{" "}
            <span>
              {storyPlayback && doc.storyboard
                ? doc.storyboard.scenes[storyPlayback.sceneIndex]?.title
                : "Presentation"}
            </span>
          </span>
          {doc.storyboard?.scenes.length ? (
            <>
              <button
                onClick={() => playbackAction("previous")}
                disabled={(storyPlayback?.sceneIndex ?? 0) <= 0}
                aria-label="Previous presentation scene"
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={() =>
                  playbackAction(storyPlayback?.playing ? "pause" : "play")
                }
                aria-label={
                  storyPlayback?.playing
                    ? "Pause presentation"
                    : "Play presentation"
                }
              >
                {storyPlayback?.playing ? (
                  <Pause size={17} />
                ) : (
                  <Play size={17} />
                )}
                <span>{storyPlayback?.playing ? "Pause" : "Play"}</span>
              </button>
              <button
                onClick={() => playbackAction("next")}
                disabled={
                  (storyPlayback?.sceneIndex ?? 0) >=
                  doc.storyboard.scenes.length - 1
                }
                aria-label="Next presentation scene"
              >
                <SkipForward size={16} />
              </button>
              <button
                onClick={() => playbackAction("restart")}
                aria-label="Restart presentation"
              >
                <RotateCcw size={16} />
              </button>
              <input
                type="range"
                className="presentation-playhead"
                aria-label="Presentation timeline"
                min="0"
                max={storyboardDuration(doc.storyboard) || 1}
                step="0.05"
                value={storyPlayback?.time || 0}
                onChange={(event) =>
                  playbackAction("seek", Number(event.target.value))
                }
              />
            </>
          ) : (
            <>
              <button
                onClick={() => setMotionPaused((value) => !value)}
                aria-pressed={motionPaused}
                title={motionPaused ? "Resume animation" : "Pause animation"}
              >
                {motionPaused ? <Play size={17} /> : <Pause size={17} />}
                <span>{motionPaused ? "Play" : "Pause"}</span>
              </button>
              <button onClick={replay}>
                <RotateCcw size={16} />
                <span>Replay</span>
              </button>
            </>
          )}
          <button onClick={() => setFitRequest((value) => value + 1)}>
            <Maximize2 size={16} />
            <span>Fit</span>
          </button>
          {!!doc.storyboard?.scenes.length && <PresenterView scenes={doc.storyboard.scenes} index={storyPlayback?.sceneIndex ?? 0}
            previous={() => playbackAction("previous")} next={() => playbackAction("next")}/>}
          <button onClick={() => setCleanAudience(true)} title="Hide controls. Press H to restore them.">Audience view</button>
          {globalThis.document.fullscreenEnabled && <button onClick={() => {
            const page = globalThis.document;
            void (page.fullscreenElement ? page.exitFullscreen() : page.documentElement.requestFullscreen().then(() => { presentationFullscreen.current = true; }))
              .catch(() => notify("Fullscreen is unavailable in this window.", "error"));
          }}>Fullscreen</button>}
          <span className="control-separator" />
          <button onClick={leavePresentation}>
            <X size={17} />
            <span>
              Exit <kbd>Esc</kbd>
            </span>
          </button>
        </div>
      )}
      {present && cleanAudience && <button className="restore-controls" onClick={() => setCleanAudience(false)}>Show controls (H)</button>}
      {versions && <Suspense><SavedVersions mode={versions} project={native?.original ?? doc} onStyle={settings => changeDocument({ settings })}
        onRestore={snapshot => {
          if (snapshot.schema === "meridian/v3") native?.restore(snapshot);
          else {
            const { title, subtitle, source, settings, design, nodeAccents, storyboard } = snapshot;
            patch({ title, subtitle, source, settings, design, nodeAccents, storyboard }, "Restore checkpoint");
          }
        }} onClose={() => setVersions(undefined)} /></Suspense>}
      {commandsOpen && <CommandPalette commands={[...commandMap.values()]} onClose={() => setCommandsOpen(false)} />}
      {heading && (
        <HeadingEditor
          document={doc}
          field={heading}
          revision={workspace.revision}
          outcome={workspace.proposalOutcome}
          prepare={prepareHeadingProposal}
          onApply={workspace.applyProposal}
          onClose={closeHeading}
        />
      )}
      {exportOpen && (
        <Suspense
          fallback={
            <div className="dialog-loading" role="status">
              Opening export…
            </div>
          }
        >
          <ExportDialog
            document={doc}
            result={result}
            stale={stale}
            rendering={rendering}
            renderError={error}
            onRender={renderNow}
            onEditSource={showSource}
            onDownload={onDownload}
            presentation={{
              sceneCount: doc.storyboard?.scenes.length ?? 0,
              download: async svg => (await import("./lib/export")).exportPresentation(svg, doc),
            }}
            notify={notify}
            onClose={() => setExportOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

const EMPTY_ELEMENTS: NonNullable<import("./types").RenderResult["elements"]> =
  [];
