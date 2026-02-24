# Medication Tracker (bradckennedy.org)

This site now runs in **local-only mode** by default (no login, no backend required, no API setup).

## Run Locally (No Backend)

1. In this folder, start a static web server:
   - `python3 -m http.server 8080`
2. Open:
   - `http://127.0.0.1:8080`

All data is stored in your browser `localStorage` on that device/browser profile.

## Publish Online (No Payment Required)

Use any static host:

1. Netlify Free
2. Vercel Hobby
3. GitHub Pages

Deploy the contents of this folder as a static site (`index.html`, `app.js`, `styles.css`, etc).

## Sharing In Local-Only Mode

- Read-only links still work (they contain a signed snapshot in the URL hash).
- No server sync is used.
- Cloud sync controls are intentionally disabled in this build.

## What Changed (Phase 1)

- Added API server scaffold at `/Users/brad/Documents/New project/bradckennedy/server/server.js` (kept for future optional use).
- Cloud sync controls are now disabled by default for no-backend operation.
- Added reminder settings (lead time + optional desktop notifications).
- Added secure sharing defaults:
  - 30-day default link expiry
  - stronger random share tokens

## Phase 1 Upgrade (Shared-Care Focus)

- Kept existing structure and labels (`Medication Tracker`, `Dashboard / History / Settings / Share`, Viewer Context + Data View).
- Added an action-first dashboard flow:
  1. Today at a glance strip (adherence, next dose, risk, last check-in)
  2. Today’s doses/actions
  3. Quick check-in
  4. Alerts / monitoring reminders
  5. Recent medication changes (14 days)
  6. Medication details
  7. Contextual action plan (shown in elevated/high risk, always editable in owner mode)
- Added explainable risk status (rule-based, no opaque AI):
  - `Low / Watch / Elevated / High`
  - “Why this status?” shows exact triggers
  - Warning signs + thresholds are editable in Settings
- Added owner inline editing on dashboard:
  - alerts/reminders
  - recent medication changes
  - medication detail key fields
  - action plan steps
- Extended medication-change schema/UI:
  - `route`, `changedBy`, `reasonForChange`, `expectedEffects`, `monitorFor`, `reviewDate`, `notes`
- Daily check-in now supports same-day edit (updates existing entry instead of failing as duplicate).
- Added PWA support:
  - `manifest.webmanifest`
  - `sw.js` offline shell cache
  - app icons in `/Users/brad/Documents/New project/bradckennedy/icons/`
  - offline banner in UI
- Export enhancements:
  - selectable 7/14/30 day summary range
  - print/PDF summary now includes risk status/history and action plan context.

## Second-Round Upgrade Summary

- Added predictable navigation for faster daily use:
  - Top navigation: `Dashboard`, `History`, `Settings`, `Share`
  - Bottom tab bar: `Dashboard`, `Medications`, `History`, `Share`, `Settings`
- Reworked dashboard to be action-first:
  - Today’s doses and actions at the top (with filters + card/table toggle)
  - Reliable Taken/Skip actions with loading state, optimistic update, undo, and save/error feedback
  - Quick daily check-in
  - Alerts/monitoring reminders
  - Recent medication changes (14 days)
  - Medication details table
  - Weekly trend preview
- Added owner-only inline dashboard editing:
  - Summary note
  - Alerts/reminders list
  - Recent medication changes (in-place edit, save, cancel)
- Added explicit viewer contexts:
  - `My View`
  - `Clinician View (preview)`
  - `Family View (preview)`
  - `Preview Shared Link` (simulate a specific recipient)
- Kept and expanded split entry workflows:
  - Add Current Medication
  - Log Medication Change
  - Log Effects / Side Effects Note
  - Daily Wellbeing Check-in
- Expanded medication detail panel with:
  - current dose/schedule/route/start date/indication
  - MOA simple + technical sections
  - acute vs chronic adaptation notes
  - dose adjustment interpretation
  - interactions + contraindications notes
  - side effects/monitoring
  - personal medication timeline
  - notes/questions for psychiatrist/GP
- Strengthened change interpretation cards with:
  - what changed
  - reason
  - short-term and longer-term expectations
  - monitor items
  - improvement and deterioration markers
  - uncertainty note
- Improved sharing controls:
  - presets (`Family`, `Clinician`, `Full Read-Only`)
  - per-link visibility toggles including sensitive tags
  - optional expiry
  - revoke/unrevoke
  - local access log (last opened + count)
  - preview as recipient from owner mode
- Enhanced charts/timeline with filters:
  - medication filter
  - date range filter
  - change markers
  - before/after comparison (7 days before, 14 days after)
- Added optional personalization controls:
  - owner display name for greeting
  - toggle to enable/disable personalized encouragement and consistency feedback
