import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = path.resolve(import.meta.dirname, "..");
const port = 19680 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "medication-tracker-auth-"));

let serverProcess;
let serverLogs = "";

async function waitForServerReady() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep waiting.
    }
    await delay(120);
  }
  throw new Error(`Server did not start in time. Logs:\n${serverLogs}`);
}

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function sessionCookieFrom(response) {
  const raw = String(response.headers.get("set-cookie") || "");
  return raw.split(";")[0] || "";
}

function withSession(cookie, headers = {}) {
  return cookie ? { ...headers, cookie } : headers;
}

function readStoreText() {
  return readFileSync(path.join(dataDir, "store.json"), "utf8");
}

test.before(async () => {
  serverProcess = spawn(process.execPath, ["server/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MT_DATA_DIR: dataDir,
      MT_EXPOSE_RESET_LINKS: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout?.on("data", (chunk) => {
    serverLogs += String(chunk);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    serverLogs += String(chunk);
  });

  await waitForServerReady();
});

test.after(async () => {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    delay(3_000).then(() => {
      if (!serverProcess.killed) serverProcess.kill("SIGKILL");
    })
  ]);
});

test("anonymous visitors cannot read or write account state", async () => {
  const readResponse = await fetch(`${baseUrl}/api/state`);
  assert.equal(readResponse.status, 401);

  const write = await jsonRequest(`${baseUrl}/api/state`, {
    method: "PUT",
    body: JSON.stringify({ state: { version: 3 } })
  });
  assert.equal(write.response.status, 401);
});

test("legacy owner bypass headers no longer grant access", async () => {
  const readResponse = await fetch(`${baseUrl}/api/state`, {
    headers: {
      "x-owner-key": "legacy-key",
      "x-account-id": "default"
    }
  });
  assert.equal(readResponse.status, 401);

  const write = await jsonRequest(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: {
      "x-owner-key": "legacy-key",
      "x-account-id": "default"
    },
    body: JSON.stringify({ state: { version: 3 } })
  });
  assert.equal(write.response.status, 401);
});

test("invalid share access logging is rejected for anonymous traffic", async () => {
  const result = await jsonRequest(`${baseUrl}/api/share-access`, {
    method: "POST",
    body: JSON.stringify({
      token: "not-a-real-share-token"
    })
  });
  assert.equal(result.response.status, 404);
});

test("separate sign-ups get separate workspaces and data isolation", async () => {
  const ownerOne = await jsonRequest(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    body: JSON.stringify({
      email: "owner-one@example.com",
      password: "password-123",
      name: "Owner One"
    })
  });
  assert.equal(ownerOne.response.status, 200);
  assert.equal(ownerOne.body.role, "owner");
  assert.equal("token" in ownerOne.body, false);
  assert.match(String(ownerOne.response.headers.get("set-cookie") || ""), /HttpOnly/i);
  assert.match(String(ownerOne.response.headers.get("set-cookie") || ""), /SameSite=Lax/i);

  const ownerOneCookie = sessionCookieFrom(ownerOne.response);
  const ownerOneAccountId = ownerOne.body.accountId;

  const stateWrite = await jsonRequest(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: withSession(ownerOneCookie),
    body: JSON.stringify({
      state: {
        version: 3,
        medications: [
          {
            id: "med-1",
            name: "Owner One Med",
            currentDose: "10 mg",
            scheduleTimes: ["08:00"]
          }
        ],
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
      }
    })
  });
  assert.equal(stateWrite.response.status, 200);

  const ownerTwo = await jsonRequest(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    body: JSON.stringify({
      email: "owner-two@example.com",
      password: "password-456",
      name: "Owner Two"
    })
  });
  assert.equal(ownerTwo.response.status, 200);
  assert.notEqual(ownerTwo.body.accountId, ownerOneAccountId);
  const ownerTwoCookie = sessionCookieFrom(ownerTwo.response);

  const ownerTwoState = await fetch(`${baseUrl}/api/state`, {
    headers: {
      ...withSession(ownerTwoCookie),
      "x-account-id": ownerOneAccountId
    }
  });
  assert.equal(ownerTwoState.status, 409);

  const ownerTwoWriteMismatch = await jsonRequest(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: {
      ...withSession(ownerTwoCookie),
      "x-account-id": ownerOneAccountId
    },
    body: JSON.stringify({ state: { version: 3, medications: [] } })
  });
  assert.equal(ownerTwoWriteMismatch.response.status, 409);

  const ownerOneState = await fetch(`${baseUrl}/api/state`, {
    headers: withSession(ownerOneCookie)
  });
  const ownerOneBody = await ownerOneState.json();
  assert.equal(ownerOneState.status, 200);
  assert.equal(ownerOneBody.state.medications[0].name, "Owner One Med");
  assert.equal(ownerOneBody.state.medications[0].accountId, ownerOneAccountId);
  assert.ok(ownerOneBody.state.medications[0].ownerUserId);
});

