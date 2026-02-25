import { test, expect } from "@playwright/test";

const BASE_URL = process.env.UI_BASE_URL || "http://127.0.0.1:8080";

test.describe("Entry workflow interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  });

  test("reset to neutral updates full check-in fields", async ({ page }) => {
    await page.getByRole("button", { name: "Add Entries" }).first().click();
    await page.getByRole("button", { name: "Daily Wellbeing Check-in" }).click();

    const moodInput = page.locator('form#formCheckin input[name="mood"]');
    await moodInput.fill("1");
    await page.locator('form#formCheckin textarea[name="sideEffectsText"]').fill("temporary note");
    await page.locator('form#formCheckin input[name="gotOutOfBedOnTime"]').check();
    await page.getByRole("button", { name: "Reset to neutral" }).click();

    await expect(moodInput).toHaveValue("6");
    await expect(page.locator('form#formCheckin input[name="anxiety"]')).toHaveValue("5");
    await expect(page.locator('form#formCheckin input[name="focus"]')).toHaveValue("6");
    await expect(page.locator('form#formCheckin textarea[name="sideEffectsText"]')).toHaveValue("");
    await expect(page.locator('form#formCheckin input[name="gotOutOfBedOnTime"]')).not.toBeChecked();
  });

  test("adding medication persists and appears on dashboard", async ({ page }) => {
    const medName = `UI Test Med ${Date.now()}`;

    await page.getByRole("button", { name: "Add Entries" }).first().click();
    await page.getByRole("button", { name: "Add Current Medication" }).click();

    await page.locator('form#formMedication input[name="name"]').fill(medName);
    await page.locator('form#formMedication input[name="currentDose"]').fill("10 mg");
    await page.locator('form#formMedication input[name="startDate"]').fill("2026-02-25");
    await page.getByRole("button", { name: "Add medication" }).click();

    await expect(page.locator("#sectionTitle")).toContainText("Dashboard");
    await expect(page.getByText(medName).first()).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Dashboard" }).first().click();
    await expect(page.getByText(medName).first()).toBeVisible();
  });

  test("saving daily check-in updates dashboard and persists", async ({ page }) => {
    const todayIso = new Date().toISOString().slice(0, 10);

    await page.getByRole("button", { name: "Add Entries" }).first().click();
    await page.getByRole("button", { name: "Daily Wellbeing Check-in" }).click();

    await page.locator('form#formCheckin input[name="date"]').fill(todayIso);
    await page.locator('form#formCheckin input[name="mood"]').fill("3");
    await page.locator('form#formCheckin input[name="anxiety"]').fill("7");
    await page.locator('form#formCheckin input[name="focus"]').fill("5");
    await page.locator('form#formCheckin input[name="sleepHours"]').fill("6.5");
    await page.getByRole("button", { name: "Save daily check-in" }).click();

    await expect(page.locator("#sectionTitle")).toContainText("Dashboard");
    await expect(page.locator("#section-dashboard").getByText("Mood 3").first()).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Dashboard" }).first().click();
    await expect(page.locator("#section-dashboard").getByText("Mood 3").first()).toBeVisible();
  });

  test("invalid check-in values show validation feedback instead of silent failure", async ({ page }) => {
    await page.getByRole("button", { name: "Add Entries" }).first().click();
    await page.getByRole("button", { name: "Daily Wellbeing Check-in" }).click();

    await page.locator('form#formCheckin input[name="mood"]').fill("22");
    await page.getByRole("button", { name: "Save daily check-in" }).click();

    await expect(page.locator("#globalStatus")).toContainText("Validation failed");
  });

  test("primary top nav buttons switch sections", async ({ page }) => {
    await page.locator('[data-topnav-id="consult"]').click();
    await expect(page.locator("#sectionTitle")).toContainText("Consult");

    await page.locator('[data-topnav-id="history"]').click();
    await expect(page.locator("#sectionTitle")).toContainText("Medication Change Log");

    await page.locator('[data-topnav-id="settings"]').click();
    await expect(page.locator("#sectionTitle")).toContainText("Settings");

    await page.locator('[data-topnav-id="share"]').click();
    await expect(page.locator("#sectionTitle")).toContainText("Sharing");

    await page.locator('[data-topnav-id="dashboard"]').click();
    await expect(page.locator("#sectionTitle")).toContainText("Dashboard");
  });

  test("consult workflow stepper moves through prepare, review, decide, and export", async ({ page }) => {
    await page.locator('[data-topnav-id="consult"]').click();
    await expect(page.locator("#sectionTitle")).toContainText("Consult");

    const stepPrepare = page.locator('[data-consult-step="prepare"]');
    const stepReview = page.locator('[data-consult-step="review"]');
    const stepDecide = page.locator('[data-consult-step="decide"]');
    const stepExport = page.locator('[data-consult-step="export"]');

    await expect(stepPrepare).toHaveClass(/active/);
    await page.locator('[data-consult-step-next="1"]').click();
    await expect(stepReview).toHaveClass(/active/);
    await expect(page.locator("#consult-current")).toBeVisible();

    await page.locator('[data-consult-step-next="1"]').click();
    await expect(stepDecide).toHaveClass(/active/);
    await expect(page.locator("#consult-plan")).toBeVisible();

    await page.locator('[data-consult-step-next="1"]').click();
    await expect(stepExport).toHaveClass(/active/);
    await expect(page.locator("#consult-export")).toBeVisible();
    await expect(page.locator('[data-consult-copy]').first()).toBeVisible();

    await page.locator('[data-consult-step-prev="1"]').click();
    await expect(stepDecide).toHaveClass(/active/);
  });
});