- Exports:
  - JSON backup
  - CSV datasets
  - clinician print-to-PDF summary

## Data Compatibility and Migration

Storage key remains unchanged: `medication_tracker_data_v1`.

Migration and normalization in `/Users/brad/Documents/New project/bradckennedy/app.js` preserve existing records and read-only links:

- legacy medication/change/note/check-in rows are normalized into v2 shape
- legacy `#share=` payloads are still supported
- no seeded default medications are injected

Additional compatibility updates:

- `dashboardConfig` is normalized with safe defaults:
  - `summaryNote`
  - `monitoringReminders`
- adherence rows now preserve action timestamps when available:
  - `actionAt`
  - `takenAt`
  - `skippedAt`

## How Current Medications Are Resolved

Current meds shown on Dashboard and Current Medications are derived from existing stored data only.

Resolution logic:

1. Group medication records by normalized medication name.
2. Prefer the most recently updated **active/current** record within each group.
3. If multiple records conflict, show one resolved current row and keep all underlying records intact.
4. Use the most recent matching medication change event to determine latest displayed dose when available.
5. Preserve historical/inactive records in storage and timelines.

This ensures no invented medication names or dosages are created.

## Sharing Presets and Visibility

Presets configure default view access plus content visibility:

- `Family View` (daily-focused)
- `Clinician View` (daily + clinical)
- `Full Read-Only` (daily + clinical + personal)

Per-link visibility toggles include:

- sensitive notes
- sensitive tags
- journal text
- libido/sexual side effects
- substance-use notes
- free-text notes

## Editing MOA Templates

MOA and related clinical text are editable per medication in the medication detail modal in `/Users/brad/Documents/New project/bradckennedy/app.js`.

Key fields:

- `moaSimple`
- `moaTechnical`
- `timeCourseNotes`
- `adjustmentAcute`
- `adjustmentChronic`
- `interactionsNotes`
- `contraindicationsNotes`
- `monitor`
- `questions`

## Interpretation Card Generation

Default card text is generated by `generateInterpretationTemplate()` in:

`/Users/brad/Documents/New project/bradckennedy/app.js`

When logging a medication change:

1. Enter medication, old/new dose, and reason.
2. Apply template.
3. Edit fields.
4. Save.

All interpretation content is informational and includes a discuss-with-prescriber safety footer.

## Phase 2 Upgrade (Auth + Secure Sync + Notifications)

Phase 2 is now implemented end-to-end with incremental updates (no rewrite).

- Invite-based cloud auth:
  - owner registration (`/api/auth/register-owner`)
  - sign-in/sign-out (`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`)
  - invite create/list/revoke/inspect/accept (`/api/auth/invites*`)
- Role-aware access controls:
  - `owner` can write account state
  - `viewer` / `family` / `clinician` are read-only for state writes
  - audit log readable by owner/clinician
- Secure sync backend:
  - structured account/user/session store in `server/data/store.json`
  - optional encryption at rest for account state using `MT_ENCRYPTION_KEY`
  - backward compatibility with legacy plain state + legacy owner key mode
- Audit log:
  - auth events, invite events, state reads/writes, risk notification events
  - API: `GET /api/audit?limit=...`
- Optional notifications:
  - dose reminders (existing)
  - new rule-threshold risk notifications (toast + desktop notification + optional cloud event)
  - API: `POST /api/notifications/risk`, `GET /api/notifications`
- Frontend cloud controls:
  - new “Cloud account and invites” panel in Sharing
  - register owner, sign in, accept invite, create/revoke invites, refresh cloud status
  - cloud sign-out quick action in utility panel

### New Server Environment Variables

- `MT_ENCRYPTION_KEY`:
  - when set, account state is encrypted at rest (AES-256-GCM)
- `MT_ALLOW_LEGACY_OWNER_KEY`:
  - `true` keeps old `x-owner-key` compatibility for legacy clients
- `MT_SESSION_TTL_DAYS`:
  - session token lifetime
- `MT_INVITE_TTL_DAYS`:
  - default invite expiry window

### Quick Setup (Phase 2)

1. Start server:
   - `npm run dev`
2. Open:
   - `http://127.0.0.1:8080` (or your configured port)
3. In app:
   - Share tab -> Cloud account and invites
   - set API endpoint (for local: `http://127.0.0.1:8080`)
   - register owner or sign in
   - create invites for clinician/family/viewer

### If "Register owner" seems to do nothing

- The app now shows clear cloud errors and temporarily disables the form while submitting.
- Most common cause: API endpoint is missing or backend is offline.
- Fix:
  1. Open `Share -> Settings + sync + reminders`
  2. Set **API endpoint**
  3. Click **Save sync settings**
  4. Try **Register owner** again
