# Website Notes

This repo is organised for one main deployment path:

1. Push to GitHub
2. Connect the repo to Netlify
3. Deploy from the repo root

## Source of truth

- Public pages live in static HTML files:
  - `/index.html`
  - `/about/index.html`
  - `/contact/index.html`
  - `/privacy/index.html`
  - `/terms/index.html`
- The app shell lives at `/app/index.html`
- Public-site styling lives at `/assets/site.css`
- App styling lives at `/styles.css`
- The Express server in `/server/server.js` serves the same public HTML files locally and powers the Netlify API function

## Routing

- `/` -> public homepage
- `/about`, `/contact`, `/privacy`, `/terms` -> public pages
- `/app` and `/app/*` -> app shell
- `/api/*` -> Netlify Function / Express API
- `/tracker` and `/tracker/*` -> intentional legacy redirect to `/app`

Legacy hash links like `#invite=`, `#share_token=`, and `#reset=` are intentionally forwarded to `/app` by `/landing-compat.js`.

## Domain

- Canonical domain: `https://adhdagenda.com`
- `www.adhdagenda.com` and older legacy domains are redirected to the canonical host by `/canonical-host.js`

## Search indexing

- `robots.txt` and `sitemap.xml` are static files for the public site
- API and app surfaces stay out of indexing
- If `MT_SITE_VISIBILITY=private` is used on the server/API runtime, the server also adds `X-Robots-Tag: noindex`
