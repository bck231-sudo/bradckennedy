import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createOpaqueToken,
  decryptJsonForAccount,
  encryptJsonForAccount,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  normalizeRole,
  passwordMeetsMinimum,
  roleAllowsAuditRead,
  roleAllowsWrite,
  sanitizeUser,
  verifyPassword
} from "./lib/security.js";
import {
  accountHasMembers,
  addAuditEvent,
  addNotification,
  createEmptyStore,
  ensureAccount,
  findUserByEmail,
  listInvites,
  listMembers,
  memberForUser,
  normalizeStore,
  nowIso
} from "./lib/store-model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = process.env.MT_DATA_DIR
  ? path.resolve(process.env.MT_DATA_DIR)
  : path.join(__dirname, "data");
const storePath = path.join(dataDir, "store.json");

const port = Number(process.env.PORT || 8080);
const ownerKey = String(process.env.MT_OWNER_KEY || "");
const encryptionKey = String(process.env.MT_ENCRYPTION_KEY || "");
const sessionTtlDays = Number(process.env.MT_SESSION_TTL_DAYS || 30);
const inviteTtlDays = Number(process.env.MT_INVITE_TTL_DAYS || 14);
const siteVisibility = String(
  process.env.MT_SITE_VISIBILITY
    || (String(process.env.MT_PRIVATE_SITE || "").toLowerCase() === "false" ? "public" : "private")
).trim().toLowerCase();
const isPrivateSite = !["public", "indexable"].includes(siteVisibility);
const configuredSiteUrl = String(process.env.MT_SITE_URL || "").trim().replace(/\/+$/, "");
const configuredAppUrl = String(process.env.MT_APP_URL || "").trim().replace(/\/+$/, "");
const publicAppUrl = configuredAppUrl || "/app";
const allowLegacyOwnerKey = String(process.env.MT_ALLOW_LEGACY_OWNER_KEY || "true") !== "false";
const corsOrigins = String(process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAnyCorsOrigin = !corsOrigins.length || corsOrigins.includes("*");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "8mb" }));

let indexTemplateCache = "";

const publicPages = Object.freeze([
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/about", changefreq: "monthly", priority: "0.7" },
  { path: "/contact", changefreq: "monthly", priority: "0.7" },
  { path: "/privacy", changefreq: "monthly", priority: "0.6" },
  { path: "/terms", changefreq: "monthly", priority: "0.6" }
]);

const publicNavItems = Object.freeze([
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: publicAppUrl, label: "Open App" }
]);

const htmlCacheControl = "public, max-age=0, must-revalidate";
const staticAssetCacheControl = "public, max-age=604800, stale-while-revalidate=86400";
const shortAssetCacheControl = "public, max-age=86400, stale-while-revalidate=3600";

function appendVaryHeader(res, value) {
  const existing = String(res.getHeader("Vary") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!existing.includes(value)) {
    existing.push(value);
    res.setHeader("Vary", existing.join(", "));
  }
}

app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    "manifest-src 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.secure || String(req.header("x-forwarded-proto") || "").toLowerCase() === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use((req, res, next) => {
  const requestOrigin = String(req.header("origin") || "").trim();
  const allowedOrigin = allowAnyCorsOrigin
    ? "*"
    : (requestOrigin && corsOrigins.includes(requestOrigin) ? requestOrigin : corsOrigins[0]);
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  appendVaryHeader(res, "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,x-account-id,x-owner-key");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use((req, res, next) => {
  if (isPrivateSite) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  next();
});

