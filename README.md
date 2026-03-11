# AdhdAgenda

AdhdAgenda is a medication-tracking website and app with:

- public marketing and legal pages
- a private app shell at `/app`
- an Express API used locally and through Netlify Functions
- support for auth, invites, password reset, and read-only sharing

## Run locally

1. Install dependencies:
   - `npm install`
2. Start the local server:
   - `npm run dev`
3. Open:
   - `http://127.0.0.1:8080`

## Main repo structure

- `/index.html` and `/about|contact|privacy|terms/index.html`
  - public website pages
- `/assets`
  - public-site assets and public-site CSS
- `/app`
  - app shell HTML
- `/app.js`, `/styles.css`, and root `*.js` modules
  - app logic
- `/server`
  - Express server and API logic
- `/netlify/functions/api.js`
  - Netlify Function wrapper for the Express app
- `/tests`
  - automated tests

## Deployment

This repo is prepared for:

1. push to GitHub
2. connect the repo to Netlify
3. deploy from the repo root using `netlify.toml`

Netlify serves the static public pages directly and routes `/api/*` to the Netlify Function.

## Canonical domain

- production domain: `https://adhdagenda.com`
- `www.adhdagenda.com` and older legacy hosts are redirected to the canonical host
- legacy `/tracker` links are intentionally redirected to `/app`
- legacy root hash links like `#invite=`, `#share_token=`, and `#reset=` are intentionally forwarded to `/app`

## Important environment variables

- `MT_ENCRYPTION_KEY`
  - required in production
- `MT_SITE_VISIBILITY`
  - `public` or `private`
- `MT_SITE_URL`
  - normally `https://adhdagenda.com`
- `MT_APP_URL`
  - optional override for the app base URL
- `MT_BLOBS_NAME`
  - optional Netlify Blobs store name override if you need to keep using an older blob store during migration

## Tests

- unit and server tests:
  - `npm test`
- Playwright browser tests:
  - `npx playwright test tests/landing-smoke.spec.mjs`
  - `npx playwright test tests/ui-entry-workflows.spec.mjs`
