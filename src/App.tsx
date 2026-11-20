import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import Home, { StartChoices } from "./components/Home";
import Modal from "./components/Modal";
import WorkspaceBoundary from "./components/WorkspaceBoundary";
import { NoticeContext, NoticeMessage, type Notice } from "./components/Notice";
import { useWorkspace } from "./hooks/useWorkspace";
import {
  createDocument,
  downloadText,
  LEGACY_STORAGE_KEY,
  normalizeSource,
  parseProject,
  safeFilename,
  STORAGE_KEY,
} from "./lib/storage";
import type { DiagramTemplate, StudioDocument } from "./types";

const Studio = lazy(() => import("./Studio"));
const ExampleGallery = lazy(() => import("./components/ExampleGallery"));
const ProjectManager = lazy(() => import("./components/ProjectManager"));
const Guide = lazy(() => import("./components/Guide"));
type Dialog = "new" | "examples" | "projects" | "guide" | "recovery" | null;
export type Notify = (
  message: string,
  tone?: "success" | "error",
  action?: { label: string; run: () => void },
) => void;

export default function App() {
  const workspace = useWorkspace();
  const [screen, setScreen] = useState<"home" | "studio">("home");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [openModals, setOpenModals] = useState(0);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const registerModal = useCallback(() => {
    setOpenModals((count) => count + 1);
    return () => setOpenModals((count) => Math.max(0, count - 1));
  }, []);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const notify = useCallback<Notify>(
    (message, tone = "success", action) => setNotice({ message, tone, action }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(
      () => setNotice(null),
      notice.action ? 12_000 : notice.tone === "error" ? 8_000 : 4_800,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  const open = useCallback((id: string) => {
    workspaceRef.current.open(id);
    setScreen("studio");
    setDialog(null);
  }, []);
  const goHome = useCallback(() => {
    workspaceRef.current.flush();
    setScreen("home");
    setDialog(null);
  }, []);
  const showExamples = useCallback(() => setDialog("examples"), []);
  const showProjects = useCallback(() => setDialog("projects"), []);
  const showNew = useCallback(() => setDialog("new"), []);
  const showGuide = useCallback(() => setDialog("guide"), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const importClick = useCallback(() => fileInput.current?.click(), []);

  const addProject = useCallback(
    (project: StudioDocument) => {
      if (workspaceRef.current.documents.length >= 50) {
        notify(
          "Your workspace holds 50 projects. Download and remove an older one to make room.",
          "error",
        );
        return false;
      }
      workspaceRef.current.add(project);
      setScreen("studio");
      setDialog(null);
      return true;
    },
    [notify],
  );
  const createProject = useCallback(
    (template?: DiagramTemplate) => {
      const project = createDocument(template);
      if (addProject(project) && template)
        notify(`Opened ${project.title} as a new project.`);
    },
    [addProject, notify],
  );
  const blankProject = useCallback(() => createProject(), [createProject]);

  const downloadProject = useCallback(() => {
    const project = workspaceRef.current.document;
    if (!project) return;
    downloadText(
      JSON.stringify(project, null, 2),
      `${safeFilename(project.title)}.meridian.json`,
    );
    notify("Project downloaded with source, styling, and presentation scenes.");
  }, [notify]);
  const duplicate = useCallback(() => {
    const project = workspaceRef.current.document;
    if (!project) return;
    if (
      addProject({
        ...project,
        id: createDocument().id,
        title: `${project.title.slice(0, 110) || "Untitled diagram"} copy`,
        updatedAt: new Date().toISOString(),
      })
    )
      notify("Created and opened a separate copy.");
  }, [addProject, notify]);
  const remove = useCallback(
    (id: string) => {
      const current = workspaceRef.current;
      const project = current.documents.find((value) => value.id === id);
      if (!project) return;
      current.remove(id);
      if (id === current.activeId) setScreen("home");
      notify(`Removed ${project.title || "Untitled diagram"}.`, "success", {
        label: "Undo",
        run: () => {
          if (workspaceRef.current.documents.length >= 50) {
            notify(
              "Remove another project before restoring this one.",
              "error",
            );
            return;
          }
          workspaceRef.current.restore(project);
          setScreen("studio");
          setDialog(null);
          setNotice(null);
        },
      });
    },
    [notify],
  );

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      if (file.size > 2_000_000)
        throw new Error("Choose a project or Mermaid file smaller than 2 MB.");
      const text = await file.text();
      let project: StudioDocument;
      if (file.name.toLowerCase().endsWith(".json"))
        project = parseProject(text);
      else {
        const source = normalizeSource(text);
        if (source.length > 100_000)
          throw new Error("Mermaid source is limited to 100,000 characters.");
        project = {
          ...createDocument(),
          source,
          title:
            file.name.replace(/\.(mmd|mermaid|md|txt)$/i, "").slice(0, 120) ||
            "Imported diagram",
        };
      }
      if (
        addProject({
          ...project,
          id: createDocument().id,
          updatedAt: new Date().toISOString(),
        })
      )
        notify(`Imported ${project.title || "Untitled diagram"}.`);
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "The file could not be imported.",
        "error",
      );
    } finally {
      setImporting(false);
    }
  };

  const backupWorkspace = () => {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw === null) {
        notify("There is no saved browser workspace to download.", "error");
        return;
      }
      downloadText(raw, "meridian-workspace-recovery.json");
      notify("Original browser data downloaded without changing it.");
    } catch {
      notify(
        "Browser storage cannot be read. Download any open project to keep your current work.",
        "error",
      );
    }
  };

  const actions = {
    onBlank: blankProject,
    onExamples: showExamples,
    onImport: importClick,
  };
  return (
    <NoticeContext.Provider
      value={{ notice, dismiss: dismissNotice, registerModal }}
    >
      <WorkspaceBoundary
        resetKey={`${screen}:${dialog}`}
        onHome={goHome}
        onDownload={downloadProject}
        hasProject={!!workspace.document}
      >
        <div className="application">
          <input
            ref={fileInput}
            type="file"
            accept=".json,.mmd,.mermaid,.md,.txt"
            onChange={importFile}
            aria-label="Import project file"
            hidden
          />
          {workspace.warning && (
            <div className="storage-banner" role="alert">
              <CircleAlert size={17} />
              <span>{workspace.warning}</span>
              {workspace.document && (
                <button onClick={downloadProject}>
                  Download current project
                </button>
              )}
              {!workspace.autosave && (
                <button
                  onClick={
                    workspace.externalChange
                      ? () => {
                          if (workspace.reload()) {
                            setScreen("home");
                            setDialog(null);
                          }
                        }
                      : () => setDialog("recovery")
                  }
                >
                  {workspace.externalChange
                    ? "Reload workspace"
                    : "Recovery options"}
                </button>
              )}
            </div>
          )}
          {screen === "studio" && workspace.document ? (
            <Suspense
              fallback={
                <div className="app-loading" role="status">
                  <LoaderCircle size={24} className="spin" />
                  <h1>Opening your studio…</h1>
                  <p>Your project is ready. Loading the editing tools.</p>
                  <button className="button quiet" onClick={goHome}>
                    Back to home
                  </button>
                </div>
              }
            >
              <Studio
                key={workspace.document.id}
                document={workspace.document}
                workspace={workspace}
                notify={notify}
                onHome={goHome}
                onNew={showNew}
                onExamples={showExamples}
                onProjects={showProjects}
                onGuide={showGuide}
                onImport={importClick}
                onDownload={downloadProject}
              />
            </Suspense>
          ) : (
            <Home
              documents={workspace.documents}
              activeId={workspace.activeId}
              onOpen={open}
              onManage={showProjects}
              onGuide={showGuide}
              {...actions}
            />
          )}
          <Suspense
            fallback={
              <div className="dialog-loading" role="status">
                <LoaderCircle className="spin" size={18} />
                Opening…
              </div>
            }
          >
            {dialog === "examples" && (
              <ExampleGallery onChoose={createProject} onClose={closeDialog} />
            )}
            {dialog === "projects" && (
              <ProjectManager
                documents={workspace.documents}
                activeId={workspace.activeId}
                onOpen={open}
                onNew={showNew}
                onImport={importClick}
                onDuplicate={duplicate}
                onDownload={downloadProject}
                onRemove={remove}
                onClose={closeDialog}
              />
            )}
            {dialog === "guide" && <Guide onClose={closeDialog} />}
          </Suspense>
          {dialog === "new" && (
            <Modal
              title="How would you like to start?"
              eyebrow="NEW PROJECT"
              wide
              onClose={closeDialog}
            >
              <p className="modal-intro">
                Create a separate project. Your current work stays saved.
              </p>
              <StartChoices {...actions} />
            </Modal>
          )}
          {dialog === "recovery" && (
            <Modal
              title="Protect your saved work."
              eyebrow="WORKSPACE RECOVERY"
              onClose={closeDialog}
            >
              <p className="modal-intro">
                The original data in this browser has been left untouched. You
                can download it for recovery, or import a previously saved
                Meridian project.
              </p>
              <div className="recovery-actions">
                <button className="button secondary" onClick={backupWorkspace}>
                  Download original browser data
                </button>
                <button className="button secondary" onClick={importClick}>
                  Import a saved project
                </button>
              </div>
              <p className="muted-note">
                If you choose to use the current workspace, it will replace the
                unreadable browser data. Download the original first if you need
                it.
              </p>
              <div className="dialog-actions">
                <button className="button quiet" onClick={closeDialog}>
                  Keep original data
                </button>
                <button
                  className="button primary"
                  onClick={() => {
                    workspace.resume();
                    closeDialog();
                  }}
                >
                  Use current workspace
                </button>
              </div>
            </Modal>
          )}
          {importing && (
            <div className="import-progress" role="status">
              <LoaderCircle className="spin" size={17} />
              Importing your file…
            </div>
          )}
          {openModals === 0 && (
            <NoticeMessage notice={notice} onDismiss={dismissNotice} />
          )}
        </div>
      </WorkspaceBoundary>
    </NoticeContext.Provider>
  );
}