function resolveSiteUrl(req) {
  if (configuredSiteUrl) return configuredSiteUrl;
  return `${req.protocol}://${req.get("host")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function canonicalUrlFor(req, pathname = "/") {
  const siteUrl = resolveSiteUrl(req).replace(/\/+$/, "");
  const safePath = String(pathname || "/").startsWith("/") ? String(pathname || "/") : `/${String(pathname || "/")}`;
  return `${siteUrl}${safePath === "/" ? "/" : safePath}`;
}

function renderPublicLayout(req, options) {
  const canonicalUrl = canonicalUrlFor(req, options.path || "/");
  const robotsContent = isPrivateSite ? "noindex, nofollow" : "index, follow";
  const navLinks = publicNavItems
    .map((item) => `<a href="${item.href}" ${options.path === item.href ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`)
    .join("");
  const socialImage = canonicalUrlFor(req, "/icons/icon-512-v2.png");

  const socialMeta = options.includeSocial
    ? `
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(options.title)}">
  <meta property="og:description" content="${escapeHtml(options.description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${socialImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(options.title)}">
  <meta name="twitter:description" content="${escapeHtml(options.description)}">
  <meta name="twitter:image" content="${socialImage}">
`
    : "";

  const jsonLd = options.includeJsonLd
    ? (() => {
        const data = {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              name: "Bradley Kennedy's Medication Tracker",
              url: canonicalUrlFor(req, "/"),
              description: "A personal tool for tracking medications, doses, and wellbeing trends."
            },
            {
              "@type": "SoftwareApplication",
              name: "Medication Tracker",
              applicationCategory: "HealthApplication",
              operatingSystem: "Web",
              url: publicAppUrl,
              description: "Track medications, doses, and wellbeing trends."
            }
          ]
        };
        return `\n  <script type="application/ld+json">${JSON.stringify(data)}</script>`;
      })()
    : "";

  const headScripts = options.includeLandingCompat ? `\n  <script src="/landing-compat.js" defer></script>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}">
  <meta name="robots" content="${robotsContent}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="icon" type="image/svg+xml" href="/site-icon.svg">
  <link rel="stylesheet" href="/assets/site.css">
${socialMeta}${jsonLd}${headScripts}
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header" role="banner">
    <div class="container site-header-inner">
      <a class="site-logo" href="/" aria-label="Medication Tracker home">Medication Tracker</a>
      <nav class="site-nav" aria-label="Primary">
        ${navLinks}
      </nav>
    </div>
  </header>
  <main id="main-content" class="site-main" tabindex="-1">
    <section class="container content-shell">
      ${options.contentHtml}
    </section>
  </main>
  <footer class="site-footer" role="contentinfo">
    <div class="container">
      <p>This tool supports tracking and clinician discussion. It does not replace professional medical advice.</p>
    </div>
  </footer>
</body>
</html>`;
}

function renderLandingHtml(req) {
  return renderPublicLayout(req, {
    path: "/",
    title: "Bradley Kennedy's Medication Tracker - Daily Health Management",
    description: "A personal tool for tracking medications, doses, and wellbeing trends.",
    includeSocial: true,
    includeJsonLd: true,
    includeLandingCompat: true,
    contentHtml: `
      <article class="hero-card" aria-labelledby="hero-title">
        <h1 id="hero-title">Medication Tracker</h1>
        <p class="lead">Shared-care medication tracking for personal consistency and psychiatrist review.</p>
        <div class="cta-row">
          <a class="button button-primary" href="${escapeHtml(publicAppUrl)}" aria-label="Open the Medication Tracker app">Open Medication Tracker App</a>
          <a class="button button-secondary" href="${escapeHtml(`${publicAppUrl}#consult`)}" aria-label="Open consult summary">Go to Consult Summary</a>
        </div>
        <div class="feature-grid" aria-label="Feature highlights">
          <article class="feature-card"><h2>Dose tracking</h2><p>Log taken, skipped, and snoozed doses with timestamps.</p></article>
          <article class="feature-card"><h2>Quick check-ins</h2><p>Capture mood, anxiety, focus, sleep, and side effects fast.</p></article>
          <article class="feature-card"><h2>Consult-ready summaries</h2><p>Review medication changes, trends, and open questions before appointments.</p></article>
        </div>
      </article>
    `
  });
}

function renderPublicInfoPage(req, options) {
  const sections = options.sections
    .map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></section>`)
    .join("");
  return renderPublicLayout(req, {
    path: options.path,
    title: options.title,
    description: options.description,
    contentHtml: `
      <article class="info-card" aria-labelledby="page-title">
        <h1 id="page-title">${escapeHtml(options.heading)}</h1>
        <p class="lead">${escapeHtml(options.description)}</p>
        ${sections}
      </article>
    `
  });
}

