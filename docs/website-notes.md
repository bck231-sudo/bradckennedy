# Website Routing Notes

This project now supports two deployment modes:

1. Static hosting (GitHub Pages): files in repo root are served directly.
2. Express hosting: server routes in `/server/server.js`.

## Routing map

- `/` -> Public home page (HTML-first, no JS required)
- `/about` -> Public about page
- `/contact` -> Public contact page
- `/privacy` -> Public privacy page
- `/terms` -> Public terms page
- `/robots.txt` -> Crawl rules
- `/sitemap.xml` -> Public page sitemap
- `/app` -> CarePanel app shell
- `/app/*` -> CarePanel SPA deep links
- `/tracker` and `/tracker/*` -> Legacy alias to app shell
- On Express, any other non-API route falls back to app shell for backward compatibility.

## Static hosting notes (current production on GitHub Pages)

- Public pages are static files:
  - `/index.html`
  - `/about/index.html`
  - `/contact/index.html`
  - `/privacy/index.html`
  - `/terms/index.html`
- App shell lives at `/app/index.html`.
- Supported root app hashes are redirected to `/app` by `/landing-compat.js`.
- Robots and sitemap are static:
  - `/robots.txt`
  - `/sitemap.xml`

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

- `MT_SITE_URL=https://adhdagenda.com`

## Where to edit public page copy

For GitHub Pages/static hosting, edit:

- `/index.html`
- `/about/index.html`
- `/contact/index.html`
- `/privacy/index.html`
- `/terms/index.html`

For Express-hosted mode, edit server renderers in `/server/server.js`.

## Where to edit public page styling

- `/public/assets/site.css`

This stylesheet is only for public pages. App styling remains in `/styles.css`.
