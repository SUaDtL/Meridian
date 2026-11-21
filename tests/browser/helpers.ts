import { expect, type Page } from "@playwright/test";

export const DRAWING =
  '[data-testid="rendered-diagram"] svg[data-meridian="diagram"]';
export async function ready(page: Page) {
  await expect(page.locator(DRAWING)).toBeVisible();
  await expect(page.locator(".render-status")).toHaveCount(0);
}
export async function openExample(page: Page, name = "Edge to cloud") {
  const welcome = page.getByRole("button", {
    name: "Browse examples",
    exact: true,
  });
  if (await welcome.isVisible()) await welcome.click();
  else
    await page.getByRole("button", { name: "Examples", exact: true }).click();
  await page
    .locator(".example-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
}
export async function continueProject(page: Page) {
  await page.getByRole("button", { name: /^Continue project:/ }).click();
  await ready(page);
}

export async function expectWorkspaceOmits(page: Page, markers: string[]) {
  const retained = await page.evaluate(async markers => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("meridian-workspace");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const names = Array.from(db.objectStoreNames);
    const records = await new Promise<unknown[][]>((resolve, reject) => {
      const transaction = db.transaction(names, "readonly");
      const reads = names.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => { db.close(); resolve(reads.map(read => read.result)); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    });
    const includesMarker = (text: string) => markers.some(marker => text.includes(marker));
    const leaks = [];
    for (const [index, values] of records.entries()) {
      const pending: unknown[] = [...values];
      const seen = new WeakSet<object>();
      while (pending.length) {
        const value = pending.pop();
        if (value && typeof value === "object") {
          if (seen.has(value)) continue;
          seen.add(value);
        }
        if (typeof value === "string" && includesMarker(value)
          || value instanceof Blob && includesMarker(await value.text())
          || (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) && includesMarker(new TextDecoder().decode(value))) {
          leaks.push(names[index]);
          break;
        }
        if (value instanceof Map) for (const [key, item] of value) pending.push(key, item);
        else if (value instanceof Set) for (const item of value) pending.push(item);
        else if (value && typeof value === "object" && !(value instanceof Blob)
          && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
          for (const [key, item] of Object.entries(value)) pending.push(key, item);
        }
      }
    }
    for (const [name, storage] of [["localStorage", localStorage], ["sessionStorage", sessionStorage]] as const) {
      const keys = Object.keys(storage);
      if (keys.some(key => includesMarker(key) || includesMarker(storage.getItem(key) ?? ""))) leaks.push(name);
    }
    return leaks;
  }, markers);
  expect(retained, "Stores containing session-only fixture input").toEqual([]);
}