async function getIndexTemplate() {
  if (indexTemplateCache) return indexTemplateCache;
  try {
    indexTemplateCache = await readFile(path.join(projectRoot, "app", "index.html"), "utf8");
  } catch {
    indexTemplateCache = await readFile(path.join(projectRoot, "index.html"), "utf8");
  }
  return indexTemplateCache;
}

async function renderIndexHtml(req, options = {}) {
  const template = await getIndexTemplate();
  const canonicalUrl = canonicalUrlFor(req, options.canonicalPath || "/");
  const robotsContent = String(
    options.robotsContent
      || (isPrivateSite ? "noindex, nofollow" : "index, follow")
  );
  return template
    .replace(/<meta name="robots" content="[^"]*">/i, `<meta name="robots" content="${robotsContent}">`)
    .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${canonicalUrl}">`)
    .replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${canonicalUrl}">`)
    .replace(/"url":\s*"[^"]*"/i, `"url": "${canonicalUrl}"`);
}

function accountIdFrom(req) {
  return String(req.header("x-account-id") || "default").trim() || "default";
}

function ownerAuthorizedByLegacyKey(req) {
  if (!allowLegacyOwnerKey) return false;
  if (!ownerKey) return false;
  return String(req.header("x-owner-key") || "") === ownerKey;
}

function parseBearerToken(req) {
  const raw = String(req.header("authorization") || "").trim();
  if (!raw.toLowerCase().startsWith("bearer ")) return "";
  return raw.slice(7).trim();
}

