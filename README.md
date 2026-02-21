# Medication Tracker (bradckennedy.org)

This site is a static, client-side medication + wellbeing tracker with local-first storage and shareable read-only links.

## What Changed In This Refactor

- Added **multi-view modes**: `Daily View`, `Clinical View`, `Personal View`.
- Replaced the single mixed form with **split workflows**:
  - Add Current Medication
  - Log Medication Change
  - Log Effects / Side Effects Note
  - Daily Wellbeing Check-in
- Added **Medication Detail modal** with MOA sections, interpretation notes, monitoring, and medication-specific timeline.
- Added **structured daily check-ins** with mood/anxiety/focus/sleep/appetite/energy/irritability/cravings, side effect checklist, training notes, optional vitals.
- Added **change interpretation cards** (templated + editable).
- Added **charts/timeline** and before/after comparison around medication changes.
- Added **exports**: PDF clinician summary (print-to-PDF), CSV and JSON backups.
- Added **link-scoped sharing permissions** with presets, visibility toggles, expiry, revoke, and local access logging.

## Data Compatibility + Migration

Storage key remains unchanged: `medication_tracker_data_v1`.

A migration layer in `/Users/brad/Documents/New project/bradckennedy/app.js` upgrades legacy data to schema version 2 at load time:

- Legacy medication rows (`dose`, `time`, `notes`) are mapped into structured medication fields.
- Legacy change/note rows are normalized.
- Legacy read-only links with `#share=` payloads are still supported.

## Sharing Presets

Sharing is link-scoped (front-end token metadata) with role presets:

- `Family View`: daily-focused, sensitive/private text hidden by default
- `Clinician View`: daily + clinical views, journal hidden by default
- `Full Read-Only`: all read-only views and content visible

Per-link toggles are configurable before link creation:

- sensitive notes
- journal text
- libido/sexual side effects
- substance-use notes
- free-text notes

Each link can also set allowed views (`daily`, `clinical`, `personal`) and optional expiry date.

### Revoke + Access Logs

- Revoke disables the link on this device context.
- Access logging tracks `last opened` and `total opens` where feasible via local browser storage (`medication_tracker_access_logs_v1`).

## MOA Content Templates

MOA fields are editable per medication in the Medication Detail modal:

- Simple explanation bullets
- Technical explanation
- Dose adjustment interpretation (acute + longer-term)
- Monitoring and clinician questions

To pre-seed default MOA patterns globally, update the seed medication objects in `buildSeedState()` in `/Users/brad/Documents/New project/bradckennedy/app.js`.

## Change Interpretation Card Generation

Interpretation cards are generated from `generateInterpretationTemplate()` in `/Users/brad/Documents/New project/bradckennedy/app.js`.

When logging a change:

1. Enter medication + old/new dose + reason
2. Click `Apply template` (or use auto-filled draft)
3. Edit each section as needed
4. Save change

Saved cards remain editable later from the Medication Change Log.

## Seed Example Data Included

Default seeded data includes:

- 3 medications (Vyvanse, Clonidine, Quetiapine)
- 4 medication change events
- multiple effects notes
- 7 daily check-ins

