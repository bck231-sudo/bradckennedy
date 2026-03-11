# Accessibility, SEO, and Performance Sweep

## Scope
This pass improves public discoverability and quality for `adhdagenda.com` without changing medication-tracking core behavior.

## What Changed

### 1) Public landing page (`GET /`)
- Added an HTML-first landing page rendered by Express.
- Includes semantic landmarks: `header`, `nav`, `main`, `footer`.
- Added a keyboard-accessible skip link (`Skip to main content`).
- Added no-JS-required CTAs to the app shell:
  - `/app`
  - `/app#consult`
- Added a lightweight compatibility script (`/landing-compat.js`) that redirects legacy hash-based deep links to `/app#...`.

### 2) SEO
- Landing page now includes:
  - Title + meta description
  - Canonical URL
  - Open Graph tags
  - Twitter card tags
  - JSON-LD for `WebSite` and `SoftwareApplication`
- Added/updated:
  - `GET /robots.txt`
  - `GET /sitemap.xml`
- Sitemap only includes public pages:
  - `/`
  - `/privacy`
  - `/terms`
- Robots disallows crawl on app/auth surfaces:
  - `/api/`
  - `/app`
  - `/share`

### 3) Public legal pages
- Added server-rendered HTML pages:
  - `GET /privacy`
  - `GET /terms`
- Both are semantic, keyboard-friendly, and crawlable.

### 4) Security + performance headers
- Added Express security headers middleware:
  - `Content-Security-Policy` (baseline)
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Cross-Origin-Opener-Policy`
  - `Cross-Origin-Resource-Policy`
  - `Permissions-Policy`
  - `Strict-Transport-Security` (HTTPS requests)
- Disabled `X-Powered-By`.
- Added static caching strategy:
  - HTML: `public, max-age=0, must-revalidate`
  - static assets: 7 days + stale-while-revalidate
  - service worker + manifest: shorter TTL

### 5) Routing structure
- Public landing remains at `/`.
- App shell is now explicitly served at `/app` (and `/app/*`).
- Catch-all non-API routes still serve app shell (noindex) to preserve legacy behavior.

### 6) Accessibility checks on public pages
- Visible focus outlines for keyboard users.
- Proper heading order and semantic landmarks.
- All CTA links have accessible names.

## Tests Added/Updated

### Node tests (`node --test`)
- Added `tests/public-routes.test.mjs` to cover:
  - `GET /`
  - `GET /robots.txt`
  - `GET /sitemap.xml`

### Playwright tests
- Added `tests/landing-smoke.spec.mjs` to verify:
  - Landing page loads
  - H1 present
  - CTA present
  - No console errors
- Updated existing UI workflow tests to target `/app` as the app-shell entry.

## Commands

```bash
npm test
npm run dev
npx playwright test tests/landing-smoke.spec.mjs
npx playwright test tests/ui-entry-workflows.spec.mjs
```

## Notes
- No compression dependency was added to keep dependency changes minimal.
- Crawl behavior can still be controlled via `MT_SITE_VISIBILITY` (`private`/`public`).
