import { getStore } from "@netlify/blobs";
import express from "express";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  fetch as undiciFetch,
  Headers as UndiciHeaders,
  Request as UndiciRequest,
  Response as UndiciResponse
} from "undici";
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
  addAuditEvent,
  addNotification,
  createEmptyStore,
  ensureAccount,
  findPasswordResetByHash,
  findUserByEmail,
  listInvites,
  listMembers,
  listShares,
  memberForUser,
  normalizeStore,
  nowIso
} from "./lib/store-model.js";

if (typeof globalThis.fetch !== "function") {
  globalThis.fetch = undiciFetch;
}
if (typeof globalThis.Headers !== "function") {
  globalThis.Headers = UndiciHeaders;
}
if (typeof globalThis.Request !== "function") {
  globalThis.Request = UndiciRequest;
}
if (typeof globalThis.Response !== "function") {
  globalThis.Response = UndiciResponse;
}

const projectRoot = path.resolve(process.cwd());
const moduleFilename = path.join(projectRoot, "server", "server.js");
const moduleDirname = path.dirname(moduleFilename);
const dataDir = process.env.MT_DATA_DIR
  ? path.resolve(process.env.MT_DATA_DIR)
  : path.join(moduleDirname, "data");
const storePath = path.join(dataDir, "store.json");
const isNetlifyRuntime = [
  process.env.NETLIFY,
  process.env.NETLIFY_LOCAL,
  process.env.SITE_ID,
  process.env.CONTEXT
].some((value) => String(value || "").trim());
const allowNetlifyFileFallback = String(process.env.NETLIFY_LOCAL || "").toLowerCase() === "true";
const blobStoreKey = "store.json";
const blobStoreName = String(process.env.MT_BLOBS_NAME || "adhdagenda-data").trim() || "adhdagenda-data";
const blobStoreSiteId = String(process.env.MT_BLOBS_SITE_ID || process.env.SITE_ID || "").trim();
const blobStoreToken = String(process.env.MT_BLOBS_TOKEN || "").trim();
let blobStore = null;
let blobStoreResolved = false;

function getBlobStore() {
  if (!isNetlifyRuntime) return null;
  if (blobStoreResolved) return blobStore;
  blobStoreResolved = true;
  try {
    const options = {
      name: blobStoreName,
      consistency: "strong"
    };
    if (blobStoreSiteId) {
      options.siteID = blobStoreSiteId;
    }
    if (blobStoreToken) {
      options.token = blobStoreToken;
    }
    blobStore = getStore(options);
  } catch (error) {
    if (!allowNetlifyFileFallback) throw error;
    blobStore = null;
  }
  return blobStore;
}

const port = Number(process.env.PORT || 8080);
const encryptionKey = String(process.env.MT_ENCRYPTION_KEY || "");
const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const sessionTtlDays = Number(process.env.MT_SESSION_TTL_DAYS || 30);
const inviteTtlDays = Number(process.env.MT_INVITE_TTL_DAYS || 14);
const passwordResetTtlHours = Number(process.env.MT_PASSWORD_RESET_TTL_HOURS || 1);
const exposeResetLinks = String(process.env.MT_EXPOSE_RESET_LINKS || "").toLowerCase() === "true";
const sessionCookieName = String(process.env.MT_SESSION_COOKIE_NAME || "mt_session").trim() || "mt_session";
const sessionCookieSameSite = ["strict", "lax", "none"].includes(String(process.env.MT_SESSION_COOKIE_SAMESITE || "").toLowerCase())
  ? String(process.env.MT_SESSION_COOKIE_SAMESITE || "").toLowerCase()
  : "lax";
