# Website Routing Notes

This project now serves two layers from the same Express server:

1. Public website pages (crawlable when `MT_SITE_VISIBILITY=public`)
2. Medication Tracker app shell (kept functional and mounted at `/app`)

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
- Any other non-API route -> app shell fallback for backward compatibility

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

Edit content in `/Users/brad/Documents/New project/bradckennedy/server/server.js`:

- Home page: `renderLandingHtml(req)`
- Shared layout/nav/footer: `renderPublicLayout(req, options)`
- About/Contact/Privacy/Terms: `renderPublicInfoPage(req, options)` and route blocks

## Where to edit public page styling

- `/Users/brad/Documents/New project/bradckennedy/public/assets/site.css`

This stylesheet is only for public pages. App styling remains in `/Users/brad/Documents/New project/bradckennedy/styles.css`.
