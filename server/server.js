import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.MT_DATA_DIR
  ? path.resolve(process.env.MT_DATA_DIR)
  : path.join(__dirname, "data");
const storePath = path.join(dataDir, "store.json");

const port = Number(process.env.PORT || 8080);
const ownerKey = String(process.env.MT_OWNER_KEY || "");
const corsOrigin = String(process.env.CORS_ORIGIN || "*");

const app = express();
app.use(express.json({ limit: "8mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-account-id,x-owner-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

function accountIdFrom(req) {
  return String(req.header("x-account-id") || "default").trim() || "default";
}

function ownerAuthorized(req) {
  if (!ownerKey) return true;
  return String(req.header("x-owner-key") || "") === ownerKey;
}

function ensureAccount(store, accountId) {
  if (!store.accounts[accountId]) {
    store.accounts[accountId] = {
      state: null,
      updatedAt: "",
      shareAccess: {}
    };
  }
  return store.accounts[accountId];
}

async function readStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.accounts || typeof parsed.accounts !== "object") {
      return { accounts: {} };
    }
    return parsed;
  } catch (_error) {
    return { accounts: {} };
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/state", async (req, res) => {
  const accountId = accountIdFrom(req);
  const store = await readStore();
  const account = ensureAccount(store, accountId);

  if (!account.state) {
    res.status(404).json({ error: "No state stored for this account yet." });
    return;
  }

  res.json({
    accountId,
    state: account.state,
    updatedAt: account.updatedAt || ""
  });
});

app.put("/api/state", async (req, res) => {
  if (!ownerAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized. Set MT_OWNER_KEY and send x-owner-key." });
    return;
  }

  const accountId = accountIdFrom(req);
  const state = req.body?.state;
  if (!state || typeof state !== "object") {
    res.status(400).json({ error: "Request body must include a state object." });
    return;
  }

  const store = await readStore();
  const account = ensureAccount(store, accountId);
  const updatedAt = new Date().toISOString();

  account.state = state;
  account.updatedAt = updatedAt;

  await writeStore(store);
  res.json({ ok: true, accountId, updatedAt });
});

app.post("/api/share-access", async (req, res) => {
  const accountId = accountIdFrom(req);
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const store = await readStore();
  const account = ensureAccount(store, accountId);
  const current = account.shareAccess[token] || { opens: 0, lastOpenedAt: "" };
  current.opens += 1;
  current.lastOpenedAt = String(req.body?.openedAt || new Date().toISOString());
  account.shareAccess[token] = current;
  await writeStore(store);

  res.json({ ok: true, token, ...current });
});

app.get("/api/share-access", async (req, res) => {
  if (!ownerAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const accountId = accountIdFrom(req);
  const store = await readStore();
  const account = ensureAccount(store, accountId);
  res.json({ ok: true, accountId, shareAccess: account.shareAccess || {} });
});

app.use(express.static(projectRoot));
app.get("*", (_req, res) => {
  res.sendFile(path.join(projectRoot, "index.html"));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Medication Tracker server running on http://127.0.0.1:${port}`);
});