function plusDays(baseIso, days) {
  const base = new Date(baseIso || Date.now());
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

function isExpired(isoString) {
  if (!isoString) return false;
  const ts = new Date(isoString).getTime();
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

function shouldWriteMemberAudit(account, action, actor) {
  addAuditEvent(account, {
    action,
    actorUserId: actor?.userId || "",
    actorRole: actor?.role || "",
    metadata: actor?.metadata || {}
  });
}

async function readStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (_error) {
    return createEmptyStore();
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

function createSession(store, { userId, accountId, role }) {
  const issuedAt = nowIso();
  const token = createOpaqueToken(32);
  const tokenHash = hashOpaqueToken(token);
  const session = {
    id: randomUUID(),
    tokenHash,
    userId,
    accountId,
    role: normalizeRole(role),
    createdAt: issuedAt,
    lastSeenAt: issuedAt,
    expiresAt: plusDays(issuedAt, Math.max(1, sessionTtlDays)),
    revokedAt: ""
  };
  store.sessions[tokenHash] = session;
  return { token, session };
}

function cleanupSessions(store) {
  for (const [tokenHash, session] of Object.entries(store.sessions || {})) {
    if (!session || typeof session !== "object") {
      delete store.sessions[tokenHash];
      continue;
    }
    if (session.revokedAt) {
      delete store.sessions[tokenHash];
      continue;
    }
    if (isExpired(session.expiresAt)) {
      delete store.sessions[tokenHash];
    }
  }
}

function sanitizeInvite(invite) {
  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    acceptedByUserId: invite.acceptedByUserId || ""
  };
}

function memberStateFor(account, user) {
  if (!account || !user) return null;
  const member = memberForUser(account, user.id);
  if (!member) return null;
  if (member.status !== "active") return null;
  return member;
}

function accountStateRead(account) {
  return decryptJsonForAccount(account, encryptionKey, account.id);
}

function accountStateWrite(account, state) {
  const encrypted = encryptJsonForAccount(state, encryptionKey, account.id);
  account.state = encrypted.state;
  account.stateCipher = encrypted.stateCipher;
  account.stateEncoding = encrypted.stateEncoding;
  account.updatedAt = nowIso();
}

function authFromStore(req, store) {
  const token = parseBearerToken(req);
  if (!token) return null;
  const tokenHash = hashOpaqueToken(token);
  const session = store.sessions[tokenHash];
  if (!session || session.revokedAt || isExpired(session.expiresAt)) {
    return null;
  }

  const user = store.users[session.userId];
  if (!user) return null;

  const account = ensureAccount(store, session.accountId);
  const member = memberStateFor(account, user);
  if (!member) return null;

  session.lastSeenAt = nowIso();
  member.lastSeenAt = session.lastSeenAt;

  return {
    tokenHash,
    token,
    session,
    user,
    account,
    accountId: account.id,
    role: normalizeRole(member.role),
    userId: user.id
  };
}

function requireSignedIn(auth, res) {
  if (auth) return true;
  res.status(401).json({ error: "Sign in required." });
  return false;
}

function requireOwner(auth, res) {
  if (auth && roleAllowsWrite(auth.role)) return true;
  res.status(403).json({ error: "Owner role required." });
  return false;
}

function canReadState(auth, account, req) {
  if (auth && auth.accountId === account.id) return true;
  if (!accountHasMembers(account)) {
    if (!ownerKey) return true;
    if (ownerAuthorizedByLegacyKey(req)) return true;
  }
  return false;
}

function canWriteState(auth, account, req) {
  if (auth && auth.accountId === account.id && roleAllowsWrite(auth.role)) return true;
  if (!accountHasMembers(account) && ownerAuthorizedByLegacyKey(req)) return true;
  return false;
}

function findInviteByToken(store, token) {
  const tokenHash = hashOpaqueToken(token);
  for (const [accountId, account] of Object.entries(store.accounts || {})) {
    for (const invite of listInvites(account)) {
      if (invite.tokenHash !== tokenHash) continue;
      return { accountId, account, invite };
    }
  }
  return null;
}

function listAccountUsers(store, account) {
  return listMembers(account)
    .map((member) => {
      const user = store.users[member.userId];
      if (!user) return null;
      return {
        user: sanitizeUser(user),
        role: normalizeRole(member.role),
        status: member.status,
        invitedBy: member.invitedBy,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        lastSeenAt: member.lastSeenAt || ""
      };
    })
    .filter(Boolean);
}

app.get("/api/health", async (_req, res) => {
  const store = await readStore();
  const accountCount = Object.keys(store.accounts || {}).length;
  const userCount = Object.keys(store.users || {}).length;
  res.json({
    ok: true,
    now: nowIso(),
    accountCount,
    userCount,
    encryptionEnabled: Boolean(encryptionKey),
    authEnabled: true
  });
});

app.get("/api/public-config", (_req, res) => {
  res.json({
    ok: true,
    siteVisibility: isPrivateSite ? "private" : "public",
    robotsMeta: isPrivateSite ? "noindex, nofollow" : "index, follow"
  });
});

app.post("/api/auth/register-owner", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim() || "Owner";
  const accountId = String(req.body?.accountId || accountIdFrom(req)).trim() || "default";

  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }
  if (!passwordMeetsMinimum(password)) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const existingUser = findUserByEmail(store, email);
  if (existingUser) {
    res.status(409).json({ error: "This email already exists. Use sign in." });
    return;
  }

  const account = ensureAccount(store, accountId);
  const hasOwner = listMembers(account).some((member) => normalizeRole(member.role) === "owner" && member.status === "active");
  if (hasOwner) {
    res.status(409).json({ error: "Owner already exists for this account. Use sign in." });
    return;
  }

  const userId = randomUUID();
  const timestamp = nowIso();
  store.users[userId] = {
    id: userId,
    email,
    name,
    passwordHash: hashPassword(password),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: timestamp
  };

  account.members[userId] = {
    userId,
    email,
    name,
    role: "owner",
    status: "active",
    invitedBy: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp
  };

  const { token } = createSession(store, {
    userId,
    accountId,
    role: "owner"
  });

  shouldWriteMemberAudit(account, "auth.register_owner", {
    userId,
    role: "owner",
    metadata: { email }
  });

  await writeStore(store);
  res.json({
    ok: true,
    token,
    accountId,
    role: "owner",
    user: sanitizeUser(store.users[userId])
  });
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const preferredAccountId = String(req.body?.accountId || "").trim();

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const user = findUserByEmail(store, email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const accountCandidates = Object.entries(store.accounts || {})
    .map(([accountId, account]) => ({ accountId, account, member: memberStateFor(account, user) }))
    .filter((entry) => entry.member);

  if (!accountCandidates.length) {
    res.status(403).json({ error: "This user is not a member of any account." });
    return;
  }

  const selected = preferredAccountId
    ? accountCandidates.find((entry) => entry.accountId === preferredAccountId)
    : accountCandidates[0];

  if (!selected) {
    res.status(403).json({ error: "No active membership for that account." });
    return;
  }

  user.lastLoginAt = nowIso();
  user.updatedAt = user.lastLoginAt;

  const { token } = createSession(store, {
    userId: user.id,
    accountId: selected.accountId,
    role: selected.member.role
  });

  shouldWriteMemberAudit(selected.account, "auth.login", {
    userId: user.id,
    role: selected.member.role,
    metadata: { email }
  });

  await writeStore(store);
  res.json({
    ok: true,
    token,
    accountId: selected.accountId,
    role: normalizeRole(selected.member.role),
    user: sanitizeUser(user)
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireSignedIn(auth, res)) return;

  const session = store.sessions[auth.tokenHash];
  if (session) {
    session.revokedAt = nowIso();
  }

  shouldWriteMemberAudit(auth.account, "auth.logout", {
    userId: auth.userId,
    role: auth.role
  });

  await writeStore(store);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireSignedIn(auth, res)) return;

  await writeStore(store);
  res.json({
    ok: true,
    accountId: auth.accountId,
    role: auth.role,
    user: sanitizeUser(auth.user),
    members: listAccountUsers(store, auth.account)
  });
});

app.post("/api/auth/invites", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireOwner(auth, res)) return;

  const email = normalizeEmail(req.body?.email);
  const name = String(req.body?.name || "").trim() || "Shared user";
  const role = normalizeRole(req.body?.role || "viewer");
  const expiresAtInput = String(req.body?.expiresAt || "").trim();

  if (!["viewer", "family", "clinician"].includes(role)) {
    res.status(400).json({ error: "Invite role must be viewer, family, or clinician." });
    return;
  }

  if (!email) {
    res.status(400).json({ error: "Invite email is required." });
    return;
  }

  const now = nowIso();
  const expiresAt = expiresAtInput || plusDays(now, Math.max(1, inviteTtlDays));
  const inviteToken = createOpaqueToken(28);
  const invite = {
    id: randomUUID(),
    tokenHash: hashOpaqueToken(inviteToken),
    email,
    name,
    role,
    createdBy: auth.userId,
    createdAt: now,
    expiresAt,
    acceptedAt: "",
    acceptedByUserId: "",
    revokedAt: ""
  };

  auth.account.invites[invite.id] = invite;

  shouldWriteMemberAudit(auth.account, "invite.created", {
    userId: auth.userId,
    role: auth.role,
    metadata: { inviteId: invite.id, role, email }
  });

  await writeStore(store);

  res.json({
    ok: true,
    invite: sanitizeInvite(invite),
    inviteToken,
    inviteUrl: `${req.protocol}://${req.get("host")}/#invite=${encodeURIComponent(inviteToken)}`
  });
});

