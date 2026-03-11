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
      name: "carepanel-data",
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

const publicNavItems = Object.freeze([
  { href: "/", label: "Home" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Contact" }
]);

const publicFooterItems = Object.freeze([
  { href: "/contact/", label: "Contact" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/terms/", label: "Terms" }
]);

const canonicalSiteUrl = "https://adhdagenda.com";
const localDevelopmentHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const htmlCacheControl = "public, max-age=0, must-revalidate";
const staticAssetCacheControl = "public, max-age=604800, stale-while-revalidate=86400";
const shortAssetCacheControl = "public, max-age=86400, stale-while-revalidate=3600";
const ASSET_VERSION = "20260310-domain-cutover-1";

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

function normalizePublicPath(pathname = "/") {
  const safePath = String(pathname || "/").startsWith("/") ? String(pathname || "/") : `/${String(pathname || "/")}`;
  if (safePath === "/") return "/";
  return `${safePath.replace(/\/+$/, "")}/`;
}

function renderPublicLayout(req, options) {
  const canonicalUrl = canonicalUrlFor(req, options.path || "/");
  const robotsContent = isPrivateSite ? "noindex, nofollow" : "index, follow";
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
              name: "CarePanel",
              url: canonicalUrlFor(req, "/"),
              description: "CarePanel is a private medication tracking workspace for daily records, care review, and controlled sharing."
            },
            {
              "@type": "WebPage",
              name: "CarePanel Home",
              url: canonicalUrlFor(req, "/"),
              description: "Private medication tracking for daily continuity and clinician review."
            }
          ]
        };
        return `\n  <script type="application/ld+json">${JSON.stringify(data)}</script>`;
      })()
    : "";

  const headScripts = options.includeLandingCompat ? `\n  <script src="/landing-compat.js" defer></script>` : "";
  const currentPath = normalizePublicPath(options.path || "/");
  const bodyClass = [
    "public-page",
    currentPath === "/" ? "public-page-home" : `public-page-${currentPath.replace(/\//g, " ").trim().replace(/\s+/g, "-") || "default"}`,
    options.bodyClass || ""
  ].filter(Boolean).join(" ");
  const brandMark = `
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12h3l1.8-3.2L12 15l2.3-4 1.4 2.4H20"></path>
            <rect x="6" y="4.5" width="12" height="15" rx="4.5"></rect>
          </svg>
        </span>`;
  const headerNavHtml = `
        <nav class="site-nav" aria-label="Primary">
${publicNavItems
  .map((item) => {
    const isCurrent = normalizePublicPath(item.href) === currentPath;
    return `          <a href="${escapeHtml(item.href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
  })
  .join("\n")}
        </nav>`;
  const footerLinksHtml = `
      <nav class="footer-links" aria-label="Footer">
