import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = path.resolve(import.meta.dirname, "..");
const port = 19080 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "medication-tracker-routes-"));

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

test.before(async () => {
  serverProcess = spawn(process.execPath, ["server/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MT_DATA_DIR: dataDir,
      MT_SITE_VISIBILITY: "public",
      MT_SITE_URL: baseUrl
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

test("GET / serves a crawlable HTML-first landing page", async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("content-type") || ""), /text\/html/i);

  const body = await response.text();
  assert.match(body, /<header>/i);
  assert.match(body, /<nav[^>]*>/i);
  assert.match(body, /<main id="main-content"/i);
  assert.match(body, /<footer>/i);
  assert.match(body, /Skip to main content/i);
  assert.match(body, /Open Medication Tracker App/i);
  assert.match(body, /application\/ld\+json/i);
  assert.match(body, /rel="canonical"/i);
});

test("GET /robots.txt blocks app/auth surfaces from indexing", async () => {
  const response = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("content-type") || ""), /text\/plain/i);

  const body = await response.text();
  assert.match(body, /Allow: \//);
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Disallow: \/app/);
  assert.match(body, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
});

test("GET /sitemap.xml includes only public pages", async () => {
  const response = await fetch(`${baseUrl}/sitemap.xml`);
  assert.equal(response.status, 200);
  assert.match(String(response.headers.get("content-type") || ""), /xml/i);

  const body = await response.text();
  assert.match(body, /<loc>http:\/\/127\.0\.0\.1:\d+\/<\/loc>/);
  assert.match(body, /<loc>http:\/\/127\.0\.0\.1:\d+\/privacy<\/loc>/);
  assert.match(body, /<loc>http:\/\/127\.0\.0\.1:\d+\/terms<\/loc>/);
  assert.doesNotMatch(body, /<loc>http:\/\/127\.0\.0\.1:\d+\/app<\/loc>/);
  assert.doesNotMatch(body, /\/api\//);
});