test("clinician invite is read-only and share links stay read-only", async () => {
  const owner = await jsonRequest(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    body: JSON.stringify({
      email: "owner-share@example.com",
      password: "password-123",
      name: "Owner Share"
    })
  });
  const ownerCookie = sessionCookieFrom(owner.response);

  await jsonRequest(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: withSession(ownerCookie),
    body: JSON.stringify({
      state: {
        version: 3,
        medications: [{ id: "med-1", name: "Shared Med", currentDose: "20 mg", scheduleTimes: ["09:00"] }],
        changes: [],
        notes: [{ id: "note-1", noteType: "journal", noteText: "private note", isSensitive: true }],
        checkins: [],
        adherence: [],
        doseSnoozes: [],
        medicationChangeExperiments: [],
        consultQuestions: [],
        decisionLog: [],
        sideEffectEvents: [],
        appointmentEvents: []
      }
    })
  });

  const invite = await jsonRequest(`${baseUrl}/api/auth/invites`, {
    method: "POST",
    headers: withSession(ownerCookie),
    body: JSON.stringify({
      email: "clinician@example.com",
      name: "Clinician",
      role: "clinician"
    })
  });
  assert.equal(invite.response.status, 200);

  const accepted = await jsonRequest(`${baseUrl}/api/auth/invites/accept`, {
    method: "POST",
    body: JSON.stringify({
      token: invite.body.inviteToken,
      password: "password-789",
      name: "Clinician User"
    })
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.role, "clinician");

  const clinicianRead = await fetch(`${baseUrl}/api/state`, {
    headers: withSession(sessionCookieFrom(accepted.response))
  });
  assert.equal(clinicianRead.status, 200);

  const clinicianWrite = await jsonRequest(`${baseUrl}/api/state`, {
    method: "PUT",
    headers: withSession(sessionCookieFrom(accepted.response)),
    body: JSON.stringify({ state: { version: 3, medications: [] } })
  });
  assert.equal(clinicianWrite.response.status, 401);

  const clinicianRiskNotification = await jsonRequest(`${baseUrl}/api/notifications/risk`, {
    method: "POST",
    headers: withSession(sessionCookieFrom(accepted.response)),
    body: JSON.stringify({ level: "high", reasons: ["test"] })
  });
  assert.equal(clinicianRiskNotification.response.status, 403);

  const clinicianShareAccessWrite = await jsonRequest(`${baseUrl}/api/share-access`, {
    method: "POST",
    headers: withSession(sessionCookieFrom(accepted.response)),
    body: JSON.stringify({ token: "not-a-real-token" })
  });
  assert.equal(clinicianShareAccessWrite.response.status, 404);

  const share = await jsonRequest(`${baseUrl}/api/shares`, {
    method: "POST",
    headers: withSession(ownerCookie),
    body: JSON.stringify({
      name: "Psychiatrist View",
      role: "clinician",
      preset: "clinician",
      permissions: {
        showSensitiveNotes: false,
        showSensitiveTags: false,
        showJournalText: false,
        showLibido: false,
        showSubstance: false,
        showFreeText: false
      },
      allowedModes: ["daily", "clinical"],
      startSection: "consult"
    })
  });
  assert.equal(share.response.status, 200);
  const storeText = readStoreText();
  const shareUrl = new URL(share.body.share.url);
  const shareToken = decodeURIComponent(shareUrl.hash.replace("#share_token=", ""));
  assert.ok(shareToken);
  assert.equal(storeText.includes(shareToken), false);
  assert.match(storeText, /"tokenHash":\s*"/);

  const shareSession = await jsonRequest(`${baseUrl}/api/shares/session`, {
    method: "POST",
    body: JSON.stringify({ token: shareToken })
  });
  assert.equal(shareSession.response.status, 200);
  assert.equal(shareSession.body.share.startSection, "consult");
  assert.equal(shareSession.body.state.notes[0].noteText, "");
});

