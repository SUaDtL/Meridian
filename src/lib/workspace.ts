import type { StudioDocument, StudioSettings } from "../types";

export type DocumentPatch = Partial<
  Pick<
    StudioDocument,
    | "title"
    | "subtitle"
    | "source"
    | "settings"
    | "nodeAccents"
    | "design"
    | "storyboard"
  >
>;
type Entry = { document: StudioDocument; label: string; bytes: number };
export interface WorkspaceState {
  documents: StudioDocument[];
  activeId: string | null;
  past: Entry[];
  future: Entry[];
  revision: number;
  group: string;
  editedAt: number;
}
export type WorkspaceAction =
  | {
      type: "patch";
      patch: DocumentPatch;
      label: string;
      at: number;
      group?: string;
    }
  | { type: "settings"; patch: Partial<StudioSettings>; at: number }
  | { type: "open"; id: string }
  | { type: "add"; document: StudioDocument }
  | { type: "remove"; id: string }
  | { type: "restore"; document: StudioDocument }
  | { type: "replace"; documents: StudioDocument[]; activeId: string | null }
  | { type: "undo" }
  | { type: "redo" };

export function workspaceState(
  documents: StudioDocument[],
  activeId: string | null,
): WorkspaceState {
  return {
    documents,
    activeId,
    past: [],
    future: [],
    revision: 0,
    group: "",
    editedAt: 0,
  };
}

function entry(document: StudioDocument, label: string): Entry {
  return {
    document,
    label,
    bytes:
      document.source.length * 2 +
      JSON.stringify([
        document.settings,
        document.design,
        document.nodeAccents,
        document.storyboard,
        document.title,
        document.subtitle,
      ]).length *
        2,
  };
}

function bounded(entries: Entry[]): Entry[] {
  let bytes = 0;
  let start = entries.length;
  while (start > 0 && entries.length - start < 50) {
    const next = entries[start - 1].bytes;
    if (bytes + next > 8_000_000) break;
    bytes += next;
    start--;
  }
  return entries.slice(start);
}

function replaceDocument(
  state: WorkspaceState,
  document: StudioDocument,
): StudioDocument[] {
  return state.documents.map((value) =>
    value.id === document.id ? document : value,
  );
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  const current = state.documents.find(
    (document) => document.id === state.activeId,
  );
  if (action.type === "replace")
    return workspaceState(action.documents, action.activeId);
  if (action.type === "open") {
    if (
      action.id === state.activeId ||
      !state.documents.some((document) => document.id === action.id)
    )
      return state;
    return {
      ...state,
      activeId: action.id,
      past: [],
      future: [],
      group: "",
      revision: state.revision + 1,
    };
  }
  if (action.type === "add" || action.type === "restore") {
    if (
      state.documents.length >= 50 ||
      state.documents.some((document) => document.id === action.document.id)
    )
      return state;
    return {
      ...state,
      documents: [action.document, ...state.documents],
      activeId: action.document.id,
      past: [],
      future: [],
      group: "",
      revision: state.revision + 1,
    };
  }
  if (action.type === "remove") {
    if (!state.documents.some((document) => document.id === action.id))
      return state;
    const documents = state.documents.filter(
      (document) => document.id !== action.id,
    );
    const active = state.activeId === action.id;
    return {
      ...state,
      documents,
      activeId: active ? (documents[0]?.id ?? null) : state.activeId,
      past: active ? [] : state.past,
      future: active ? [] : state.future,
      group: "",
      revision: state.revision + 1,
    };
  }
  if (!current) return state;
  if (action.type === "undo" || action.type === "redo") {
    const from = action.type === "undo" ? state.past : state.future;
    const target = from.at(-1);
    if (!target) return state;
    const document = {
      ...target.document,
      updatedAt: new Date().toISOString(),
    };
    return {
      ...state,
      documents: replaceDocument(state, document),
      revision: state.revision + 1,
      group: "",
      editedAt: 0,
      past:
        action.type === "undo"
          ? state.past.slice(0, -1)
          : bounded([...state.past, entry(current, target.label)]),
      future:
        action.type === "undo"
          ? bounded([...state.future, entry(current, target.label)])
          : state.future.slice(0, -1),
    };
  }
  let patch: DocumentPatch;
  let label: string;
  let group: string;
  if (action.type === "settings") {
    if (
      Object.entries(action.patch).every(
        ([key, value]) =>
          current.settings[key as keyof StudioSettings] === value,
      )
    )
      return state;
    patch = {
      settings: { ...current.settings, ...action.patch },
      design: { ...current.design, preset: "custom" },
    };
    label = "Change appearance";
    group = `settings:${Object.keys(action.patch).sort().join(",")}`;
  } else {
    patch = action.patch;
    label = action.label;
    group = action.group ?? "";
    if (
      Object.entries(patch).every(
        ([key, value]) => current[key as keyof StudioDocument] === value,
      )
    )
      return state;
  }
  const coalesced =
    group !== "" &&
    group === state.group &&
    action.at - state.editedAt < 800 &&
    state.future.length === 0;
  const document = {
    ...current,
    ...patch,
    updatedAt: new Date(action.at).toISOString(),
  };
  return {
    ...state,
    documents: replaceDocument(state, document),
    past: coalesced
      ? state.past
      : bounded([...state.past, entry(current, label)]),
    future: [],
    group,
    editedAt: action.at,
    revision: state.revision + 1,
  };
}
