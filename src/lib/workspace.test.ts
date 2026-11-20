import { describe, expect, it } from "vitest";
import { createDocument } from "./storage";
import { workspaceReducer, workspaceState } from "./workspace";

describe("workspace editing and recovery", () => {
  it("starts genuinely empty and does not invent another project after the last deletion", () => {
    const project = createDocument();
    expect(project.title).toBe("Untitled diagram");
    expect(project.source).toBe("");
    let state = workspaceState([], null);
    state = workspaceReducer(state, { type: "add", document: project });
    state = workspaceReducer(state, { type: "remove", id: project.id });
    expect(state.documents).toEqual([]);
    expect(state.activeId).toBeNull();
    state = workspaceReducer(state, { type: "restore", document: project });
    expect(state.documents).toEqual([project]);
    expect(state.activeId).toBe(project.id);
  });

  it("coalesces a typing burst, supports undo/redo, and discards redo after a new edit", () => {
    const project = createDocument();
    let state = workspaceState([project], project.id);
    state = workspaceReducer(state, {
      type: "patch",
      patch: { source: "flowchart LR\nA" },
      label: "Edit source",
      group: "source",
      at: 1000,
    });
    state = workspaceReducer(state, {
      type: "patch",
      patch: { source: "flowchart LR\nA --> B" },
      label: "Edit source",
      group: "source",
      at: 1100,
    });
    expect(state.past).toHaveLength(1);
    state = workspaceReducer(state, { type: "undo" });
    expect(state.documents[0].source).toBe("");
    state = workspaceReducer(state, { type: "redo" });
    expect(state.documents[0].source).toBe("flowchart LR\nA --> B");
    state = workspaceReducer(state, { type: "undo" });
    state = workspaceReducer(state, {
      type: "patch",
      patch: { title: "A different direction" },
      label: "Edit heading",
      at: 1200,
    });
    expect(state.future).toHaveLength(0);
    expect(state.documents[0].source).toBe("");
  });

  it("treats a multi-part preset as one reversible change without changing source", () => {
    const project = { ...createDocument(), source: "flowchart LR\nA --> B" };
    let state = workspaceState([project], project.id);
    state = workspaceReducer(state, {
      type: "patch",
      label: "Apply design",
      at: 1000,
      patch: {
        settings: { ...project.settings, theme: "porcelain", motion: "none" },
        design: { preset: "executive", elements: {} },
        nodeAccents: {},
      },
    });
    expect(state.past).toHaveLength(1);
    expect(state.documents[0].settings.theme).toBe("porcelain");
    state = workspaceReducer(state, { type: "undo" });
    expect(state.documents[0].settings).toEqual(project.settings);
    expect(state.documents[0].design).toEqual(project.design);
    expect(state.documents[0].source).toBe(project.source);
    state = workspaceReducer(state, { type: "redo" });
    expect(state.documents[0].design.preset).toBe("executive");
  });

  it("does not autosave or create history for no-op edits and does not leak history between projects", () => {
    const first = createDocument(),
      second = createDocument();
    const original = workspaceState([first, second], first.id);
    expect(
      workspaceReducer(original, {
        type: "patch",
        patch: { title: first.title },
        label: "Edit heading",
        at: 1000,
      }),
    ).toBe(original);
    expect(
      workspaceReducer(original, {
        type: "settings",
        patch: { theme: first.settings.theme },
        at: 1000,
      }),
    ).toBe(original);
    let state = workspaceReducer(original, {
      type: "patch",
      patch: { title: "First project" },
      label: "Edit heading",
      at: 1000,
    });
    state = workspaceReducer(state, { type: "open", id: second.id });
    expect(state.past).toHaveLength(0);
    expect(workspaceReducer(state, { type: "undo" })).toBe(state);
    expect(state.documents[0].title).toBe("First project");
    expect(state.documents[1]).toBe(second);
  });

  it("bounds session history while keeping the latest changes undoable", () => {
    const project = createDocument();
    let state = workspaceState([project], project.id);
    for (let index = 0; index < 75; index++)
      state = workspaceReducer(state, {
        type: "patch",
        patch: { title: `Revision ${index}` },
        label: "Edit heading",
        at: 1000 + index,
      });
    expect(state.past).toHaveLength(50);
    state = workspaceReducer(state, { type: "undo" });
    expect(state.documents[0].title).toBe("Revision 73");
    expect(state.future).toHaveLength(1);
  });
});