test("password reset can rotate credentials and invalidate old sessions", async () => {
  const signUp = await jsonRequest(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    body: JSON.stringify({
      email: "reset-user@example.com",
      password: "old-password-123",
      name: "Reset User"
    })
  });
  assert.equal(signUp.response.status, 200);
  const oldSessionCookie = sessionCookieFrom(signUp.response);

  const requestReset = await jsonRequest(`${baseUrl}/api/auth/password-reset/request`, {
    method: "POST",
    body: JSON.stringify({ email: "reset-user@example.com" })
  });
  assert.equal(requestReset.response.status, 200);
  assert.match(String(requestReset.body.resetUrl || ""), /#reset=/);

  const resetToken = decodeURIComponent(String(requestReset.body.resetUrl).split("#reset=")[1] || "");
  const completeReset = await jsonRequest(`${baseUrl}/api/auth/password-reset/complete`, {
    method: "POST",
    body: JSON.stringify({
      token: resetToken,
      password: "new-password-456"
    })
  });
  assert.equal(completeReset.response.status, 200);
  const resetStoreText = readStoreText();
  assert.equal(resetStoreText.includes(resetToken), false);

  const oldSessionRead = await fetch(`${baseUrl}/api/auth/me`, {
    headers: withSession(oldSessionCookie)
  });
  assert.equal(oldSessionRead.status, 401);

  const newLogin = await jsonRequest(`${baseUrl}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({
      email: "reset-user@example.com",
      password: "new-password-456"
    })
  });
  assert.equal(newLogin.response.status, 200);
  const newSessionCookie = sessionCookieFrom(newLogin.response);
  assert.ok(newSessionCookie);

  const reusedReset = await jsonRequest(`${baseUrl}/api/auth/password-reset/complete`, {
    method: "POST",
    body: JSON.stringify({
      token: resetToken,
      password: "another-password-789"
    })
  });
  assert.equal(reusedReset.response.status, 410);

  const meAfterLogin = await fetch(`${baseUrl}/api/auth/me`, {
    headers: withSession(newSessionCookie)
  });
  assert.equal(meAfterLogin.status, 200);
});

test("sign-in rate limiting blocks repeated brute-force attempts", async () => {
  const signUp = await jsonRequest(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    body: JSON.stringify({
      email: "ratelimit-user@example.com",
      password: "password-123",
      name: "Rate Limit User"
    })
  });
  assert.equal(signUp.response.status, 200);

  let lastAttempt = null;
  for (let index = 0; index < 11; index += 1) {
    lastAttempt = await jsonRequest(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({
        email: "ratelimit-user@example.com",
        password: "wrong-password"
      })
    });
  }

  assert.equal(lastAttempt.response.status, 429);
  assert.match(String(lastAttempt.response.headers.get("retry-after") || ""), /^[1-9]/);
});

test("sign out revokes the cookie-backed session", async () => {
  const signUp = await jsonRequest(`${baseUrl}/api/auth/sign-up`, {
    method: "POST",
    body: JSON.stringify({
      email: "logout-user@example.com",
      password: "password-123",
      name: "Logout User"
    })
  });
  assert.equal(signUp.response.status, 200);
  const sessionCookie = sessionCookieFrom(signUp.response);

  const logout = await jsonRequest(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: withSession(sessionCookie)
  });
  assert.equal(logout.response.status, 200);
  assert.match(String(logout.response.headers.get("set-cookie") || ""), /Expires=Thu, 01 Jan 1970/i);

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: withSession(sessionCookie)
  });
  assert.equal(me.status, 401);
});