app.get("/api/auth/invites", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireOwner(auth, res)) return;

  const invites = listInvites(auth.account)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(sanitizeInvite);

  await writeStore(store);
  res.json({ ok: true, invites });
});

app.post("/api/auth/invites/revoke", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireOwner(auth, res)) return;

  const inviteId = String(req.body?.inviteId || "").trim();
  const invite = auth.account.invites[inviteId];
  if (!invite) {
    res.status(404).json({ error: "Invite not found." });
    return;
  }

  invite.revokedAt = nowIso();
  shouldWriteMemberAudit(auth.account, "invite.revoked", {
    userId: auth.userId,
    role: auth.role,
    metadata: { inviteId }
  });

  await writeStore(store);
  res.json({ ok: true, invite: sanitizeInvite(invite) });
});

app.post("/api/auth/invites/inspect", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "Invite token is required." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const match = findInviteByToken(store, token);
  if (!match) {
    res.status(404).json({ error: "Invite not found." });
    return;
  }

  const invite = match.invite;
  const isInvalid = invite.revokedAt || invite.acceptedAt || isExpired(invite.expiresAt);
  res.json({
    ok: true,
    invite: {
      ...sanitizeInvite(invite),
      status: invite.revokedAt
        ? "revoked"
        : invite.acceptedAt
          ? "accepted"
          : isExpired(invite.expiresAt)
            ? "expired"
            : "pending"
    },
    valid: !isInvalid
  });
});