${publicFooterItems
  .map((item) => {
    const isCurrent = normalizePublicPath(item.href) === currentPath;
    return `        <a href="${escapeHtml(item.href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
  })
  .join("\n")}
      </nav>`;

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
  <script src="/canonical-host.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/site.css?v=${ASSET_VERSION}">
${socialMeta}${jsonLd}${headScripts}
</head>
<body class="${escapeHtml(bodyClass)}">
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header" role="banner">
    <div class="container site-header-inner">
      <a class="brand-lockup" href="/" aria-label="CarePanel home">
${brandMark}
        <span class="brand-copy">
          <span class="brand-title">CarePanel</span>
          <span class="brand-subtitle">Private medication tracking and review</span>
        </span>
      </a>
      <div class="site-header-actions">
${headerNavHtml}
        <a class="button button-secondary button-compact" href="${escapeHtml(publicAppUrlWithTrailingSlash)}">Open Workspace</a>
      </div>
    </div>
  </header>
  <main id="main-content" class="site-main" tabindex="-1">
    <div class="container content-shell">
      ${options.contentHtml}
    </div>
  </main>
  <footer class="site-footer" role="contentinfo">
    <div class="container footer-shell">
      <div class="footer-note">
        <span class="footer-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12h3l1.8-3.2L12 15l2.3-4 1.4 2.4H20"></path>
            <rect x="6" y="4.5" width="12" height="15" rx="4.5"></rect>
          </svg>
        </span>
        <p>CarePanel supports care continuity and clinician discussion. It does not replace professional medical advice.</p>
      </div>
${footerLinksHtml}
    </div>
  </footer>
</body>
</html>`;
}

function renderLandingHtml(req) {
  return renderPublicLayout(req, {
    path: "/",
    title: "CarePanel | Private Medication Tracking and Review",
    description: "CarePanel is a private medication tracking workspace for daily records, care review, and controlled sharing.",
    includeSocial: true,
    includeJsonLd: true,
    includeLandingCompat: true,
    contentHtml: `
      <section class="hero-card hero-card-premium" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">Private medication tracking</p>
          <h1 id="hero-title">Clear daily tracking. Cleaner clinician review.</h1>
          <p class="lead">CarePanel is a calmer medication workspace for two real jobs: keeping day-to-day records tidy and making psychiatrist review faster, clearer, and more professional.</p>
          <div class="cta-row">
            <a class="button button-primary" href="${escapeHtml(publicAppUrlWithTrailingSlash)}" aria-label="Open CarePanel">Open CarePanel</a>
            <a class="button button-secondary" href="${escapeHtml(`${publicAppUrlWithTrailingSlash}#consult`)}" aria-label="Open clinician review">Open Clinician Review</a>
          </div>
          <div class="badge-row" aria-label="Key product highlights">
            <span class="badge">Current meds and schedule</span>
            <span class="badge">Changes and consult questions</span>
            <span class="badge">Quick daily check-ins</span>
            <span class="badge">Read-only sharing controls</span>
          </div>
          <div class="hero-proof-row" aria-label="Product highlights">
            <article class="hero-proof-card">
              <span class="hero-proof-label">Owner workspace</span>
              <strong>Daily logging without clutter</strong>
              <p>Track doses, changes, notes, and check-ins without losing the bigger picture.</p>
            </article>
            <article class="hero-proof-card hero-proof-card-accent">
              <span class="hero-proof-label">Clinician review</span>
              <strong>Scan the important context faster</strong>
              <p>Current regimen, recent changes, open questions, and timeline cues sit in one cleaner flow.</p>
            </article>
          </div>
        </div>

        <div class="hero-stage" aria-hidden="true">
          <div class="preview-window preview-window-primary">
            <div class="preview-window-header">
              <div class="preview-window-title">
                <strong>Today summary</strong>
                <span>Owner workspace</span>
              </div>
              <span class="preview-pill">Private</span>
            </div>
            <div class="preview-stat-grid">
              <article class="preview-stat-card">
                <span>Current regimen</span>
                <strong>6 active</strong>
              </article>
              <article class="preview-stat-card">
                <span>Pending</span>
                <strong>Check-in + 1 note</strong>
              </article>
              <article class="preview-stat-card">
                <span>Risk</span>
                <strong>Watch</strong>
              </article>
              <article class="preview-stat-card">
                <span>Last change</span>
                <strong>Concerta increase</strong>
              </article>
            </div>
            <div class="preview-activity-list">
              <div class="preview-activity-row">
                <span class="preview-activity-dot"></span>
                <span>Morning doses still open</span>
                <strong>08:00</strong>
              </div>
              <div class="preview-activity-row">
                <span class="preview-activity-dot preview-activity-dot-teal"></span>
                <span>Quick check-in still pending</span>
                <strong>Today</strong>
              </div>
              <div class="preview-activity-row">
                <span class="preview-activity-dot preview-activity-dot-gold"></span>
                <span>Question queued for next consult</span>
                <strong>Open</strong>
              </div>
            </div>
            <p class="preview-note">Simple daily capture up front, with a clearer review layer ready when it is time for an appointment.</p>
          </div>

          <div class="hero-stage-secondary">
            <div class="preview-window preview-window-secondary">
              <div class="preview-window-header">
                <div class="preview-window-title">
                  <strong>Clinician review</strong>
                  <span>Read quickly during consults</span>
                </div>
                <span class="preview-pill preview-pill-teal">Read-only</span>
              </div>
              <div class="preview-window-row">
                <span>Current medications</span>
                <strong>Table + grouped schedule</strong>
              </div>
              <div class="preview-window-row">
                <span>Open questions</span>
                <strong>Prioritised for review</strong>
              </div>
              <div class="preview-window-row">
                <span>Decision log</span>
                <strong>Recent plan visible</strong>
              </div>
              <div class="preview-window-row">
                <span>Trend quality</span>
                <strong>Window + confidence note</strong>
              </div>
            </div>
            <div class="hero-side-note">
              <span class="hero-side-note-label">Built for the real handoff</span>
              <strong>Owner tracking and clinician review use the same information, but not the same visual hierarchy.</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="section-block" aria-labelledby="core-uses-title">
        <div class="section-heading">
          <p class="section-kicker">Designed with stronger product structure</p>
          <h2 id="core-uses-title">A more complete product surface, not just a log of notes and doses</h2>
          <p class="section-copy">The site is designed as a full workspace: a calmer daily dashboard for the owner, a cleaner review surface for clinicians, and private sharing controls that do not feel bolted on.</p>
        </div>

        <div class="feature-mosaic">
          <article class="feature-card feature-card-large">
            <span class="card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 12h3l1.8-3.2L12 15l2.3-4 1.4 2.4H20"></path>
                <rect x="6" y="4.5" width="12" height="15" rx="4.5"></rect>
              </svg>
            </span>
            <h3>Owner tracking</h3>
            <p>Record medications, dose timing, check-ins, changes, and notes in one structured daily workspace.</p>
            <ul class="feature-points">
              <li>Current regimen and schedule grouped clearly</li>
              <li>Daily status and follow-up items surfaced higher</li>
              <li>Quick capture workflows without admin-heavy clutter</li>
            </ul>
          </article>

          <article class="feature-card feature-card-accent-teal">
            <span class="card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 4v4a4 4 0 1 0 8 0V4"></path>
                <path d="M9 4v4a2 2 0 1 0 4 0V4"></path>
                <path d="M15 12v2a4 4 0 1 0 8 0v-1"></path>
                <circle cx="22" cy="12" r="2"></circle>
              </svg>
            </span>
            <h3>Clinician review</h3>
            <p>Surface regimen, recent changes, questions, trends, and decisions in a calmer appointment-ready view.</p>
          </article>

          <article class="feature-card feature-card-accent-gold">
            <span class="card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 8a3 3 0 1 0-2.8-4h-.4A3 3 0 0 0 9 8c0 .3 0 .6.1.9l-4 2.3a3 3 0 1 0 1.4 2.6c0-.3 0-.6-.1-.9l4-2.3A3 3 0 0 0 12 11c1.2 0 2.2-.6 2.8-1.5l4.2 2.4a3 3 0 1 0 .9-1.5L15.5 8z"></path>
              </svg>
            </span>
            <h3>Private sharing</h3>
            <p>Create controlled read-only links, choose what stays hidden, and preview exactly what another person will see.</p>
          </article>

          <article class="feature-card feature-card-accent-sky">
            <span class="card-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 20V4"></path>
                <path d="M4 20h16"></path>
                <path d="m7 14 3-3 3 2 4-5"></path>
              </svg>
            </span>
            <h3>Medication history</h3>
            <p>See recent medication changes, timeline context, and interpretation notes without losing chronology.</p>
          </article>
        </div>
      </section>

      <section class="section-card workflow-board" aria-labelledby="workflow-title">
        <div class="section-card-grid two-col workflow-board-grid">
          <div class="section-heading">
            <p class="section-kicker">How it works</p>
            <h2 id="workflow-title">A calmer path from daily use to appointment review</h2>
            <p class="section-copy">The same information becomes easier to use because the layout changes with the task. Daily capture stays practical. Review surfaces the right context. Sharing stays controlled and readable.</p>
          </div>

          <div class="journey-board">
            <article class="summary-card journey-step">
              <span class="card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3v11"></path>
                  <path d="m8 10 4 4 4-4"></path>
                  <path d="M4 20h16"></path>
                </svg>
              </span>
              <h3>1. Capture daily facts</h3>
              <p>Keep medication timing, check-ins, and quick notes current without turning every entry into paperwork.</p>
            </article>
            <article class="summary-card journey-step">
              <span class="card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 20V4"></path>
                  <path d="M4 20h16"></path>
                  <path d="m7 14 3-3 3 2 4-5"></path>
                </svg>
              </span>
              <h3>2. Prepare for appointments</h3>
              <p>Turn the same data into a structured review view with current meds, changes, trends, questions, and recent decisions.</p>
            </article>
            <article class="summary-card journey-step">
              <span class="card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3.5" y="5" width="17" height="15" rx="2"></rect>
                  <path d="M7 3.5v3"></path>
                  <path d="M17 3.5v3"></path>
                  <path d="M3.5 9.5h17"></path>
                </svg>
              </span>
              <h3>3. Keep continuity between visits</h3>
              <p>Use the decision log, questions, and change history so the next review starts with context instead of memory alone.</p>
            </article>
          </div>
        </div>
      </section>

      <section class="section-block" aria-labelledby="quality-title">
        <div class="section-heading">
          <p class="section-kicker">What the product includes</p>
          <h2 id="quality-title">Designed to feel complete, private, and clinically useful</h2>
          <p class="section-copy">Every major part of the product has a purpose: daily tracking, review preparation, controlled sharing, and enough structure to make the whole experience feel reliable.</p>
        </div>

        <div class="panel-grid showcase-grid">
          <article class="content-panel showcase-panel">
            <h3>Daily workspace</h3>
            <ul class="list-check">
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Current medications with schedule groupings and dose detail.</span></li>
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Quick check-ins, note capture, and medication change logging.</span></li>
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Cleaner dashboard hierarchy so the next action is easier to spot.</span></li>
            </ul>
          </article>

          <article class="content-panel showcase-panel">
            <h3>Review workspace</h3>
            <ul class="list-check">
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Consult structure that separates review, planning, and export tasks.</span></li>
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Faster scanning for clinicians with clearer tables, badges, and status summaries.</span></li>
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Read-only sharing controls that keep owner-only editing tools out of the review context.</span></li>
            </ul>
          </article>

          <article class="content-panel showcase-panel">
            <h3>Private handoff</h3>
            <ul class="list-check">
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Recipient-safe previews before sending any read-only link.</span></li>
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Visibility controls for sensitive notes and private categories.</span></li>
              <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>A cleaner link-management area that feels like an access tool, not a leftover settings form.</span></li>
            </ul>
          </article>
        </div>
      </section>

      <section class="cta-band" aria-labelledby="cta-title">
        <div>
          <p class="section-kicker">Ready to use</p>
          <h2 id="cta-title">Open the tracker and move straight into the daily or review workspace</h2>
          <p class="lead">Built for practical daily use, clearer psychiatrist review, and safer sharing when needed. Not a substitute for medical advice.</p>
        </div>
        <div class="button-row">
          <a class="button button-secondary" href="${escapeHtml(publicAppUrlWithTrailingSlash)}">Open the Workspace</a>
          <a class="button button-secondary" href="/about/">See how it works</a>
        </div>
      </section>
    `
  });
}

function renderPublicInfoPage(req, options) {
  const sections = options.sections
    ? options.sections
      .map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></section>`)
      .join("")
    : "";
  return renderPublicLayout(req, {
    path: options.path,
    title: options.title,
    description: options.description,
    contentHtml: options.contentHtml || `
      <article class="content-panel" aria-labelledby="page-title">
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

app.get("/", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  return res.sendFile(path.join(projectRoot, "index.html"));
  res.type("html").send(renderLandingHtml(req));
});

app.get("/about", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  return res.sendFile(path.join(projectRoot, "about", "index.html"));
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/about/",
    title: "About CarePanel",
    heading: "About CarePanel",
    description: "Built to separate daily medication tracking from cleaner clinician review.",
    contentHtml: `
      <section class="page-hero page-hero-premium" aria-labelledby="page-title">
        <div class="page-hero-grid">
          <div>
            <p class="page-kicker">About the product</p>
            <h1 id="page-title">Built to make daily tracking feel calmer and clinician review feel clearer</h1>
            <p class="lead">CarePanel keeps medications, changes, check-ins, notes, and review items in one private workspace, then reshapes that same information into a cleaner view for appointments.</p>
            <div class="stats-row" aria-label="Key points">
              <span class="mini-badge">Owner-first daily use</span>
              <span class="mini-badge">Clinician-friendly review</span>
              <span class="mini-badge">Controlled read-only sharing</span>
            </div>
          </div>
          <aside class="page-rail-card">
            <span class="page-rail-label">At a glance</span>
            <strong>One product, three jobs</strong>
            <p>Daily capture, appointment review, and controlled sharing all live in the same system, but with different hierarchy and emphasis.</p>
            <div class="page-rail-metrics" aria-hidden="true">
              <div class="page-rail-metric">
                <span>Daily use</span>
                <strong>Owner-first</strong>
              </div>
              <div class="page-rail-metric">
                <span>Review</span>
                <strong>Clinician-ready</strong>
              </div>
              <div class="page-rail-metric">
                <span>Sharing</span>
                <strong>Read-only</strong>
              </div>
            </div>
            <ul class="page-rail-list">
              <li>Keep day-to-day capture practical.</li>
              <li>Surface review context without clutter.</li>
              <li>Separate owner controls from recipient views.</li>
            </ul>
          </aside>
        </div>
      </section>

      <section class="info-split-grid" aria-labelledby="about-structure-title">
        <article class="content-panel content-panel-rich">
          <p class="section-kicker">Why it exists</p>
          <h2 id="about-structure-title">The product is designed around a real handoff problem</h2>
          <p>Most medication tracking tools are either too thin to help during an appointment or too cluttered to stay practical day to day. CarePanel is built around the handoff between those two moments.</p>
          <p>The same information should be useful to the owner every day and still readable to a psychiatrist or clinician during review. That is the design problem the product is trying to solve.</p>
        </article>
        <article class="content-panel content-panel-rich">
          <p class="section-kicker">Who it is for</p>
          <h2>Private use first, optional review second</h2>
          <p>The tracker is built for the owner first, with optional read-only access for clinician, psychiatrist, family, or support review when that is useful and appropriate.</p>
          <ul class="list-check">
            <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Daily logging should stay practical.</span></li>
            <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Review should be faster to scan.</span></li>
            <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Sharing should stay controlled and clear.</span></li>
          </ul>
        </article>
      </section>

      <section class="feature-mosaic feature-mosaic-tight" aria-labelledby="principles-title">
        <article class="feature-card feature-card-large">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12h3l1.8-3.2L12 15l2.3-4 1.4 2.4H20"></path>
              <rect x="6" y="4.5" width="12" height="15" rx="4.5"></rect>
            </svg>
          </span>
          <h2 id="principles-title">What the product is trying to do well</h2>
          <p>Make the tracker feel complete and trustworthy without sacrificing privacy, calmness, or everyday usefulness.</p>
        </article>
        <article class="feature-card">
          <h3>Keep daily logging practical</h3>
          <p>Track what matters without burying the owner in admin-heavy screens.</p>
        </article>
        <article class="feature-card feature-card-accent-teal">
          <h3>Make review easier to scan</h3>
          <p>Bring current meds, recent changes, questions, and trend cues into one clearer structure.</p>
        </article>
        <article class="feature-card feature-card-accent-gold">
          <h3>Keep sharing controlled</h3>
          <p>Separate owner controls from recipient review and let the owner preview what another person will see.</p>
        </article>
      </section>

      <section class="section-card workflow-board" aria-labelledby="about-flow-title">
        <div class="section-card-grid two-col workflow-board-grid">
          <div class="section-heading">
            <p class="section-kicker">Product flow</p>
            <h2 id="about-flow-title">How the product is meant to be used</h2>
            <p class="section-copy">The structure is deliberate: capture daily facts, move into review when needed, and keep enough continuity that the next appointment starts with context.</p>
          </div>
          <div class="journey-board">
            <article class="summary-card journey-step"><h3>1. Track</h3><p>Log the facts that matter without making the page feel like paperwork.</p></article>
            <article class="summary-card journey-step"><h3>2. Review</h3><p>Turn the same information into a cleaner appointment-ready reading surface.</p></article>
            <article class="summary-card journey-step"><h3>3. Continue</h3><p>Keep decisions, changes, and questions visible enough to support continuity between visits.</p></article>
          </div>
        </div>
      </section>

      <section class="cta-band" aria-labelledby="about-cta-title">
        <div>
          <p class="section-kicker">Next step</p>
          <h2 id="about-cta-title">Open the tracker and move into the daily workspace or the review workspace</h2>
          <p class="lead">The same product supports everyday use and appointment preparation. It does not replace professional medical advice.</p>
        </div>
        <div class="button-row">
          <a class="button button-secondary" href="${escapeHtml(publicAppUrlWithTrailingSlash)}">Open CarePanel</a>
          <a class="button button-secondary" href="/contact/">Contact</a>
        </div>
      </section>
    `
  }));
});

app.get("/contact", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  return res.sendFile(path.join(projectRoot, "contact", "index.html"));
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/contact/",
    title: "Contact CarePanel",
    heading: "Contact",
    description: "Support and contact guidance for CarePanel.",
    contentHtml: `
      <section class="page-hero page-hero-premium" aria-labelledby="page-title">
        <div class="page-hero-grid">
          <div>
            <p class="page-kicker">Contact and support</p>
            <h1 id="page-title">Use the right contact path for support, privacy, and clinical matters</h1>
            <p class="lead">Website questions, tracker issues, privacy concerns, and clinical matters do not belong in the same channel. This page is designed to make that separation clearer.</p>
          </div>
          <aside class="page-rail-card page-rail-card-warning">
            <span class="page-rail-label">Important</span>
            <strong>This site is not an emergency channel.</strong>
            <p>Urgent health concerns should go to local emergency or urgent medical support, not through this website.</p>
            <div class="page-rail-metrics" aria-hidden="true">
              <div class="page-rail-metric">
                <span>Website</span>
                <strong>Support route</strong>
              </div>
              <div class="page-rail-metric">
                <span>Clinical</span>
                <strong>Clinician route</strong>
              </div>
              <div class="page-rail-metric">
                <span>Urgent</span>
                <strong>Emergency route</strong>
              </div>
            </div>
            <ul class="page-rail-list">
              <li>Use the product support path for product and access issues.</li>
              <li>Use a clinician for treatment decisions.</li>
              <li>Use emergency care for urgent health concerns.</li>
            </ul>
          </aside>
        </div>
      </section>

      <section class="support-grid support-grid-rich" aria-label="Support guidance">
        <article class="support-card support-card-featured">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12h3l1.8-3.2L12 15l2.3-4 1.4 2.4H20"></path>
              <rect x="6" y="4.5" width="12" height="15" rx="4.5"></rect>
            </svg>
          </span>
          <h3>Website support</h3>
          <p>For product support, access issues, or workspace problems, use the support contact path provided with your CarePanel workspace or deployment.</p>
        </article>
        <article class="support-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 4v4a4 4 0 1 0 8 0V4"></path>
              <path d="M9 4v4a2 2 0 1 0 4 0V4"></path>
              <path d="M15 12v2a4 4 0 1 0 8 0v-1"></path>
              <circle cx="22" cy="12" r="2"></circle>
            </svg>
          </span>
          <h3>Clinical communication</h3>
          <p>Medication decisions, treatment changes, and interpretation of symptoms should be discussed directly with your clinician or prescribing clinician.</p>
        </article>
        <article class="support-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3 8 4.5v5c0 4.7-3.4 8.9-8 9.9-4.6-1-8-5.2-8-9.9v-5L12 3z"></path>
              <path d="M12 8v5"></path>
              <path d="M12 16h.01"></path>
            </svg>
          </span>
          <h3>Urgent concerns</h3>
          <p>Do not use this website for emergencies. Contact local emergency services or urgent medical support for immediate health concerns.</p>
        </article>
        <article class="support-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7a2 2 0 0 1 2-2h7l3 3h2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"></path>
              <path d="M9 12h6"></path>
              <path d="M12 9v6"></path>
            </svg>
          </span>
          <h3>Privacy and access</h3>
          <p>If a shared link or access arrangement needs to be changed, revoked, or checked, raise it through the tracker owner rather than through a clinical appointment.</p>
        </article>
      </section>

      <section class="info-split-grid" aria-labelledby="contact-when-title">
        <article class="content-panel content-panel-rich">
          <p class="section-kicker">Use this page for</p>
          <h2 id="contact-when-title">Questions about the website and access</h2>
          <ul class="list-check">
            <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Website issues, access problems, and update requests.</span></li>
            <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Questions about what the tracker is for and how it is used.</span></li>
            <li><span class="inline-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4 10-10"></path></svg></span><span>Read-only link issues, privacy visibility questions, or sharing concerns.</span></li>
          </ul>
        </article>
        <article class="content-panel content-panel-rich">
          <p class="section-kicker">Do not use this page for</p>
          <h2>Medication instructions or emergencies</h2>
          <p>CarePanel supports organisation and discussion. It does not diagnose, prescribe, or replace professional care.</p>
          <div class="info-note info-note-strong">
            <strong>Keep clinical decisions with the clinical team.</strong>
            <p>Treatment changes, urgent symptoms, and private medical decisions belong with the appropriate healthcare channel.</p>
          </div>
        </article>
      </section>
    `
  }));
});

app.get("/privacy", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  return res.sendFile(path.join(projectRoot, "privacy", "index.html"));
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/privacy/",
    title: "Privacy Policy | CarePanel",
    heading: "Privacy policy",
    description: "How CarePanel handles private information and controlled sharing.",
    contentHtml: `
      <section class="page-hero page-hero-premium" aria-labelledby="page-title">
        <div class="page-hero-grid">
          <div>
            <p class="page-kicker">Privacy policy</p>
            <h1 id="page-title">How CarePanel handles private information</h1>
            <p class="lead">CarePanel is designed to support continuity and clinician discussion. It stores practical treatment information, allows controlled sharing, and is not a public health profile or medical advice service.</p>
            <div class="stats-row" aria-label="Privacy highlights">
              <span class="mini-badge">Owner-controlled sharing</span>
              <span class="mini-badge">Read-only recipient access</span>
              <span class="mini-badge">Clinical use support only</span>
            </div>
          </div>
          <aside class="page-rail-card">
            <span class="page-rail-label">Privacy principle</span>
            <strong>Owner control stays central.</strong>
            <p>The owner controls what is recorded, what is shared, and which detail stays visible or hidden in read-only views.</p>
            <div class="page-rail-metrics" aria-hidden="true">
              <div class="page-rail-metric">
                <span>Links</span>
                <strong>Revocable</strong>
              </div>
              <div class="page-rail-metric">
                <span>Recipients</span>
                <strong>Read-only</strong>
              </div>
              <div class="page-rail-metric">
                <span>Visibility</span>
                <strong>Owner-set</strong>
              </div>
            </div>
            <ul class="page-rail-list">
              <li>Sharing is optional, not automatic.</li>
              <li>Review views are separate from editing views.</li>
              <li>Sensitive visibility stays with the owner.</li>
            </ul>
          </aside>
        </div>
      </section>

      <section class="policy-grid policy-grid-rich" aria-label="Privacy sections">
        <article class="policy-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"></ellipse>
              <path d="M5.5 6.5v6c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-6"></path>
              <path d="M5.5 12.5v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5"></path>
            </svg>
          </span>
          <h3>Data storage</h3>
          <p>Medication and wellbeing entries are stored for continuity and consult review. Storage can be local-only or synced depending on tracker settings and the build being used.</p>
        </article>
        <article class="policy-card policy-card-accent">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 8a3 3 0 1 0-2.8-4h-.4A3 3 0 0 0 9 8c0 .3 0 .6.1.9l-4 2.3a3 3 0 1 0 1.4 2.6c0-.3 0-.6-.1-.9l4-2.3A3 3 0 0 0 12 11c1.2 0 2.2-.6 2.8-1.5l4.2 2.4a3 3 0 1 0 .9-1.5L15.5 8z"></path>
            </svg>
          </span>
          <h3>Sharing</h3>
          <p>Shared links are read-only and can be revoked by the owner. Access logging may include open count and last-opened time so the owner can monitor link use.</p>
        </article>
        <article class="policy-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3 8 4.5v5c0 4.7-3.4 8.9-8 9.9-4.6-1-8-5.2-8-9.9v-5L12 3z"></path>
              <path d="M8.5 12.5 10.7 15l4.8-5.2"></path>
            </svg>
          </span>
          <h3>Review-only intent</h3>
          <p>Recipient views are designed for review, not editing. Shared viewers do not use links to change medication records, check-ins, or notes.</p>
        </article>
      </section>

      <section class="info-split-grid" aria-labelledby="privacy-detail-title">
        <article class="content-panel content-panel-rich">
          <p class="section-kicker">What this policy focuses on</p>
          <h2 id="privacy-detail-title">The plain-language version</h2>
          <p>The tracker is built for private treatment organisation and clinician discussion. It is not intended to create a public profile, a general-purpose social feed, or a replacement for healthcare advice.</p>
        </article>
        <article class="content-panel content-panel-rich">
          <p class="section-kicker">Medical disclaimer</p>
          <h2>Documentation support, not treatment advice</h2>
          <p>CarePanel supports documentation and discussion with a prescriber. It does not diagnose, prescribe, or give treatment instructions.</p>
        </article>
      </section>

      <section class="cta-band" aria-labelledby="privacy-cta-title">
        <div>
          <p class="section-kicker">Questions about visibility?</p>
          <h2 id="privacy-cta-title">Use CarePanel’s sharing controls or contact the workspace owner directly</h2>
          <p class="lead">Privacy settings and read-only link options are designed to keep owner controls separate from recipient review access.</p>
        </div>
        <div class="button-row">
          <a class="button button-secondary" href="${escapeHtml(publicAppUrlWithTrailingSlash)}">Open CarePanel</a>
          <a class="button button-secondary" href="/contact/">Contact</a>
        </div>
      </section>
    `
  }));
});

app.get("/terms", (req, res) => {
  res.setHeader("Cache-Control", htmlCacheControl);
  return res.sendFile(path.join(projectRoot, "terms", "index.html"));
  res.type("html").send(renderPublicInfoPage(req, {
    path: "/terms/",
    title: "Terms of Use | CarePanel",
    heading: "Terms of use",
    description: "Usage terms for the CarePanel website and workspace.",
    contentHtml: `
      <section class="page-hero page-hero-premium" aria-labelledby="page-title">
        <div class="page-hero-grid">
          <div>
            <p class="page-kicker">Terms of use</p>
            <h1 id="page-title">Terms for using the CarePanel website</h1>
            <p class="lead">CarePanel is intended to support private medication tracking and clinician review. It is not an emergency response tool, a public medical record, or a replacement for professional healthcare advice.</p>
          </div>
          <aside class="page-rail-card">
            <span class="page-rail-label">Core rule</span>
            <strong>Use it as a support tool.</strong>
            <p>The product helps organise information, but healthcare decisions still belong with healthcare professionals.</p>
            <div class="page-rail-metrics" aria-hidden="true">
              <div class="page-rail-metric">
                <span>Purpose</span>
                <strong>Organisation</strong>
              </div>
              <div class="page-rail-metric">
                <span>Not for</span>
                <strong>Emergencies</strong>
              </div>
              <div class="page-rail-metric">
                <span>Decisions</span>
                <strong>Clinician-led</strong>
              </div>
            </div>
            <ul class="page-rail-list">
              <li>Use the tracker to prepare and review.</li>
              <li>Keep credentials and links secure.</li>
              <li>Take urgent care issues outside the site.</li>
            </ul>
          </aside>
        </div>
      </section>

      <section class="policy-grid policy-grid-rich" aria-label="Terms overview">
        <article class="policy-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 4h10"></path>
              <path d="M9 4v16"></path>
              <path d="M15 4v16"></path>
              <path d="M7 20h10"></path>
            </svg>
          </span>
          <h3>Intended use</h3>
          <p>This website is intended for private medication tracking and support for clinician review, not for diagnosis or medical instruction.</p>
        </article>
        <article class="policy-card">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 11V8a5 5 0 0 1 10 0v3"></path>
              <rect x="5" y="11" width="14" height="9" rx="2"></rect>
              <path d="M12 15v2"></path>
            </svg>
          </span>
          <h3>Account responsibility</h3>
          <p>Users are responsible for keeping access credentials, private data, and shared links secure.</p>
        </article>
        <article class="policy-card policy-card-accent">
          <span class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3 8 4.5v5c0 4.7-3.4 8.9-8 9.9-4.6-1-8-5.2-8-9.9v-5L12 3z"></path>
              <path d="M12 8v5"></path>
              <path d="M12 16h.01"></path>
            </svg>
          </span>
          <h3>No emergency service</h3>
          <p>This website is not monitored as an emergency system. Urgent concerns should go to local emergency services or the relevant care provider directly.</p>
        </article>
      </section>

      <section class="content-panel content-panel-rich" aria-labelledby="terms-detail-title">
        <p class="section-kicker">Plain-language summary</p>
        <h2 id="terms-detail-title">Key terms in plain language</h2>
        <section>
          <h3>Use it as a support tool</h3>
          <p>The website is meant to help organise treatment information, not to replace a prescriber, therapist, GP, or emergency service.</p>
        </section>
        <section>
          <h3>Protect your access</h3>
          <p>If you use accounts or shared links, you are responsible for keeping them secure and for reviewing whether recipient access is still appropriate.</p>
        </section>
      </section>

      <section class="cta-band" aria-labelledby="terms-cta-title">
        <div>
          <p class="section-kicker">Need the tracker itself?</p>
          <h2 id="terms-cta-title">Open the workspace to track medications or prepare for review</h2>
          <p class="lead">Use the site for practical organisation and clinician discussion support, then rely on healthcare professionals for diagnosis and treatment decisions.</p>
        </div>
        <div class="button-row">
          <a class="button button-secondary" href="${escapeHtml(publicAppUrlWithTrailingSlash)}">Open CarePanel</a>
          <a class="button button-secondary" href="/privacy/">Privacy</a>
        </div>
      </section>
    `
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
    console.log(`CarePanel server running on http://127.0.0.1:${listenPort}`);
    // eslint-disable-next-line no-console
    console.log(`Auth enabled: true · Encryption at rest: ${encryptionKey ? "enabled" : "disabled"}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === moduleFilename) {
  startServer();
}