const siteVisibility = String(
  process.env.MT_SITE_VISIBILITY
    || (String(process.env.MT_PRIVATE_SITE || "").toLowerCase() === "false" ? "public" : "private")
).trim().toLowerCase();
const isPrivateSite = !["public", "indexable"].includes(siteVisibility);
const configuredSiteUrl = String(process.env.MT_SITE_URL || "").trim().replace(/\/+$/, "");
const configuredAppUrl = String(process.env.MT_APP_URL || "").trim().replace(/\/+$/, "");
const publicAppUrl = configuredAppUrl || "/app";
const publicAppUrlWithTrailingSlash = publicAppUrl.endsWith("/") ? publicAppUrl : `${publicAppUrl}/`;
const corsOrigins = String(process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAnyCorsOrigin = !corsOrigins.length || corsOrigins.includes("*");

if (isProduction && !encryptionKey) {
  throw new Error("MT_ENCRYPTION_KEY is required in production. Refusing insecure startup.");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "8mb" }));

let indexTemplateCache = "";

const publicPages = Object.freeze([
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/about/", changefreq: "monthly", priority: "0.7" },
  { path: "/contact/", changefreq: "monthly", priority: "0.7" },
  { path: "/privacy/", changefreq: "monthly", priority: "0.6" },
  { path: "/terms/", changefreq: "monthly", priority: "0.6" }
]);
const publicPageFiles = Object.freeze({
  home: path.join(projectRoot, "index.html"),
  about: path.join(projectRoot, "about", "index.html"),
  contact: path.join(projectRoot, "contact", "index.html"),
  privacy: path.join(projectRoot, "privacy", "index.html"),
  terms: path.join(projectRoot, "terms", "index.html")
});

const canonicalSiteUrl = "https://adhdagenda.com";
const localDevelopmentHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

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