app.post("/api/auth/invites/accept", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");
  const fallbackName = String(req.body?.name || "").trim();

  if (!token) {
    res.status(400).json({ error: "Invite token is required." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const match = findInviteByToken(store, token);
  if (!match) {
    res.status(404).json({ error: "Invite not found." });
    return;
  }

  const invite = match.invite;
  if (invite.revokedAt) {
    res.status(410).json({ error: "Invite has been revoked." });
    return;
  }
  if (invite.acceptedAt) {
    res.status(410).json({ error: "Invite has already been accepted." });
    return;
  }
  if (isExpired(invite.expiresAt)) {
    res.status(410).json({ error: "Invite has expired." });
    return;
  }

  let user = findUserByEmail(store, invite.email);
  const acceptedAt = nowIso();

  if (user) {
    if (!password || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: "Existing account found for this email. Enter its password to accept the invite." });
      return;
    }
    user.lastLoginAt = acceptedAt;
    user.updatedAt = acceptedAt;
  } else {
    if (!passwordMeetsMinimum(password)) {
      res.status(400).json({ error: "Password must be at least 8 characters to create your account." });
      return;
    }
    const userId = randomUUID();
    user = {
      id: userId,
      email: invite.email,
      name: fallbackName || invite.name || "Shared user",
      passwordHash: hashPassword(password),
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
      lastLoginAt: acceptedAt
    };
    store.users[userId] = user;
  }

  match.account.members[user.id] = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: normalizeRole(invite.role),
    status: "active",
    invitedBy: invite.createdBy,
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
    lastSeenAt: acceptedAt
  };

  invite.acceptedAt = acceptedAt;
  invite.acceptedByUserId = user.id;

  const { token: sessionToken } = createSession(store, {
    userId: user.id,
    accountId: match.account.id,
    role: invite.role
  });

  shouldWriteMemberAudit(match.account, "invite.accepted", {
    userId: user.id,
    role: invite.role,
    metadata: { inviteId: invite.id, email: user.email }
  });

  await writeStore(store);
  res.json({
    ok: true,
    token: sessionToken,
    accountId: match.account.id,
    role: normalizeRole(invite.role),
    user: sanitizeUser(user)
  });
});

