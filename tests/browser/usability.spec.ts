import { expect, test } from "@playwright/test";
import { continueProject, DRAWING, openExample, ready } from "./helpers";
import { createDocument } from "../../src/lib/storage";
import { TEMPLATES } from "../../src/lib/templates";

test("welcome offers explicit choices and scratch starts with no established flow", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Make the complex clear." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Browse examples", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import a project or Mermaid file" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("meridian:v2")),
  ).toBeNull();
  await test
    .info()
    .attach("welcome-desktop", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  await page
    .getByRole("button", { name: "Start from scratch", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your canvas is ready." }),
  ).toBeVisible();
  await expect(page.locator(DRAWING)).toHaveCount(0);
  await expect(page.locator(".cm-content")).toHaveText("");
  await page
    .getByRole("button", { name: "Write Mermaid", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.keyboard.insertText(
    "flowchart LR\n  idea[My own idea] --> result[My own result]",
  );
  await expect(page.locator(`${DRAWING} [data-node-key="idea"]`)).toBeVisible();
  await ready(page);
  await expect(page.locator(".saved-state")).toHaveText("Saved locally");
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Continue project: Untitled diagram",
      exact: true,
    }),
  ).toBeVisible();
  await continueProject(page);
  await expect(page.locator(".cm-content")).toContainText("My own idea");
  const workspace = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("meridian:v2")!),
  );
  expect(workspace.documents).toHaveLength(1);
});

test("canvas heading edits are keyboard accessible, reversible, and preserved in the project", async ({
  page,
}) => {
  await page.goto("/");
  await openExample(page);
  const source = await page.locator(".cm-content").textContent();
  const id = await page.locator(DRAWING).getAttribute("id");
  const heading = page.getByRole("button", {
    name: "Edit diagram title",
    exact: true,
  });
  await heading.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Edit heading" });
  await expect(
    dialog.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Architecture review");
  await dialog
    .getByRole("textbox", { name: "Subtitle", exact: true })
    .fill("Decisions, dependencies, and next steps");
  await dialog
    .getByRole("button", { name: "Apply heading", exact: true })
    .click();
  await expect(page.locator('[data-frame-label="title"]').first()).toHaveText(
    "Architecture review",
  );
  expect(await page.locator(DRAWING).getAttribute("id")).toBe(id);
  expect(await page.locator(".cm-content").textContent()).toBe(source);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-frame-label="title"]').first()).toHaveText(
    "Edge to cloud",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('[data-frame-label="title"]').first()).toHaveText(
    "Architecture review",
  );
  await page.getByRole("button", { name: "Edit heading", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Discard this draft");
  await page.keyboard.press("Escape");
  await expect(page.locator(".heading-button")).toHaveText(
    "Architecture review",
  );
  await expect(
    page.getByRole("button", { name: "Edit heading", exact: true }),
  ).toBeFocused();
  await test
    .info()
    .attach("studio-desktop", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  await expect(page.locator(".saved-state")).toHaveText("Saved locally");
  await page.reload();
  await continueProject(page);
  await expect(
    page.locator('[data-frame-label="subtitle"]').first(),
  ).toHaveText("Decisions, dependencies, and next steps");
});

test("new project choices preserve existing work and deleting the final project returns to an empty welcome", async ({
  page,
}) => {
  await page.goto("/");
  await openExample(page);
  await page.getByRole("button", { name: "New diagram", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start from scratch", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your canvas is ready." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open projects", exact: true })
    .click();
  await expect(page.locator(".project-row")).toHaveCount(2);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Delete Untitled diagram", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove project", exact: true })
    .click();
  await expect(page.locator(".project-row")).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Delete Edge to cloud", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Remove project", exact: true })
    .click();
  await expect(page.locator(".project-row")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Continue project:/ }),
  ).toHaveCount(0);
  await page
    .locator(".toast")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await ready(page);
  await expect(page.locator(".heading-button")).toHaveText("Edge to cloud");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Continue project: Edge to cloud",
      exact: true,
    }),
  ).toBeVisible();
  await test
    .info()
    .attach("welcome-returning-project", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
});

test("mobile welcome, heading dialog, and inactive panel focus targets fit the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await test
    .info()
    .attach("welcome-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  await openExample(page);
  await page.getByRole("button", { name: "Edit heading", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Mobile review");
  await test
    .info()
    .attach("heading-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  await page
    .getByRole("button", { name: "Apply heading", exact: true })
    .click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.locator(".canvas-panel")).toBeHidden();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.locator(".canvas-panel")).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await test
    .info()
    .attach("studio-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
});

test("corrupt storage stays untouched while a new in-memory project can be exported", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("meridian:v2", "{damaged-original-data"),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await page
    .getByRole("button", { name: "Start from scratch", exact: true })
    .click();
  await expect(page.locator(".saved-state")).toHaveText("Autosave paused");
  await page
    .getByRole("button", { name: "Write Mermaid", exact: true })
    .click();
  await page.keyboard.insertText("flowchart LR\n  safe[Safe] --> copy[Copy]");
  await ready(page);
  expect(await page.evaluate(() => localStorage.getItem("meridian:v2"))).toBe(
    "{damaged-original-data",
  );
  const downloaded = page.waitForEvent("download");
  await page.keyboard.press("ControlOrMeta+s");
  expect((await downloaded).suggestedFilename()).toBe(
    "untitled-diagram.meridian.json",
  );
  await page
    .getByRole("button", { name: "Recovery options", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Download original browser data",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep original data", exact: true })
    .click();
  expect(await page.evaluate(() => localStorage.getItem("meridian:v2"))).toBe(
    "{damaged-original-data",
  );
});

test("another tab pauses autosave and lets the user reload the shared workspace", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await openExample(page);
  await expect(page.locator(".saved-state")).toHaveText("Saved locally");
  const other = await context.newPage();
  await other.goto("/");
  await continueProject(other);
  await other
    .getByRole("button", { name: "Edit heading", exact: true })
    .click();
  await other
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Edited in another tab");
  await other
    .getByRole("button", { name: "Apply heading", exact: true })
    .click();
  await expect(page.locator(".saved-state")).toHaveText("Autosave paused");
  await expect(page.getByRole("alert")).toContainText("changed in another tab");
  await page
    .getByRole("button", { name: "Reload workspace", exact: true })
    .click();
  await continueProject(page);
  await expect(page.locator(".heading-button")).toHaveText(
    "Edited in another tab",
  );
  await other.close();
});

test("import on the welcome screen opens the chosen project without adding an example", async ({
  page,
}) => {
  const project = {
    ...createDocument(TEMPLATES[0]),
    title: "My imported project",
  };
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", {
      name: "Import a project or Mermaid file",
      exact: true,
    })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "project.meridian.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await ready(page);
  await expect(page.locator(".heading-button")).toHaveText(project.title);
  await expect(page.locator(".saved-state")).toHaveText("Saved locally");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("meridian:v2")!).documents.length,
    ),
  ).toBe(1);
});
