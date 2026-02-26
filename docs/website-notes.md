# Website Routing Notes

This project now supports two deployment modes:

1. Static hosting (GitHub Pages): files in repo root are served directly.
2. Express hosting: server routes in `/Users/brad/Documents/New project/bradckennedy/server/server.js`.

## Routing map

- `/` -> Public home page (HTML-first, no JS required)
- `/about` -> Public about page
- `/contact` -> Public contact page
- `/privacy` -> Public privacy page
- `/terms` -> Public terms page
- `/robots.txt` -> Crawl rules
- `/sitemap.xml` -> Public page sitemap
- `/app` -> Medication Tracker app shell
- `/app/*` -> Medication Tracker SPA deep links
- `/tracker` and `/tracker/*` -> Legacy alias to app shell
- On Express, any other non-API route falls back to app shell for backward compatibility.

## Static hosting notes (current production on GitHub Pages)

- Public pages are static files:
  - `/Users/brad/Documents/New project/bradckennedy/index.html`
  - `/Users/brad/Documents/New project/bradckennedy/about/index.html`
  - `/Users/brad/Documents/New project/bradckennedy/contact/index.html`
  - `/Users/brad/Documents/New project/bradckennedy/privacy/index.html`
  - `/Users/brad/Documents/New project/bradckennedy/terms/index.html`
- App shell lives at `/Users/brad/Documents/New project/bradckennedy/app/index.html`.
- Legacy root hash links are redirected to `/app` locally and to `https://app.bradckennedy.org/app` on production domain by `/Users/brad/Documents/New project/bradckennedy/landing-compat.js`.
- Robots and sitemap are static:
  - `/Users/brad/Documents/New project/bradckennedy/robots.txt`
  - `/Users/brad/Documents/New project/bradckennedy/sitemap.xml`

## Why this structure

- Public pages at `/` provide a normal website entry point.
- App remains fully available at `/app`.
- Legacy app links still work because non-API routes fall back to the app shell.
- Share and private routes stay out of indexing (`robots.txt` disallows app/private surfaces).

## SEO + privacy switch

Set visibility with environment variables:

- `MT_SITE_VISIBILITY=public` (or `indexable`) -> pages are indexable
- `MT_SITE_VISIBILITY=private` (default) -> `noindex` behavior enabled

Optional canonical base URL:

- `MT_SITE_URL=https://bradckennedy.org`

## Where to edit public page copy

For GitHub Pages/static hosting, edit:

- `/Users/brad/Documents/New project/bradckennedy/index.html`
- `/Users/brad/Documents/New project/bradckennedy/about/index.html`
- `/Users/brad/Documents/New project/bradckennedy/contact/index.html`
- `/Users/brad/Documents/New project/bradckennedy/privacy/index.html`
- `/Users/brad/Documents/New project/bradckennedy/terms/index.html`

For Express-hosted mode, edit server renderers in `/Users/brad/Documents/New project/bradckennedy/server/server.js`.

## Where to edit public page styling

- `/Users/brad/Documents/New project/bradckennedy/public/assets/site.css`

This stylesheet is only for public pages. App styling remains in `/Users/brad/Documents/New project/bradckennedy/styles.css`.