app.get("/api/state", async (req, res) => {
  const accountHint = accountIdFrom(req);
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  const account = auth ? auth.account : ensureAccount(store, accountHint);

  if (!canReadState(auth, account, req)) {
    res.status(401).json({ error: "Unauthorized for this account." });
    return;
  }

  try {
    const state = accountStateRead(account);
    if (!state) {
      res.status(404).json({ error: "No state stored for this account yet." });
      return;
    }

    if (auth) {
      shouldWriteMemberAudit(account, "state.read", {
        userId: auth.userId,
        role: auth.role
      });
    }

    await writeStore(store);
    res.json({
      accountId: account.id,
      state,
      updatedAt: account.updatedAt || "",
      stateEncoding: account.stateEncoding || "plain"
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not read state." });
  }
});

app.put("/api/state", async (req, res) => {
  const accountHint = accountIdFrom(req);
  const state = req.body?.state;
  if (!state || typeof state !== "object") {
    res.status(400).json({ error: "Request body must include a state object." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  const account = auth ? auth.account : ensureAccount(store, accountHint);

  if (!canWriteState(auth, account, req)) {
    res.status(401).json({ error: "Unauthorized to update this account." });
    return;
  }

  accountStateWrite(account, state);

  shouldWriteMemberAudit(account, "state.write", {
    userId: auth?.userId || "",
    role: auth?.role || "legacy_owner_key",
    metadata: {
      stateEncoding: account.stateEncoding,
      payloadVersion: Number(state?.version || 0)
    }
  });

  await writeStore(store);
  res.json({ ok: true, accountId: account.id, updatedAt: account.updatedAt, stateEncoding: account.stateEncoding });
});

app.post("/api/share-access", async (req, res) => {
  const accountHint = accountIdFrom(req);
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  const account = auth ? auth.account : ensureAccount(store, accountHint);

  const current = account.shareAccess[token] || { opens: 0, lastOpenedAt: "" };
  current.opens += 1;
  current.lastOpenedAt = String(req.body?.openedAt || nowIso());
  account.shareAccess[token] = current;

  if (auth) {
    shouldWriteMemberAudit(account, "share.access_log", {
      userId: auth.userId,
      role: auth.role,
      metadata: { token }
    });
  }

  await writeStore(store);
  res.json({ ok: true, token, ...current });
});

app.get("/api/share-access", async (req, res) => {
  const accountHint = accountIdFrom(req);
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  const account = auth ? auth.account : ensureAccount(store, accountHint);

  if (!canWriteState(auth, account, req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await writeStore(store);
  res.json({ ok: true, accountId: account.id, shareAccess: account.shareAccess || {} });
});

app.post("/api/notifications/risk", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireSignedIn(auth, res)) return;

  const level = String(req.body?.level || "watch").toLowerCase();
  const reasons = Array.isArray(req.body?.reasons)
    ? req.body.reasons.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  const notification = addNotification(auth.account, {
    type: "risk",
    level,
    message: `Risk status is ${level.toUpperCase()}`,
    metadata: {
      reasons: reasons.slice(0, 8),
      triggeredAt: String(req.body?.triggeredAt || nowIso())
    }
  });

  shouldWriteMemberAudit(auth.account, "risk.notification", {
    userId: auth.userId,
    role: auth.role,
    metadata: { level, reasons: reasons.slice(0, 3) }
  });

  await writeStore(store);
  res.json({ ok: true, notification });
});

app.get("/api/notifications", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireSignedIn(auth, res)) return;

  const notifications = (auth.account.notifications || [])
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 100);

  await writeStore(store);
  res.json({ ok: true, notifications });
});

app.get("/api/audit", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireSignedIn(auth, res)) return;

  if (!roleAllowsAuditRead(auth.role)) {
    res.status(403).json({ error: "Audit log access requires owner or clinician role." });
    return;
  }

  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 60)));
  const audit = (auth.account.audit || [])
    .slice()
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, limit);

  await writeStore(store);
  res.json({ ok: true, audit });
});

app.get("/", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  res.type("html").send(renderLandingHtml(req));
});

app.get("/about", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/about",
    title: "About - Bradley Kennedy's Medication Tracker",
    heading: "About Medication Tracker",
    description: "Built for treatment continuity, clinician review, and practical daily tracking.",
    sections: [
      {
        title: "Purpose",
        body: "Medication Tracker helps record doses, symptom check-ins, and medication changes in one place."
      },
      {
        title: "Who it is for",
        body: "This website is designed for personal use with optional read-only sharing for psychiatrist review."
      },
      {
        title: "How it supports appointments",
        body: "Consult summaries surface current medications, recent changes, trends, and open questions before each appointment."
      }
    ]
  }));
});

app.get("/contact", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/contact",
    title: "Contact - Bradley Kennedy's Medication Tracker",
    heading: "Contact",
    description: "Questions or issues with the website can be raised through the maintainer contact route.",
    sections: [
      {
        title: "General enquiries",
        body: "For website updates or access issues, contact Bradley Kennedy directly."
      },
      {
        title: "Clinical communication",
        body: "Medication decisions should be discussed directly with your psychiatrist or prescribing clinician."
      },
      {
        title: "Urgent concerns",
        body: "Do not use this website for emergencies. Contact local emergency services for urgent medical concerns."
      }
    ]
  }));
});

