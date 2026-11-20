import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY,
  loadWorkspace,
  saveWorkspace,
} from "../lib/storage";
import {
  workspaceReducer,
  workspaceState,
  type DocumentPatch,
} from "../lib/workspace";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { StudioDocument, StudioSettings } from "../types";

export function useWorkspace() {
  const [initial] = useState(loadWorkspace);
  const [state, dispatch] = useReducer(workspaceReducer, initial, (value) =>
    workspaceState(value.documents, value.activeId),
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [warning, setWarning] = useState(initial.warning || "");
  const [autosave, setAutosave] = useState(!initial.warning);
  const [externalChange, setExternalChange] = useState(false);
  const latest = useRef({ state, autosave });
  latest.current = { state, autosave };
  const saved = useRef({ documents: initial.documents, activeId: initial.activeId });
  const isSaved = useCallback((snapshot: typeof saved.current) =>
    snapshot.documents === saved.current.documents && snapshot.activeId === saved.current.activeId, []);

  const flush = useCallback(() => {
    const current = latest.current;
    if (!current.autosave || isSaved(current.state))
      return;
    const result = saveWorkspace(
      current.state.documents,
      current.state.activeId,
    );
    if (result.ok) {
      saved.current = current.state;
      setWarning("");
    } else
      setWarning(
        result.error ||
          "Browser storage is unavailable. Download your project to keep it.",
      );
    setSaveState(result.ok ? "saved" : "error");
  }, [isSaved]);

  const { documents, activeId } = state;
  useEffect(() => {
    if (!autosave || isSaved({ documents, activeId })) return;
    setSaveState("saving");
    const timer = window.setTimeout(flush, 450);
    return () => window.clearTimeout(timer);
  }, [documents, activeId, autosave, flush, isSaved]);

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const changed = (event: StorageEvent) => {
      if (
        ![STORAGE_KEY, LEGACY_STORAGE_KEY].includes(event.key || "") ||
        event.newValue === event.oldValue
      )
        return;
      try {
        if (
          event.key === LEGACY_STORAGE_KEY &&
          localStorage.getItem(STORAGE_KEY) !== null
        )
          return;
      } catch {
        /* report via paused state */
      }
      latest.current.autosave = false;
      setAutosave(false);
      setExternalChange(true);
      setWarning(
        "This workspace changed in another tab. Autosave is paused here. Download your current project before reloading if it has changes you want to keep.",
      );
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("storage", changed);
    };
  }, [flush]);

  const reload = useCallback(() => {
    const fresh = loadWorkspace();
    if (fresh.warning) {
      setWarning(fresh.warning);
      return false;
    }
    saved.current = fresh;
    dispatch({
      type: "replace",
      documents: fresh.documents,
      activeId: fresh.activeId,
    });
    setWarning("");
    setAutosave(true);
    setExternalChange(false);
    setSaveState("saved");
    return true;
  }, []);

  const resume = useCallback(() => {
    const current = latest.current.state;
    const result = saveWorkspace(current.documents, current.activeId);
    if (!result.ok) {
      setWarning(result.error || "Could not save this workspace.");
      setSaveState("error");
      return;
    }
    saved.current = current;
    setAutosave(true);
    setExternalChange(false);
    setWarning("");
    setSaveState("saved");
  }, []);

  const patch = useCallback(
    (value: DocumentPatch, label = "Edit project", group?: string) =>
      dispatch({ type: "patch", patch: value, label, group, at: Date.now() }),
    [],
  );
  const applyProposal = useCallback(
    (proposal: ReadyProposal) => dispatch({ type: "proposal", proposal, at: Date.now() }),
    [],
  );
  const settings = useCallback(
    (value: Partial<StudioSettings>) =>
      dispatch({ type: "settings", patch: value, at: Date.now() }),
    [],
  );
  const open = useCallback((id: string) => dispatch({ type: "open", id }), []);
  const add = useCallback(
    (document: StudioDocument) => dispatch({ type: "add", document }),
    [],
  );
  const remove = useCallback(
    (id: string) => dispatch({ type: "remove", id }),
    [],
  );
  const restore = useCallback(
    (document: StudioDocument) => dispatch({ type: "restore", document }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    documents,
    activeId,
    document:
      state.documents.find((value) => value.id === state.activeId) ?? null,
    saveState,
    warning,
    autosave,
    externalChange,
    revision: state.revision,
    proposalOutcome: state.proposalOutcome,
    applyProposal,
    patch,
    settings,
    open,
    add,
    remove,
    restore,
    undo,
    redo,
    reload,
    resume,
    flush,
    undoLabel: state.past.at(-1)?.label,
    redoLabel: state.future.at(-1)?.label,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
