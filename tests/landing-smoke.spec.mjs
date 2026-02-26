import { test, expect } from "@playwright/test";

const BASE_URL = process.env.UI_BASE_URL || "http://127.0.0.1:8080";
const ROOT_URL = (() => {
  try {
    return `${new URL(BASE_URL).origin}/`;
  } catch {
    return "http://127.0.0.1:8080/";
  }
})();
const APP_URL = `${ROOT_URL.replace(/\/+$/, "")}/app`;

test("public landing page is accessible and has CTA links", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(ROOT_URL, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1, name: /Medication Tracker/i })).toBeVisible();
  const primaryNav = page.getByRole("navigation", { name: /primary/i });
  await expect(primaryNav).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "About", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Contact", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Open App", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open (the )?Medication Tracker app/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Skip to main content/i })).toHaveCount(1);

  await primaryNav.getByRole("link", { name: "Open App", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${APP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  await expect(page.locator("#mainContent")).toBeVisible();
  await expect(page.locator("#sectionTitle")).toContainText(/Dashboard/i);

  expect(consoleErrors).toEqual([]);
});
