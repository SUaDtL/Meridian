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
