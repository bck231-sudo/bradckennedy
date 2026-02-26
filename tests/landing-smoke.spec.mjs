import { test, expect } from "@playwright/test";

const BASE_URL = process.env.UI_BASE_URL || "http://127.0.0.1:8080";
const ROOT_URL = (() => {
  try {
    return `${new URL(BASE_URL).origin}/`;
  } catch {
    return "http://127.0.0.1:8080/";
  }
})();

test("public landing page is accessible and has CTA links", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(ROOT_URL, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { level: 1, name: /Medication Tracker/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open (the )?Medication Tracker app/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Skip to main content/i })).toHaveCount(1);

  expect(consoleErrors).toEqual([]);
});