function requestHost(req) {
  return String(req.get("host") || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
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
  const allowedOrigin = requestOrigin
    ? (allowAnyCorsOrigin
        ? requestOrigin
        : (corsOrigins.includes(requestOrigin) ? requestOrigin : ""))
    : "";
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    appendVaryHeader(res, "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-account-id");
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
  const host = requestHost(req);
  if (localDevelopmentHosts.has(host)) {
    return `${req.protocol}://${req.get("host")}`;
  }
  return canonicalSiteUrl;
}

function resolveAppBaseUrl(req) {
  if (configuredAppUrl) return configuredAppUrl;
  return canonicalUrlFor(req, publicAppUrlWithTrailingSlash).replace(/\/+$/, "");
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

function sendPublicPage(res, filePath) {
  res.setHeader("Cache-Control", htmlCacheControl);
  return res.sendFile(filePath);
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

function requestedAccountIdFrom(req) {
  return String(req.header("x-account-id") || "").trim();
}

function createAccountId() {
  return `acct_${createOpaqueToken(12)}`;
}

function plusDays(baseIso, days) {
  const base = new Date(baseIso || Date.now());
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

function plusHours(baseIso, hours) {
  const base = new Date(baseIso || Date.now());
  base.setHours(base.getHours() + hours);
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

function accountOwnerUserId(account) {
  return listMembers(account).find((member) => normalizeRole(member.role) === "owner" && member.status === "active")?.userId || "";
}

function sanitizeShare(req, share, rawToken = "") {
  const safeToken = String(rawToken || "").trim();
  return {
    id: share.id,
    name: share.name,
    email: share.email,
    role: share.role,
    preset: share.preset,
    permissions: share.permissions || {},
    allowedModes: Array.isArray(share.allowedModes) ? share.allowedModes : [],
    startSection: share.startSection || "dashboard",
    createdAt: share.createdAt,
    createdByUserId: share.createdByUserId,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    lastOpenedAt: share.lastOpenedAt || "",
    totalOpens: Number(share.opens || 0),
    url: safeToken
      ? `${resolveAppBaseUrl(req)}#share_token=${encodeURIComponent(safeToken)}`
      : "",
    urlAvailable: Boolean(safeToken)
  };
}

function isHttpsRequest(req) {
  return req.secure || String(req.header("x-forwarded-proto") || "").toLowerCase() === "https";
}

function normalizedOriginFor(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.origin.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function requestOriginFor(req) {
  return normalizedOriginFor(req.header("origin"));
}

function requestHostOriginFor(req) {
  const protocol = isHttpsRequest(req) ? "https" : "http";
  const host = String(req.get("host") || "").trim().toLowerCase();
  if (!host) return "";
  return `${protocol}://${host}`;
}

function effectiveSessionCookieSameSite(req) {
  if (sessionCookieSameSite === "none") return "none";
  const requestOrigin = requestOriginFor(req);
  const hostOrigin = requestHostOriginFor(req);
  if (requestOrigin && hostOrigin && requestOrigin !== hostOrigin) {
    return "none";
  }
  return sessionCookieSameSite;
}

function sessionCookieSecure(req) {
  return isProduction || effectiveSessionCookieSameSite(req) === "none" || isHttpsRequest(req);
}

function parseCookieHeader(req) {
  const raw = String(req.header("cookie") || "");
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) return acc;
      const key = pair.slice(0, eqIndex).trim();
      const value = pair.slice(eqIndex + 1).trim();
      if (key) acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function sessionTokenFromCookie(req) {
  return String(parseCookieHeader(req)[sessionCookieName] || "").trim();
}

function setSessionCookie(req, res, token, expiresAt) {
  const sameSite = effectiveSessionCookieSameSite(req);
  const cookieParts = [
    `${sessionCookieName}=${encodeURIComponent(String(token || ""))}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`
  ];
  if (sessionCookieSecure(req)) {
    cookieParts.push("Secure");
  }
  if (expiresAt) {
    cookieParts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  }
  res.append("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(req, res) {
  const sameSite = effectiveSessionCookieSameSite(req);
  const cookieParts = [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`
  ];
  if (sessionCookieSecure(req)) {
    cookieParts.push("Secure");
  }
  res.append("Set-Cookie", cookieParts.join("; "));
}

function cleanupPasswordResets(store) {
  for (const [resetId, reset] of Object.entries(store.passwordResets || {})) {
    if (!reset || typeof reset !== "object") {
      delete store.passwordResets[resetId];
      continue;
    }
    if (reset.consumedAt || isExpired(reset.expiresAt)) {
      delete store.passwordResets[resetId];
    }
  }
}

function revokeUserSessions(store, userId) {
  const target = String(userId || "");
  for (const session of Object.values(store.sessions || {})) {
    if (!session || session.userId !== target) continue;
    session.revokedAt = nowIso();
  }
}

function findShareByToken(store, token) {
  const target = String(token || "").trim();
  if (!target) return null;
  const tokenHash = hashOpaqueToken(target);
  for (const [accountId, account] of Object.entries(store.accounts || {})) {
    for (const share of listShares(account)) {
      if (String(share.tokenHash || "") !== tokenHash) continue;
      return { accountId, account, share };
    }
  }
  return null;
}

function enforceStateOwnership(inputState, auth, account) {
  const state = JSON.parse(JSON.stringify(inputState || {}));
  const actorUserId = String(auth?.userId || "");
  const ownerUserId = accountOwnerUserId(account) || actorUserId;
  const stamp = (row) => {
    if (!row || typeof row !== "object") return row;
    const createdAt = String(row.createdAt || nowIso());
    return {
      ...row,
      accountId: account.id,
      ownerUserId,
      createdByUserId: String(row.createdByUserId || actorUserId || ownerUserId),
      updatedByUserId: String(actorUserId || row.updatedByUserId || ownerUserId),
      createdAt,
      updatedAt: String(row.updatedAt || nowIso())
    };
  };

  for (const key of [
    "medications",
    "changes",
    "notes",
    "checkins",
    "adherence",
    "doseSnoozes",
    "medicationChangeExperiments",
    "consultQuestions",
    "decisionLog",
    "sideEffectEvents",
    "appointmentEvents"
  ]) {
    state[key] = Array.isArray(state[key]) ? state[key].map(stamp) : [];
  }

  state.accountId = account.id;
  state.ownerUserId = ownerUserId;
  state.updatedByUserId = String(actorUserId || ownerUserId);
  if (!Array.isArray(state.shareLinks)) {
    state.shareLinks = [];
  }
  return state;
}

const SENSITIVE_TAG_KEYWORDS = ["sensitive", "journal", "libido", "sexual", "substance", "private"];

function filterStateForShare(inputState, share) {
  const state = JSON.parse(JSON.stringify(inputState || {}));
  const permissions = share?.permissions && typeof share.permissions === "object" ? share.permissions : {};
  const canSeeSensitiveNotes = permissions.showSensitiveNotes === true;
  const canSeeSensitiveTags = permissions.showSensitiveTags === true;
  const canSeeJournalText = permissions.showJournalText === true;
  const canSeeLibido = permissions.showLibido === true;
  const canSeeSubstance = permissions.showSubstance === true;
  const canSeeFreeText = permissions.showFreeText === true;

  state.notes = Array.isArray(state.notes) ? state.notes.map((note) => {
    const next = { ...note };
    if (!canSeeSensitiveTags) {
      next.tags = Array.isArray(next.tags)
        ? next.tags.filter((tag) => !SENSITIVE_TAG_KEYWORDS.some((keyword) => String(tag || "").toLowerCase().includes(keyword)))
        : [];
    }
    if (!canSeeSensitiveNotes && next.isSensitive) {
      next.noteText = "";
      next.trainingNotes = "";
      next.checklist = [];
    }
    if (!canSeeJournalText && String(next.noteType || "").toLowerCase() === "journal") {
      next.noteText = "";
      next.trainingNotes = "";
    }
    if (!canSeeLibido && /libido|sexual/i.test(String(next.noteText || ""))) {
      next.noteText = "";
    }
    if (!canSeeSubstance && /substance|alcohol|drug/i.test(String(next.noteText || ""))) {
      next.noteText = "";
    }
    if (!canSeeFreeText && String(next.noteType || "").toLowerCase() === "free_text") {
      next.noteText = "";
      next.trainingNotes = "";
    }
    return next;
  }) : [];

  state.shareLinks = [];
  return state;
}

async function readStore() {
  const persistentStore = getBlobStore();
  if (persistentStore) {
    try {
      const stored = await persistentStore.get(blobStoreKey, { type: "json" });
      return stored ? normalizeStore(stored) : createEmptyStore();
    } catch (error) {
      if (!allowNetlifyFileFallback) throw error;
    }
  }
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (_error) {
    return createEmptyStore();
  }
}

async function writeStore(store) {
  const persistentStore = getBlobStore();
  if (persistentStore) {
    try {
      await persistentStore.setJSON(blobStoreKey, normalizeStore(store));
      return;
    } catch (error) {
      if (!allowNetlifyFileFallback) throw error;
    }
  }
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

const rateLimitBuckets = new Map();

function clientIpKey(req) {
  return String(req.ip || req.header("x-forwarded-for") || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim()
    .toLowerCase();
}

function consumeRateLimit({ req, scope, max, windowMs, discriminator = "" }) {
  const key = `${scope}:${clientIpKey(req)}:${String(discriminator || "").trim().toLowerCase()}`;
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (bucket.count > max) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

function enforceRateLimit(req, res, options) {
  const result = consumeRateLimit(options);
  if (!result.limited) return true;
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({
    error: options.message || "Too many attempts. Please wait and try again."
  });
  return false;
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
  cleanupPasswordResets(store);
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
  const token = sessionTokenFromCookie(req);
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

function requireMatchingAccountContext(auth, req, res) {
  const requestedAccountId = requestedAccountIdFrom(req);
  if (!auth || !requestedAccountId) return true;
  if (requestedAccountId === auth.accountId) return true;
  res.status(409).json({ error: "Authenticated session does not match the requested account." });
  return false;
}

function requireOwner(auth, res) {
  if (auth && roleAllowsWrite(auth.role)) return true;
  res.status(403).json({ error: "Owner role required." });
  return false;
}

function canReadState(auth, account, req) {
  if (auth && auth.accountId === account.id) return true;
  return false;
}

function canWriteState(auth, account, req) {
  if (auth && auth.accountId === account.id && roleAllowsWrite(auth.role)) return true;
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

function listUserAccounts(store, user) {
  return Object.values(store.accounts || {})
    .map((account) => {
      const member = memberStateFor(account, user);
      if (!member) return null;
      return {
        accountId: account.id,
        role: normalizeRole(member.role),
        accountLabel: member.role === "owner"
          ? (member.name || user.name || user.email || "My tracker")
          : `${member.name || user.name || user.email || "Shared"} workspace`
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

function authResponsePayload(store, accountId, role, user) {
  return {
    ok: true,
    accountId,
    role: normalizeRole(role),
    user: sanitizeUser(user),
    accounts: listUserAccounts(store, user)
  };
}

async function signUpOwner(req, res) {
  if (!enforceRateLimit(req, res, {
    req,
    scope: "auth-sign-up",
    max: 5,
    windowMs: 60 * 60 * 1000,
    discriminator: normalizeEmail(req.body?.email),
    message: "Too many account creation attempts. Please try again later."
  })) return;
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const name = String(req.body?.name || "").trim() || "Owner";

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

  const accountId = createAccountId();
  const account = ensureAccount(store, accountId);
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

  const { token, session } = createSession(store, {
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
  setSessionCookie(req, res, token, session.expiresAt);
  res.json(authResponsePayload(store, accountId, "owner", store.users[userId]));
}

app.post("/api/auth/sign-up", signUpOwner);
app.post("/api/auth/register-owner", signUpOwner);

app.post("/api/auth/login", async (req, res) => {
  if (!enforceRateLimit(req, res, {
    req,
    scope: "auth-login",
    max: 10,
    windowMs: 15 * 60 * 1000,
    discriminator: normalizeEmail(req.body?.email),
    message: "Too many sign-in attempts. Please wait and try again."
  })) return;
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

  const { token, session } = createSession(store, {
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
  setSessionCookie(req, res, token, session.expiresAt);
  res.json(authResponsePayload(store, selected.accountId, selected.member.role, user));
});

app.post("/api/auth/logout", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireSignedIn(auth, res)) return;
  if (!requireMatchingAccountContext(auth, req, res)) return;

  const session = store.sessions[auth.tokenHash];
  if (session) {
    session.revokedAt = nowIso();
  }

  shouldWriteMemberAudit(auth.account, "auth.logout", {
    userId: auth.userId,
    role: auth.role
  });

  await writeStore(store);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!auth) {
    clearSessionCookie(req, res);
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!requireMatchingAccountContext(auth, req, res)) return;

  await writeStore(store);
  res.json({
    ok: true,
    accountId: auth.accountId,
    role: auth.role,
    user: sanitizeUser(auth.user),
    members: listAccountUsers(store, auth.account),
    accounts: listUserAccounts(store, auth.user)
  });
});

app.post("/api/auth/password-reset/request", async (req, res) => {
  if (!enforceRateLimit(req, res, {
    req,
    scope: "password-reset-request",
    max: 5,
    windowMs: 60 * 60 * 1000,
    discriminator: normalizeEmail(req.body?.email),
    message: "Too many reset attempts. Please wait and try again."
  })) return;
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const user = findUserByEmail(store, email);
  if (user) {
    const resetToken = createOpaqueToken(28);
    const tokenHash = hashOpaqueToken(resetToken);
    const accountId = listUserAccounts(store, user)[0]?.accountId || "";
    const resetId = randomUUID();
    store.passwordResets[resetId] = {
      id: resetId,
      tokenHash,
      userId: user.id,
      email: user.email,
      createdAt: nowIso(),
      expiresAt: plusHours(nowIso(), Math.max(1, passwordResetTtlHours)),
      consumedAt: "",
      accountId,
      requestedFromIp: String(req.ip || "")
    };
    await writeStore(store);

    const payload = {
      ok: true,
      message: "If the account exists, a reset link has been prepared."
    };
    if (exposeResetLinks) {
      payload.resetUrl = `${resolveAppBaseUrl(req)}#reset=${encodeURIComponent(resetToken)}`;
    }
    res.json(payload);
    return;
  }

  await writeStore(store);
  res.json({
    ok: true,
    message: "If the account exists, a reset link has been prepared."
  });
});

app.post("/api/auth/password-reset/complete", async (req, res) => {
  if (!enforceRateLimit(req, res, {
    req,
    scope: "password-reset-complete",
    max: 5,
    windowMs: 60 * 60 * 1000,
    discriminator: String(req.body?.token || "").slice(0, 12),
    message: "Too many password reset attempts. Please request a new link."
  })) return;
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");
  if (!token) {
    res.status(400).json({ error: "Reset token is required." });
    return;
  }
  if (!passwordMeetsMinimum(password)) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const reset = findPasswordResetByHash(store, hashOpaqueToken(token));
  if (!reset || reset.consumedAt || isExpired(reset.expiresAt)) {
    res.status(410).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  const user = store.users[reset.userId];
  if (!user) {
    res.status(404).json({ error: "User no longer exists." });
    return;
  }

  user.passwordHash = hashPassword(password);
  user.updatedAt = nowIso();
  reset.consumedAt = nowIso();
  revokeUserSessions(store, user.id);

  await writeStore(store);
  clearSessionCookie(req, res);
  res.json({ ok: true, message: "Password reset complete. You can sign in now." });
});

app.post("/api/auth/invites", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
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
    inviteUrl: `${canonicalUrlFor(req, "/")}#invite=${encodeURIComponent(inviteToken)}`
  });
});

app.get("/api/auth/invites", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
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
  if (!requireMatchingAccountContext(auth, req, res)) return;
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
  if (!enforceRateLimit(req, res, {
    req,
    scope: "invite-accept",
    max: 8,
    windowMs: 60 * 60 * 1000,
    discriminator: String(req.body?.token || "").slice(0, 12),
    message: "Too many invite attempts. Please wait and try again."
  })) return;
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

  const { token: sessionToken, session } = createSession(store, {
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
  setSessionCookie(req, res, sessionToken, session.expiresAt);
  res.json(authResponsePayload(store, match.account.id, invite.role, user));
});

app.get("/api/state", async (req, res) => {
  const accountHint = accountIdFrom(req);
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
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
  if (!requireMatchingAccountContext(auth, req, res)) return;
  const account = auth ? auth.account : ensureAccount(store, accountHint);

  if (!canWriteState(auth, account, req)) {
    res.status(401).json({ error: "Unauthorized to update this account." });
    return;
  }

  const securedState = enforceStateOwnership(state, auth, account);
  accountStateWrite(account, securedState);

  shouldWriteMemberAudit(account, "state.write", {
    userId: auth?.userId || "",
    role: auth?.role || "owner",
    metadata: {
      stateEncoding: account.stateEncoding,
      payloadVersion: Number(state?.version || 0)
    }
  });

  await writeStore(store);
  res.json({ ok: true, accountId: account.id, updatedAt: account.updatedAt, stateEncoding: account.stateEncoding });
});

app.post("/api/account/import-local", async (req, res) => {
  const state = req.body?.state;
  const overwrite = req.body?.overwrite === true;
  if (!state || typeof state !== "object") {
    res.status(400).json({ error: "Request body must include a state object." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
  if (!requireOwner(auth, res)) return;

  const existingState = accountStateRead(auth.account);
  if (existingState && !overwrite) {
    res.json({ ok: true, imported: false, reason: "existing_state" });
    return;
  }

  const securedState = enforceStateOwnership(state, auth, auth.account);
  accountStateWrite(auth.account, securedState);
  shouldWriteMemberAudit(auth.account, "state.import_local", {
    userId: auth.userId,
    role: auth.role,
    metadata: {
      overwrite,
      payloadVersion: Number(state?.version || 0)
    }
  });

  await writeStore(store);
  res.json({ ok: true, imported: true, accountId: auth.accountId, updatedAt: auth.account.updatedAt });
});

app.post("/api/shares", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
  if (!requireOwner(auth, res)) return;

  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const role = normalizeRole(req.body?.role || "viewer");
  const preset = String(req.body?.preset || role || "viewer").trim().toLowerCase();
  const permissions = req.body?.permissions && typeof req.body.permissions === "object" ? req.body.permissions : {};
  const allowedModes = Array.isArray(req.body?.allowedModes)
    ? req.body.allowedModes.map((value) => String(value || "").trim()).filter(Boolean)
    : ["daily"];
  const startSection = String(req.body?.startSection || "dashboard").trim().toLowerCase() === "consult" ? "consult" : "dashboard";
  const expiresAt = String(req.body?.expiresAt || "").trim();

  if (!name) {
    res.status(400).json({ error: "Person name is required." });
    return;
  }
  if (!["viewer", "family", "clinician"].includes(role)) {
    res.status(400).json({ error: "Share role must be viewer, family, or clinician." });
    return;
  }
  if (!allowedModes.length) {
    res.status(400).json({ error: "At least one allowed view is required." });
    return;
  }

  const rawShareToken = createOpaqueToken(28);
  const share = {
    id: randomUUID(),
    tokenHash: hashOpaqueToken(rawShareToken),
    name,
    email,
    role,
    preset,
    permissions,
    allowedModes,
    startSection,
    createdByUserId: auth.userId,
    createdAt: nowIso(),
    expiresAt,
    revokedAt: "",
    lastOpenedAt: "",
    opens: 0
  };

  auth.account.shares[share.id] = share;
  shouldWriteMemberAudit(auth.account, "share.created", {
    userId: auth.userId,
    role: auth.role,
    metadata: {
      shareId: share.id,
      targetRole: role,
      email
    }
  });

  await writeStore(store);
  res.json({ ok: true, share: sanitizeShare(req, share, rawShareToken) });
});

app.get("/api/shares", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
  if (!requireOwner(auth, res)) return;

  const shares = listShares(auth.account)
    .slice()
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .map((share) => sanitizeShare(req, share));

  await writeStore(store);
  res.json({ ok: true, shares });
});

app.post("/api/shares/revoke", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
  if (!requireOwner(auth, res)) return;

  const shareId = String(req.body?.shareId || "").trim();
  const share = auth.account.shares[shareId];
  if (!share) {
    res.status(404).json({ error: "Share link not found." });
    return;
  }

  share.revokedAt = nowIso();
  shouldWriteMemberAudit(auth.account, "share.revoked", {
    userId: auth.userId,
    role: auth.role,
    metadata: { shareId }
  });

  await writeStore(store);
  res.json({ ok: true, share: sanitizeShare(req, share) });
});

app.post("/api/shares/session", async (req, res) => {
  if (!enforceRateLimit(req, res, {
    req,
    scope: "share-session",
    max: 30,
    windowMs: 5 * 60 * 1000,
    discriminator: String(req.body?.token || "").slice(0, 12),
    message: "Too many share link attempts. Please wait and try again."
  })) return;
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "Share token is required." });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);
  const match = findShareByToken(store, token);
  if (!match) {
    res.status(404).json({ error: "Share link not found." });
    return;
  }

  const { account, share } = match;
  if (share.revokedAt) {
    res.status(410).json({ error: "This share link has been revoked." });
    return;
  }
  if (isExpired(share.expiresAt)) {
    res.status(410).json({ error: "This share link has expired." });
    return;
  }

  const state = accountStateRead(account);
  if (!state) {
    res.status(404).json({ error: "No state stored for this account yet." });
    return;
  }

  share.opens = Number(share.opens || 0) + 1;
  share.lastOpenedAt = nowIso();
  shouldWriteMemberAudit(account, "share.read", {
    userId: "",
    role: "share_link",
    metadata: { shareId: share.id }
  });

  await writeStore(store);
  res.json({
    ok: true,
    share: sanitizeShare(req, share),
    state: filterStateForShare(state, share),
    updatedAt: account.updatedAt || ""
  });
});

app.post("/api/share-access", async (req, res) => {
  if (!enforceRateLimit(req, res, {
    req,
    scope: "share-access",
    max: 60,
    windowMs: 5 * 60 * 1000,
    discriminator: String(req.body?.token || "").slice(0, 12),
    message: "Too many share access attempts. Please wait and try again."
  })) return;
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const store = await readStore();
  cleanupSessions(store);

  const shareMatch = findShareByToken(store, token);
  if (shareMatch?.share && !shareMatch.share.revokedAt && !isExpired(shareMatch.share.expiresAt)) {
    shareMatch.share.opens = Number(shareMatch.share.opens || 0) + 1;
    shareMatch.share.lastOpenedAt = String(req.body?.openedAt || nowIso());
    await writeStore(store);
    res.json({
      ok: true,
      shareId: shareMatch.share.id,
      opens: shareMatch.share.opens,
      lastOpenedAt: shareMatch.share.lastOpenedAt
    });
    return;
  }
  res.status(404).json({ error: "Share link not found." });
});

app.get("/api/share-access", async (req, res) => {
  const accountHint = accountIdFrom(req);
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
  const account = auth ? auth.account : ensureAccount(store, accountHint);

  if (!canWriteState(auth, account, req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await writeStore(store);
  const shareAccess = listShares(account).reduce((acc, share) => {
    acc[share.id] = {
      totalOpens: Number(share.opens || 0),
      lastOpenedAt: String(share.lastOpenedAt || "")
    };
    return acc;
  }, {});
  res.json({ ok: true, accountId: account.id, shareAccess });
});

app.post("/api/notifications/risk", async (req, res) => {
  const store = await readStore();
  cleanupSessions(store);
  const auth = authFromStore(req, store);
  if (!requireMatchingAccountContext(auth, req, res)) return;
  if (!requireOwner(auth, res)) return;

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
  if (!requireMatchingAccountContext(auth, req, res)) return;

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
  if (!requireMatchingAccountContext(auth, req, res)) return;

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

app.get("/", (_req, res) => sendPublicPage(res, publicPageFiles.home));
app.get(["/about", "/about/"], (_req, res) => sendPublicPage(res, publicPageFiles.about));
app.get(["/contact", "/contact/"], (_req, res) => sendPublicPage(res, publicPageFiles.contact));
app.get(["/privacy", "/privacy/"], (_req, res) => sendPublicPage(res, publicPageFiles.privacy));
app.get(["/terms", "/terms/"], (_req, res) => sendPublicPage(res, publicPageFiles.terms));

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

app.use(express.static(projectRoot, {
  index: false,
  setHeaders: (res, filePath) => {
    const lower = filePath.toLowerCase();
    if (lower.endsWith("/index.html") || lower.endsWith(".html")) {
      res.setHeader("Cache-Control", htmlCacheControl);
      return;
    }
    if (lower.endsWith("/sw.js")) {
      res.setHeader("Cache-Control", htmlCacheControl);
      return;
    }
    if (lower.endsWith("/manifest.webmanifest")) {
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

export { app };

export function startServer(listenPort = port) {
  return app.listen(listenPort, () => {
    // eslint-disable-next-line no-console
    console.log(`AdhdAgenda server running on http://127.0.0.1:${listenPort}`);
    // eslint-disable-next-line no-console
    console.log(`Auth enabled: true · Encryption at rest: ${encryptionKey ? "enabled" : "disabled"}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFilename) {
  startServer();
}
