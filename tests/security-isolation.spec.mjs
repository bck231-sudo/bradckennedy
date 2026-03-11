import { test, expect } from "@playwright/test";

const BASE_URL = process.env.UI_BASE_URL || "http://127.0.0.1:8080";
const APP_URL = process.env.UI_APP_URL || `${BASE_URL.replace(/\/+$/, "")}/app`;
const STORAGE_KEY = "medication_tracker_data_v1";

async function signUp(page, { name, email, password, importLegacyData = false }) {
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator('#authSignupForm input[name="name"]').fill(name);
  await page.locator('#authSignupForm input[name="email"]').fill(email);
  await page.locator('#authSignupForm input[name="password"]').fill(password);
  if (importLegacyData) {
    await page.locator('#authSignupForm input[name="importLegacyData"]').check();
  }
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.waitForFunction(() => {
    const sync = JSON.parse(localStorage.getItem("medication_tracker_sync_config_v1") || "{}");
    return Boolean(sync.sessionActive && sync.accountId);
  }, null, { timeout: 15000 });
  await expect(page.locator("#sectionTitle")).toContainText("Today", { timeout: 15000 });
}

async function readCurrentAccountState(page) {
  return await page.evaluate(async () => {
    const response = await fetch("/api/state", { credentials: "include" });
    const body = await response.json();
    return {
      status: response.status,
      state: body.state || null
    };
  });
}

test("legacy browser data does not auto-import without explicit consent", async ({ page }) => {
  await page.addInitScript(({ storageKey }) => {
    localStorage.setItem(storageKey, JSON.stringify({
      version: 3,
      medications: [{ id: "legacy-med", name: "Legacy Medication", currentDose: "5 mg", scheduleTimes: ["08:00"] }],
      changes: [],
      notes: [],
      checkins: [],
      adherence: [],
      doseSnoozes: [],
      medicationChangeExperiments: [],
      consultQuestions: [],
      decisionLog: [],
      sideEffectEvents: [],
      appointmentEvents: []
    }));
  }, { storageKey: STORAGE_KEY });

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await expect(page.getByText("Existing browser data found.")).toBeVisible();

  const email = `no-import-${Date.now()}@example.com`;
  await signUp(page, {
    name: "No Import User",
    email,
    password: "password-123",
    importLegacyData: false
  });

  const result = await readCurrentAccountState(page);
  expect(result.status).toBe(404);
});

test("sign out clears browser workspace cache before another account is created", async ({ page }) => {
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const ownerOneEmail = `owner-one-${Date.now()}@example.com`;
  await signUp(page, {
    name: "Owner One",
    email: ownerOneEmail,
    password: "password-123"
  });

  await page.locator('[data-topnav-id="record"]').click();
  await page.getByRole("button", { name: "Add Current Medication" }).click();
  await page.locator('form#formMedication input[name="name"]').fill("Carryover Med");
  await page.locator('form#formMedication input[name="currentDose"]').fill("5 mg");
  await page.locator('form#formMedication input[name="startDate"]').fill("2026-03-08");
  await page.getByRole("button", { name: "Add medication" }).click();
  await expect(page.getByText("Carryover Med").first()).toBeVisible();

  await page.locator('[data-topnav-id="share"]').click();
  await page.locator("#shareAdvancedDetails summary").click();
  await page.locator("#cloudLogoutButton").click();
  await page.waitForFunction(() => {
    const sync = JSON.parse(localStorage.getItem("medication_tracker_sync_config_v1") || "{}");
    return !sync.sessionActive;
  }, null, { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#authSigninForm")).toBeVisible();
  await expect(page.getByText("Existing browser data found.")).toHaveCount(0);

  const ownerTwoEmail = `owner-two-${Date.now()}@example.com`;
  await signUp(page, {
    name: "Owner Two",
    email: ownerTwoEmail,
    password: "password-456"
  });

  const result = await readCurrentAccountState(page);
  expect(result.status).toBe(404);
});
