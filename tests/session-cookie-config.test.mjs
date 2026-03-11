import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function startServer(extraEnv = {}) {
  const port = 20000 + Math.floor(Math.random() * 2000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "medication-tracker-cookie-"));
  let logs = "";
  const serverProcess = spawn(process.execPath, ["server/server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      MT_DATA_DIR: dataDir,
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProcess.stdout?.on("data", (chunk) => {
    logs += String(chunk);
  });
  serverProcess.stderr?.on("data", (chunk) => {
    logs += String(chunk);
  });

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return { serverProcess, baseUrl };
      }
    } catch {
      // Keep waiting for the server to boot.
    }
    await delay(120);
  }

  serverProcess.kill("SIGTERM");
  throw new Error(`Server did not start in time. Logs:\n${logs}`);
}

async function stopServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    delay(3_000).then(() => {
      if (!serverProcess.killed) serverProcess.kill("SIGKILL");
    })
  ]);
}

test("cross-site auth automatically sets a secure SameSite=None session cookie", async () => {
  const { serverProcess, baseUrl } = await startServer({
    CORS_ORIGIN: "https://adhdagenda.com"
  });

  try {
    const response = await fetch(`${baseUrl}/api/auth/sign-up`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://adhdagenda.com"
      },
      body: JSON.stringify({
        email: `cookie-check-${Date.now()}@example.com`,
        password: "password-123",
        name: "Cookie Check"
      })
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://adhdagenda.com");
    assert.match(String(response.headers.get("set-cookie") || ""), /SameSite=None/i);
    assert.match(String(response.headers.get("set-cookie") || ""), /Secure/i);
  } finally {
    await stopServer(serverProcess);
  }
});