app.get("/privacy", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/privacy",
    title: "Privacy Policy - Medication Tracker",
    heading: "Privacy policy",
    description: "How data is handled in Medication Tracker.",
    sections: [
      {
        title: "Data storage",
        body: "Medication and wellbeing entries are stored for continuity and consult review. Storage can be local-only or synced depending on app settings."
      },
      {
        title: "Sharing",
        body: "Shared links are read-only and can be revoked by the owner. Access logging may include open count and last-opened time."
      },
      {
        title: "Medical disclaimer",
        body: "Medication Tracker supports documentation and discussion with your prescriber. It does not provide diagnosis or treatment instructions."
      }
    ]
  }));
});

app.get("/terms", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/terms",
    title: "Terms of Use - Medication Tracker",
    heading: "Terms of use",
    description: "Usage terms for the Medication Tracker web app.",
    sections: [
      {
        title: "Intended use",
        body: "This app is intended for personal tracking and clinician review support."
      },
      {
        title: "Account responsibility",
        body: "Users are responsible for keeping access credentials and shared links secure."
      },
      {
        title: "No emergency service",
        body: "The app is not an emergency response tool. For urgent concerns, contact local emergency services or your care provider."
      }
    ]
  }));
});

app.get("/robots.txt", (req, res) => {
  const siteUrl = resolveSiteUrl(req);
  const body = isPrivateSite
    ? [
        "User-agent: *",
        "Disallow: /",
        `Sitemap: ${siteUrl}/sitemap.xml`
      ].join("\n")
    : [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /app",
        "Disallow: /app/",
        "Disallow: /tracker",
        "Disallow: /tracker/",
        "Disallow: /share",
        "Disallow: /*share=*",
        `Sitemap: ${siteUrl}/sitemap.xml`
      ].join("\n");
  res.type("text/plain").send(body);
});

app.get("/sitemap.xml", (req, res) => {
  const now = nowIso().split("T")[0];
  const urls = isPrivateSite ? [publicPages[0]] : publicPages;
  const xmlItems = urls.map((page) => {
    const loc = canonicalUrlFor(req, page.path);
    return `  <url>
    <loc>${loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlItems}
</urlset>`;
  res.type("application/xml").send(xml);
});

async function serveAppShell(req, res) {
  try {
    const html = await renderIndexHtml(req, {
      canonicalPath: "/app",
      robotsContent: "noindex, nofollow"
    });
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", htmlCacheControl);
    res.type("html").send(html);
  } catch {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", htmlCacheControl);
    res.sendFile(path.join(projectRoot, "index.html"));
  }
}

app.get("/app", serveAppShell);
app.get("/app/*", serveAppShell);
app.get("/tracker", serveAppShell);
app.get("/tracker/*", serveAppShell);

app.use(express.static(path.join(projectRoot, "public"), {
  index: false,
  setHeaders: (res, filePath) => {
    const lower = filePath.toLowerCase();
    if (/\.(?:css|js|mjs|map|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf)$/.test(lower)) {
      res.setHeader("Cache-Control", staticAssetCacheControl);
    } else {
      res.setHeader("Cache-Control", shortAssetCacheControl);
    }
  }
}));

app.use(express.static(projectRoot, {
  index: false,
  setHeaders: (res, filePath) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith("/index.html") || lower.endsWith(".html")) {
      res.setHeader("Cache-Control", htmlCacheControl);
      return;
    }
    if (lower.endsWith("/sw.js") || lower.endsWith("/manifest.webmanifest")) {
      res.setHeader("Cache-Control", shortAssetCacheControl);
      return;
    }
    if (/\.(?:css|js|mjs|map|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf)$/.test(lower)) {
      res.setHeader("Cache-Control", staticAssetCacheControl);
    }
  }
}));

app.get("*", async (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await serveAppShell(req, res);
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Medication Tracker server running on http://127.0.0.1:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Auth enabled: true · Encryption at rest: ${encryptionKey ? "enabled" : "disabled"}`);
});
