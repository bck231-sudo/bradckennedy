import {
  ADHERENCE_STATUS,
  applyDoseAction,
  buildDoseState,
  createDoseOccurrenceId,
  getLocalDateKey,
  normalizeAdherenceStatus,
  parseDoseOccurrenceId
} from "./dose-actions.js";
import {
  RISK_LEVEL_META,
  computeRiskAssessment,
  defaultActionPlans,
  defaultRiskConfig,
  defaultWarningSigns,
  normalizeActionPlans,
  normalizeRiskConfig,
  normalizeWarningSigns
} from "./risk-engine.js";
import { createStorageService } from "./storage-service.js";

const STORAGE_KEY = "medication_tracker_data_v1";
const DRAFT_KEY = "medication_tracker_drafts_v2";
const ACCESS_LOG_KEY = "medication_tracker_access_logs_v1";
const SYNC_CONFIG_KEY = "medication_tracker_sync_config_v1";
const REMINDER_LOG_KEY = "medication_tracker_reminder_log_v1";
const SYNC_QUEUE_KEY = "medication_tracker_sync_queue_v1";
const PROFILE_PATCH_KEY = "medication_tracker_profile_patch_2026_02_21_v1";
const APP_VERSION = 3;
const DOSE_SNOOZE_MINUTES = 30;
const REMOTE_SYNC_DEBOUNCE_MS = 800;
const DASHBOARD_DOSE_PAGE_SIZE = 8;
const PRODUCTION_SYNC_ENDPOINT = "https://medication-tracker-api.onrender.com";
const LOCAL_ONLY_MODE = false;
const SUMMARY_RANGE_OPTIONS = ["7", "14", "30"];
const storage = createStorageService(typeof window !== "undefined" ? window.localStorage : null);

const SIDE_EFFECT_OPTIONS = [
  "headache",
  "nausea",
  "insomnia",
  "fatigue",
  "dizziness",
  "dry mouth",
  "appetite change",
  "increased heart rate",
  "sexual side effects",
  "other"
];

const COMMON_MEDICATION_NAMES = [
  "Fluvoxamine",
  "Vyvanse",
  "Clonidine",
  "Quetiapine",
  "Clonazepam",
  "Atenolol",
  "Sertraline",
  "Escitalopram",
  "Fluoxetine",
  "Mirtazapine",
  "Lamotrigine"
];

const SCHEDULE_PRESETS = {
  am: { label: "AM", times: ["08:00"] },
  pm: { label: "PM", times: ["20:00"] },
  bid: { label: "BID (twice daily)", times: ["08:00", "20:00"] },
  tid: { label: "TID (three times daily)", times: ["08:00", "13:00", "20:00"] },
  prn: { label: "PRN / as needed", times: [] },
  custom: { label: "Custom", times: [] },
  // Legacy aliases kept for backwards compatibility with older saved data.
  once_morning: { label: "AM", times: ["08:00"] },
  once_evening: { label: "PM", times: ["20:00"] },
  twice_daily: { label: "BID (twice daily)", times: ["08:00", "20:00"] }
};

const SCHEDULE_PRESET_ORDER = ["am", "pm", "bid", "tid", "prn", "custom"];

const VIEWER_MODE_OPTIONS = {
  my: { label: "Owner", shortLabel: "Owner" },
  clinician: { label: "Clinician", shortLabel: "Clinician" },
  family: { label: "Family", shortLabel: "Family" },
  preview_link: { label: "Shared Preview", shortLabel: "Shared Preview" }
};
const VIEWER_MODE_ORDER = ["my", "family", "clinician", "preview_link"];

const VIEWER_BADGES = {
  owner: "Owner View (Editable)",
  clinician: "Clinician View (Read-only)",
  family: "Family View (Simplified)",
  preview_link: "Shared Preview (Read-only)",
  share: "Shared Link View (Read-only)"
};

const MOBILE_TABS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "home",
    primarySection: "dashboard",
    fallbackSections: [],
    preferredModes: ["daily", "clinical", "personal"]
  },
  {
    id: "medications",
    label: "Medications",
    icon: "capsule",
    primarySection: "medications",
    fallbackSections: ["dashboard"],
    preferredModes: ["daily", "clinical", "personal"]
  },
  {
    id: "history",
    label: "History",
    icon: "chart",
    primarySection: "timeline",
    fallbackSections: ["changes"],
    preferredModes: ["clinical", "personal"]
  },
  {
    id: "share",
    label: "Share",
    icon: "share",
    primarySection: "sharing",
    fallbackSections: ["exports"],
    preferredModes: ["clinical", "personal"]
  },
  {
    id: "settings",
    label: "Settings",
    icon: "plus",
    primarySection: "exports",
    fallbackSections: ["sharing"],
    preferredModes: ["personal", "clinical"]
  }
];

const TOP_NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "home",
    primarySection: "dashboard",
    fallbackSections: [],
    preferredModes: ["daily", "clinical", "personal"]
  },
  {
    id: "history",
    label: "History",
    icon: "chart",
    primarySection: "timeline",
    fallbackSections: ["changes"],
    preferredModes: ["clinical", "personal"]
  },
  {
    id: "settings",
    label: "Settings",
    icon: "plus",
    primarySection: "exports",
    fallbackSections: ["sharing"],
    preferredModes: ["personal", "clinical"]
  },
  {
    id: "share",
    label: "Share",
    icon: "share",
    primarySection: "sharing",
    fallbackSections: ["exports"],
    preferredModes: ["clinical", "personal"]
  }
];

const OWNER_PERMISSIONS = Object.freeze({
  showSensitiveNotes: true,
  showSensitiveTags: true,
  showJournalText: true,
  showLibido: true,
  showSubstance: true,
  showFreeText: true
});

const SENSITIVE_TAG_KEYWORDS = ["sensitive", "journal", "libido", "sexual", "substance", "private"];
const TARGET_MEDICATION_KEYS = ["fluvoxamine", "clonazepam", "vyvanse", "lisdexamfetamine"];
const CHART_COLORS = Object.freeze({
  mood: "#1f7b90",
  anxiety: "#a86a2a",
  focus: "#3659a8",
  sleep: "#516ebf",
  sideEffects: "#2f7cbf",
  adherence: "#1c8f67",
  doseChangeMarker: "#b2782f",
  grid: "#dde6ef",
  axis: "#d4dee9",
  label: "#5d7087"
});

const PRESETS = {
  family: {
    label: "Family View",
    defaultModes: ["daily"],
    permissions: {
      showSensitiveNotes: false,
      showSensitiveTags: false,
      showJournalText: false,
      showLibido: false,
      showSubstance: false,
      showFreeText: false
    }
  },
  clinician: {
    label: "Clinician View",
    defaultModes: ["daily", "clinical"],
    permissions: {
      showSensitiveNotes: true,
      showSensitiveTags: true,
      showJournalText: false,
      showLibido: true,
      showSubstance: true,
      showFreeText: true
    }
  },
  full: {
    label: "Full Read-Only",
    defaultModes: ["daily", "clinical", "personal"],
    permissions: {
      showSensitiveNotes: true,
      showSensitiveTags: true,
      showJournalText: true,
      showLibido: true,
      showSubstance: true,
      showFreeText: true
    }
  }
};

const AUTH_ROLE_TO_PRESET = Object.freeze({
  owner: "full",
  viewer: "full",
  family: "family",
  clinician: "clinician"
});

const VIEW_MODE_META = {
  daily: {
    label: "Daily View",
    description: "Family-friendly daily summary and adherence"
  },
  clinical: {
    label: "Clinical View",
    description: "Medication details, interpretation, trends, and exports"
  },
  personal: {
    label: "Personal View",
    description: "Full detail including private notes"
  }
};

const SECTION_META = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "home",
    title: "Dashboard",
    subtitle: "Today’s priorities, changes, trends, and sharing status.",
    viewModes: ["daily", "clinical", "personal"]
  },
  {
    id: "medications",
    label: "Current Medications",
    icon: "capsule",
    title: "Current Medications",
    subtitle: "Medication list with dose, schedule, and detail pages.",
    viewModes: ["daily", "clinical", "personal"]
  },
  {
    id: "changes",
    label: "Medication Changes",
    icon: "syringe",
    title: "Medication Change Log",
    subtitle: "What changed, why, and interpretation cards.",
    viewModes: ["clinical", "personal"]
  },
  {
    id: "checkins",
    label: "Wellbeing Check-ins",
    icon: "heart",
    title: "Daily Wellbeing Check-ins",
    subtitle: "Structured daily symptom and wellbeing tracking.",
    viewModes: ["daily", "clinical", "personal"]
  },
  {
    id: "notes",
    label: "Effects Notes",
    icon: "note",
    title: "Effects and Side Effects Notes",
    subtitle: "Detailed notes across effects, side effects, and personal observations.",
    viewModes: ["clinical", "personal"]
  },
  {
    id: "timeline",
    label: "Charts & Timeline",
    icon: "chart",
    title: "Charts and Timeline",
    subtitle: "Trends over time with medication change markers.",
    viewModes: ["clinical", "personal"]
  },
  {
    id: "entry",
    label: "Add Entries",
    icon: "plus",
    title: "Add Entry Workflows",
    subtitle: "Separate structured workflows for clean data capture.",
    viewModes: ["daily", "clinical", "personal"],
    ownerOnly: true
  },
  {
    id: "sharing",
    label: "Sharing",
    icon: "share",
    title: "Sharing and Permissions",
    subtitle: "Create and manage read-only links with role presets.",
    viewModes: ["clinical", "personal"],
    ownerOnly: true
  },
  {
    id: "exports",
    label: "Exports",
    icon: "download",
    title: "Exports",
    subtitle: "Clinician summary and backup exports.",
    viewModes: ["clinical", "personal"]
  }
];

const ICON_SVG_PATHS = Object.freeze({
  home: `<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13V10.5"/>`,
  capsule: `<path d="m10.5 20.5-7-7a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8 8 8 8"/>`,
  syringe: `<path d="m18 3 3 3"/><path d="m16.5 7.5 3-3"/><path d="m11 13 6-6"/><path d="m4.5 19.5 6-6"/><path d="m3 22 2.5-2.5"/><path d="m13.5 10.5 4 4"/>`,
  heart: `<path d="m12 20-1.2-1.1C6 14.6 3 11.8 3 8.5A4.5 4.5 0 0 1 7.5 4 5 5 0 0 1 12 6.3 5 5 0 0 1 16.5 4 4.5 4.5 0 0 1 21 8.5c0 3.3-3 6.1-7.8 10.4Z"/>`,
  note: `<path d="M6 3h9l5 5v13H6z"/><path d="M15 3v5h5"/><path d="M9 13h8"/><path d="M9 17h6"/>`,
  chart: `<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 14 3-3 3 2 4-5"/>`,
  plus: `<circle cx="12" cy="12" r="9"/><path d="M12 8v8"/><path d="M8 12h8"/>`,
  share: `<path d="M15 8a3 3 0 1 0-2.8-4h-.4A3 3 0 0 0 9 8c0 .3 0 .6.1.9l-4 2.3a3 3 0 1 0 1.4 2.6c0-.3 0-.6-.1-.9l4-2.3A3 3 0 0 0 12 11c1.2 0 2.2-.6 2.8-1.5l4.2 2.4a3 3 0 1 0 .9-1.5L15.5 8z"/>`,
  download: `<path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M4 20h16"/>`,
  bell: `<path d="M15 17h5l-1.5-1.5a2 2 0 0 1-.5-1.3V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.5 1.3L4 17h5"/><path d="M9.5 17a2.5 2.5 0 0 0 5 0"/>`,
  pulse: `<path d="M3 12h4l2.3-4 4.2 8 2.2-4H21"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`
});

const dom = {
  topNavLinks: document.getElementById("topNavLinks"),
  viewerModeSegment: document.getElementById("viewerModeSegment"),
  viewerModeSelect: document.getElementById("viewerModeSelect"),
  viewModeSelect: document.getElementById("viewModeSelect"),
  previewLinkControl: document.getElementById("previewLinkControl"),
  previewLinkSelect: document.getElementById("previewLinkSelect"),
  sectionNav: document.getElementById("sectionNav"),
  contextPill: document.getElementById("contextPill"),
  sectionTitle: document.getElementById("sectionTitle"),
  sectionSubtitle: document.getElementById("sectionSubtitle"),
  roleBadge: document.getElementById("roleBadge"),
  quickCheckinButton: document.getElementById("quickCheckinButton"),
  readOnlyBanner: document.getElementById("readOnlyBanner"),
  offlineBanner: document.getElementById("offlineBanner"),
  globalStatus: document.getElementById("globalStatus"),
  toastStack: document.getElementById("toastStack"),
  initialSkeleton: document.getElementById("initialSkeleton"),
  utilityPanel: document.getElementById("utilityPanel"),
  mobileNav: document.getElementById("mobileNav"),
  commonMedicationNames: document.getElementById("commonMedicationNames"),
  medicationModal: document.getElementById("medicationModal"),
  medicationModalBody: document.getElementById("medicationModalBody"),
  closeMedicationModal: document.getElementById("closeMedicationModal"),
  sections: {
    dashboard: document.getElementById("section-dashboard"),
    medications: document.getElementById("section-medications"),
    changes: document.getElementById("section-changes"),
    checkins: document.getElementById("section-checkins"),
    notes: document.getElementById("section-notes"),
    timeline: document.getElementById("section-timeline"),
    entry: document.getElementById("section-entry"),
    sharing: document.getElementById("section-sharing"),
    exports: document.getElementById("section-exports")
  }
};

const app = {
  ownerData: loadOwnerData(),
  shareSession: parseSharePayload(),
  drafts: loadDrafts(),
  accessLogs: loadAccessLogs(),
  syncConfig: loadSyncConfig(),
  reminderLog: loadReminderLog(),
  ui: {
    viewerMode: "my",
    activeViewMode: "daily",
    previewLinkId: "",
    activeSection: "dashboard",
    entryWorkflow: "medication",
    comparisonChangeId: "",
    pendingDoseActions: new Set(),
    lastDraftSavedAt: "",
    hasRendered: false,
    dashboardDoseView: "cards",
    dashboardDoseFilter: "all",
    dashboardDosePage: 1,
    dashboardDoseSearch: "",
    dashboardEdits: {
      summary: false,
      alerts: false,
      changes: false,
      medications: false,
      actionPlan: false
    },
    dashboardTrendView: "simple",
    dashboardTrendRangeDays: "7",
    exportSummaryRangeDays: "14",
    timelineFilters: {
      medicationId: "all",
      rangeDays: "14",
      fromDate: "",
      toDate: ""
    }
  },
  statusTimeout: null,
  doseUndoTimeout: null,
  lastDoseUndo: null,
  syncDebounceTimeout: null,
  reminderIntervalId: null,
  syncQueue: loadSyncQueue(),
  sync: {
    status: "local-only",
    lastSyncedAt: "",
    lastError: "",
    inFlight: false
  },
  cloud: {
    invites: [],
    audit: [],
    notifications: [],
    loaded: false
  },
  queueRemoteSync: () => {}
};

window.__medicationTrackerApp = app;

const inviteTokenFromHash = parseInviteTokenFromHash();
if (inviteTokenFromHash && !app.shareSession) {
  app.drafts.cloudInviteToken = inviteTokenFromHash;
  app.ui.activeSection = "sharing";
  app.ui.activeViewMode = "clinical";
}

if (app.shareSession) {
  handleShareSessionInit();
}

hydrateMedicationNameOptions();
bindGlobalHandlers();
bindShareHashListener();
app.queueRemoteSync = scheduleRemoteSync;
renderAll();
initializeBackgroundServices();
void registerPwaServiceWorker();

function loadOwnerData() {
  const raw = storage.readText(STORAGE_KEY, "");
  if (!raw) {
    const seeded = buildSeedState();
    const patched = applyMedicationProfilePatch(seeded);
    saveOwnerData(patched);
    return patched;
  }

  try {
    const parsed = JSON.parse(raw);
    const migrated = migrateToV2(parsed);
    const patched = applyMedicationProfilePatch(migrated);
    saveOwnerData(patched);
    return patched;
  } catch (_error) {
    const fallback = buildSeedState();
    const patched = applyMedicationProfilePatch(fallback);
    saveOwnerData(patched);
    return patched;
  }
}

function saveOwnerData(nextData, options = {}) {
  const payload = ensureStateShape(nextData);
  if (!options.keepTimestamp) {
    payload.stateUpdatedAt = isoDateTime(new Date());
  }
  storage.writeJson(STORAGE_KEY, payload);
  if (!options.skipRemote && typeof window !== "undefined") {
    const runtimeApp = window.__medicationTrackerApp;
    if (runtimeApp && canUseRemoteSync()) {
      queueSyncMutation(options.reason || "state_update");
    }
    queueMicrotask(() => {
      const runtimeApp = window.__medicationTrackerApp;
      if (runtimeApp && typeof runtimeApp.queueRemoteSync === "function") {
        runtimeApp.queueRemoteSync();
      }
    });
  }
  return payload;
}

function buildSeedState() {
  return ensureStateShape({
    version: APP_VERSION,
    stateUpdatedAt: isoDateTime(new Date()),
    medications: [],
    changes: [],
    notes: [],
    checkins: [],
    adherence: [],
    doseSnoozes: [],
    reminderSettings: {
      enabled: false,
      leadMinutes: 15,
      desktopNotifications: false,
      riskAlertsEnabled: true,
      riskAlertsMinLevel: "elevated"
    },
    shareLinks: [],
    profile: defaultOwnerProfile(),
    dashboardConfig: defaultDashboardConfig(),
    warningSigns: defaultWarningSigns(),
    riskConfig: defaultRiskConfig(),
    actionPlans: defaultActionPlans()
  });
}

function applyMedicationProfilePatch(inputState) {
  const state = ensureStateShape(inputState);
  if (storage.readText(PROFILE_PATCH_KEY, "")) {
    return state;
  }

  const now = new Date();
  const nowIso = isoDateTime(now);
  const today = isoDate(now);

  upsertMedicationFromProfile(state, {
    name: "Fluvoxamine",
    genericName: "fluvoxamine",
    currentDose: "100 mg daily",
    schedulePreset: "custom",
    scheduleTimes: [],
    route: "oral",
    indication: "Reduced under psychiatrist Theo with plan to discontinue due to interaction/enzyme profile concerns.",
    monitor: "Reduction sequence reported as 200 mg -> 150 mg -> 100 mg. Discuss taper pace and interaction implications with prescriber.",
    questions: "Needs confirmation: exact dates for each dose reduction step.",
    needsConfirmation: true,
    confirmationNotes: "Needs confirmation: exact timeline dates for 200 mg -> 150 mg -> 100 mg reduction."
  }, nowIso, today);

  upsertMedicationFromProfile(state, {
    name: "Clonazepam",
    genericName: "clonazepam",
    currentDose: "2 mg per day",
    schedulePreset: "am",
    scheduleTimes: ["08:00"],
    route: "oral",
    indication: "Current scheduled dose reported as 2 mg daily at 8am.",
    monitor: "Maintain timing consistency and review effects with prescriber.",
    questions: "",
    needsConfirmation: false,
    confirmationNotes: ""
  }, nowIso, today);

  upsertMedicationFromProfile(state, {
    name: "Vyvanse",
    genericName: "lisdexamfetamine",
    currentDose: "70 mg/day split (40 mg at 8am + 30 mg at 2pm)",
    schedulePreset: "custom",
    scheduleTimes: ["08:00", "14:00"],
    route: "oral",
    indication: "Current dose reported as 70 mg/day split dosing.",
    monitor: "Dose under review/approval discussion above 70 mg PBS-covered range; do not treat as approved unless confirmed.",
    questions: "Needs confirmation: conflicting values reported (70 mg/day split vs prior mention of 100 mg/day; possible plan/request for 120 mg).",
    needsConfirmation: true,
    confirmationNotes: "Needs confirmation: conflicting reported values are 70 mg/day split, prior mention of 100 mg/day, and possible 120 mg plan/request."
  }, nowIso, today);

  upsertNoteFromProfile(state, {
    date: today,
    noteType: "free_text",
    severity: "moderate",
    noteText: "Recent medication changes summary: Fluvoxamine reduced 200 mg -> 150 mg -> 100 mg over time; psychiatrist intent is taper/discontinue due to interaction profile; Vyvanse dose is under review/approval discussion for dose above 70 mg PBS-covered range (not confirmed as approved).",
    tags: ["medication-summary", "Needs confirmation"],
    isSensitive: false
  }, nowIso);

  storage.writeText(PROFILE_PATCH_KEY, nowIso);
  return state;
}

function upsertMedicationFromProfile(state, values, nowIso, today) {
  const key = normalizeMedicationKey(values.name);
  const existing = state.medications.find((med) => {
    const medKey = normalizeMedicationKey(med.name);
    const genericKey = normalizeMedicationKey(med.genericName);
    return medKey === key || genericKey === key;
  });

  if (existing) {
    existing.name = values.name;
    existing.genericName = values.genericName || existing.genericName || "";
    existing.route = values.route || existing.route || "oral";
    existing.currentDose = values.currentDose;
    existing.schedulePreset = normalizeSchedulePresetValue(values.schedulePreset || existing.schedulePreset || "custom");
    existing.scheduleTimes = normalizeTimes(values.scheduleTimes || existing.scheduleTimes || []);
    existing.startDate = existing.startDate || today;
    existing.indication = values.indication || existing.indication || "";
    existing.monitor = values.monitor || existing.monitor || "";
    existing.questions = values.questions || existing.questions || "";
    existing.active = true;
    existing.needsConfirmation = Boolean(values.needsConfirmation);
    existing.confirmationNotes = values.confirmationNotes || "";
    existing.updatedAt = nowIso;
    return;
  }

  state.medications.push({
    id: uid(),
    name: values.name,
    genericName: values.genericName || "",
    brandName: "",
    route: values.route || "oral",
    currentDose: values.currentDose,
    schedulePreset: normalizeSchedulePresetValue(values.schedulePreset || "custom"),
    scheduleTimes: normalizeTimes(values.scheduleTimes || []),
    startDate: today,
    indication: values.indication || "",
    moaSimple: [],
    moaTechnical: "",
    timeCourseNotes: "",
    adjustmentAcute: "",
    adjustmentChronic: "",
    interactionsNotes: "",
    contraindicationsNotes: "",
    commonSideEffects: "",
    monitor: values.monitor || "",
    questions: values.questions || "",
    active: true,
    needsConfirmation: Boolean(values.needsConfirmation),
    confirmationNotes: values.confirmationNotes || "",
    createdAt: nowIso,
    updatedAt: nowIso
  });
}

function upsertNoteFromProfile(state, values, nowIso) {
  const exists = state.notes.some((note) => normalizeMedicationKey(note.noteText || "") === normalizeMedicationKey(values.noteText || ""));
  if (exists) {
    return;
  }
  state.notes.push({
    id: uid(),
    date: values.date,
    medicationId: "",
    medicationName: "",
    noteType: values.noteType || "free_text",
    severity: values.severity || "moderate",
    checklist: [],
    tags: Array.isArray(values.tags) ? values.tags : [],
    noteText: values.noteText || "",
    trainingNotes: "",
    isSensitive: Boolean(values.isSensitive),
    createdAt: nowIso
  });
}

function createSeedChange(medication, date, oldDose, newDose, reason) {
  return {
    id: uid(),
    medicationId: medication.id,
    medicationName: medication.name,
    date,
    oldDose,
    newDose,
    reason,
    interpretation: generateInterpretationTemplate({ medicationName: medication.name, oldDose, newDose, reason }),
    createdAt: isoDateTime(new Date())
  };
}

function createSeedCheckin(date, values) {
  return {
    id: uid(),
    date,
    mood: values.mood,
    anxiety: values.anxiety,
    focus: values.focus,
    sleepHours: values.sleepHours,
    sleepQuality: values.sleepQuality,
    appetite: values.appetite,
    energy: values.energy,
    irritability: values.irritability,
    cravingsImpulsivity: values.cravingsImpulsivity,
    sideEffectsChecklist: [],
    sideEffectsText: "",
    trainingNotes: "",
    vitals: {
      weight: "",
      bpSystolic: "",
      bpDiastolic: "",
      hr: ""
    },
    createdAt: isoDateTime(new Date())
  };
}

function migrateToV2(input) {
  if (!input || typeof input !== "object") {
    return buildSeedState();
  }

  if (input.version === APP_VERSION) {
    return ensureStateShape(input);
  }

  const now = isoDateTime(new Date());
  const migrated = {
    version: APP_VERSION,
    stateUpdatedAt: input.stateUpdatedAt || now,
    medications: [],
    changes: [],
    notes: [],
    checkins: [],
    adherence: [],
    doseSnoozes: [],
    reminderSettings: normalizeReminderSettings(input.reminderSettings),
    shareLinks: [],
    profile: normalizeOwnerProfile(input.profile),
    dashboardConfig: normalizeDashboardConfig(input.dashboardConfig),
    warningSigns: normalizeWarningSigns(input.warningSigns),
    riskConfig: normalizeRiskConfig(input.riskConfig),
    actionPlans: normalizeActionPlans(input.actionPlans)
  };

  // Compatibility layer for older versions where dose/time lived directly on medication rows.
  for (const med of Array.isArray(input.medications) ? input.medications : []) {
    migrated.medications.push({
      id: med.id || uid(),
      name: med.name || "Unnamed medication",
      genericName: med.genericName || "",
      brandName: med.brandName || "",
      route: med.route || "oral",
      currentDose: med.currentDose || med.dose || "",
      schedulePreset: normalizeSchedulePresetValue(med.schedulePreset || "custom"),
      scheduleTimes: normalizeTimes(med.scheduleTimes || (med.time ? [med.time] : [])),
      startDate: med.startDate || isoDate(new Date()),
      indication: med.indication || med.notes || "",
      moaSimple: Array.isArray(med.moaSimple) ? med.moaSimple : [],
      moaTechnical: med.moaTechnical || "",
      timeCourseNotes: med.timeCourseNotes || "",
      adjustmentAcute: med.adjustmentAcute || "",
      adjustmentChronic: med.adjustmentChronic || "",
      interactionsNotes: med.interactionsNotes || "",
      contraindicationsNotes: med.contraindicationsNotes || "",
      commonSideEffects: med.commonSideEffects || "",
      monitor: med.monitor || "",
      questions: med.questions || "",
      needsConfirmation: Boolean(med.needsConfirmation),
      confirmationNotes: med.confirmationNotes || "",
      active: med.status ? med.status === "active" : med.active !== false,
      createdAt: med.createdAt || now,
      updatedAt: med.updatedAt || med.createdAt || now
    });
  }

  for (const change of Array.isArray(input.changes) ? input.changes : []) {
    migrated.changes.push({
      id: change.id || uid(),
      medicationId: change.medicationId || "",
      medicationName: change.medicationName || change.medication || "",
      date: change.date || isoDate(new Date()),
      oldDose: change.oldDose || extractOldDose(change.change || ""),
      newDose: change.newDose || extractNewDose(change.change || ""),
      reason: change.reason || "",
      reasonForChange: change.reasonForChange || change.reason || "",
      route: change.route || "",
      changedBy: change.changedBy || "self",
      expectedEffects: change.expectedEffects || "",
      monitorFor: change.monitorFor || "",
      reviewDate: change.reviewDate || "",
      notes: change.notes || "",
      interpretation: normalizeInterpretation(
        change.interpretation ||
          generateInterpretationTemplate({
            medicationName: change.medicationName || change.medication || "Medication",
            oldDose: change.oldDose || "previous dose",
            newDose: change.newDose || change.change || "updated dose",
            reason: change.reason || "Clinical review"
          })
      ),
      createdAt: change.createdAt || now
    });
  }

  for (const note of Array.isArray(input.notes) ? input.notes : []) {
    migrated.notes.push({
      id: note.id || uid(),
      date: note.date || isoDate(new Date()),
      medicationId: note.medicationId || "",
      medicationName: note.medicationName || note.medication || "",
      noteType: note.noteType || note.type || "effect",
      severity: note.severity || "moderate",
      checklist: Array.isArray(note.checklist) ? note.checklist : [],
      tags: Array.isArray(note.tags) ? note.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
      noteText: note.noteText || note.note || "",
      trainingNotes: note.trainingNotes || "",
      isSensitive: Boolean(note.isSensitive || note.noteType === "journal") || note.type === "journal",
      createdAt: note.createdAt || now
    });
  }

  for (const checkin of Array.isArray(input.checkins) ? input.checkins : []) {
    migrated.checkins.push(normalizeCheckin(checkin));
  }

  for (const adherence of Array.isArray(input.adherence) ? input.adherence : []) {
    migrated.adherence.push(normalizeAdherence(adherence));
  }

  for (const snooze of Array.isArray(input.doseSnoozes) ? input.doseSnoozes : []) {
    const normalized = normalizeDoseSnooze(snooze);
    if (normalized) {
      migrated.doseSnoozes.push(normalized);
    }
  }

  for (const link of Array.isArray(input.shareLinks) ? input.shareLinks : []) {
    const token = link.token || tokenFromUrl(link.url) || uid();
    migrated.shareLinks.push({
      id: link.id || uid(),
      name: link.name || "Shared viewer",
      email: link.email || "",
      preset: link.preset || "full",
      permissions: normalizePermissions(link.permissions || PRESETS.full.permissions),
      allowedModes: normalizeAllowedModes(link.allowedModes || PRESETS.full.defaultModes),
      expiresAt: link.expiresAt || "",
      revoked: Boolean(link.revoked),
      createdAt: link.createdAt || now,
      token,
      url: link.url || "",
      lastOpenedAt: link.lastOpenedAt || "",
      totalOpens: Number(link.totalOpens || 0)
    });
  }

  return ensureStateShape(migrated);
}

function ensureStateShape(input) {
  const state = {
    version: APP_VERSION,
    stateUpdatedAt: input.stateUpdatedAt || isoDateTime(new Date()),
    medications: [],
    changes: [],
    notes: [],
    checkins: [],
    adherence: [],
    doseSnoozes: [],
    reminderSettings: normalizeReminderSettings(input.reminderSettings),
    shareLinks: [],
    profile: normalizeOwnerProfile(input.profile),
    dashboardConfig: normalizeDashboardConfig(input.dashboardConfig),
    warningSigns: normalizeWarningSigns(input.warningSigns),
    riskConfig: normalizeRiskConfig(input.riskConfig),
    actionPlans: normalizeActionPlans(input.actionPlans)
  };

  for (const med of Array.isArray(input.medications) ? input.medications : []) {
    state.medications.push({
      id: med.id || uid(),
      name: med.name || "Unnamed medication",
      genericName: med.genericName || "",
      brandName: med.brandName || "",
      route: med.route || "oral",
      currentDose: med.currentDose || "",
      schedulePreset: normalizeSchedulePresetValue(med.schedulePreset || "custom"),
      scheduleTimes: normalizeTimes(med.scheduleTimes || []),
      startDate: med.startDate || isoDate(new Date()),
      indication: med.indication || "",
      moaSimple: Array.isArray(med.moaSimple) ? med.moaSimple.filter(Boolean) : [],
      moaTechnical: med.moaTechnical || "",
      timeCourseNotes: med.timeCourseNotes || "",
      adjustmentAcute: med.adjustmentAcute || "",
      adjustmentChronic: med.adjustmentChronic || "",
      interactionsNotes: med.interactionsNotes || "",
      contraindicationsNotes: med.contraindicationsNotes || "",
      commonSideEffects: med.commonSideEffects || "",
      monitor: med.monitor || "",
      questions: med.questions || "",
      needsConfirmation: Boolean(med.needsConfirmation),
      confirmationNotes: med.confirmationNotes || "",
      active: med.active !== false,
      createdAt: med.createdAt || isoDateTime(new Date()),
      updatedAt: med.updatedAt || med.createdAt || isoDateTime(new Date())
    });
  }

  for (const change of Array.isArray(input.changes) ? input.changes : []) {
    state.changes.push({
      id: change.id || uid(),
      medicationId: change.medicationId || "",
      medicationName: change.medicationName || "",
      date: change.date || isoDate(new Date()),
      oldDose: change.oldDose || "",
      newDose: change.newDose || "",
      reason: change.reason || "",
      reasonForChange: change.reasonForChange || change.reason || "",
      route: change.route || "",
      changedBy: change.changedBy || "self",
      expectedEffects: change.expectedEffects || "",
      monitorFor: change.monitorFor || "",
      reviewDate: change.reviewDate || "",
      notes: change.notes || "",
      interpretation: normalizeInterpretation(change.interpretation || {}),
      createdAt: change.createdAt || isoDateTime(new Date())
    });
  }

  for (const note of Array.isArray(input.notes) ? input.notes : []) {
    state.notes.push({
      id: note.id || uid(),
      date: note.date || isoDate(new Date()),
      medicationId: note.medicationId || "",
      medicationName: note.medicationName || "",
      noteType: note.noteType || "effect",
      severity: note.severity || "moderate",
      checklist: Array.isArray(note.checklist) ? note.checklist : [],
      tags: Array.isArray(note.tags) ? note.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
      noteText: note.noteText || "",
      trainingNotes: note.trainingNotes || "",
      isSensitive: Boolean(note.isSensitive),
      createdAt: note.createdAt || isoDateTime(new Date())
    });
  }

  for (const checkin of Array.isArray(input.checkins) ? input.checkins : []) {
    state.checkins.push(normalizeCheckin(checkin));
  }

  for (const adherence of Array.isArray(input.adherence) ? input.adherence : []) {
    state.adherence.push(normalizeAdherence(adherence));
  }

  for (const snooze of Array.isArray(input.doseSnoozes) ? input.doseSnoozes : []) {
    const normalized = normalizeDoseSnooze(snooze);
    if (normalized) {
      state.doseSnoozes.push(normalized);
    }
  }

  for (const link of Array.isArray(input.shareLinks) ? input.shareLinks : []) {
    state.shareLinks.push({
      id: link.id || uid(),
      name: link.name || "Shared viewer",
      email: link.email || "",
      preset: link.preset || "full",
      permissions: normalizePermissions(link.permissions || PRESETS.full.permissions),
      allowedModes: normalizeAllowedModes(link.allowedModes || PRESETS.full.defaultModes),
      expiresAt: link.expiresAt || "",
      revoked: Boolean(link.revoked),
      createdAt: link.createdAt || isoDateTime(new Date()),
      token: link.token || uid(),
      url: link.url || "",
      lastOpenedAt: link.lastOpenedAt || "",
      totalOpens: Number(link.totalOpens || 0)
    });
  }

  return state;
}

function normalizeCheckin(input) {
  const vitals = input?.vitals || {};
  const createdAt = input?.createdAt || isoDateTime(new Date());
  return {
    id: input?.id || uid(),
    date: input?.date || isoDate(new Date()),
    mood: clampNumber(input?.mood, 1, 10),
    anxiety: clampNumber(input?.anxiety, 1, 10),
    focus: clampNumber(input?.focus, 1, 10),
    sleepHours: clampDecimal(input?.sleepHours, 0, 24),
    sleepQuality: clampNumber(input?.sleepQuality, 1, 10),
    appetite: clampNumber(input?.appetite, 1, 10),
    energy: clampNumber(input?.energy, 1, 10),
    irritability: clampNumber(input?.irritability, 1, 10),
    cravingsImpulsivity: clampNumber(input?.cravingsImpulsivity, 1, 10),
    sideEffectsChecklist: Array.isArray(input?.sideEffectsChecklist) ? input.sideEffectsChecklist : [],
    sideEffectsText: input?.sideEffectsText || "",
    trainingNotes: input?.trainingNotes || "",
    vitals: {
      weight: vitals.weight || "",
      bpSystolic: vitals.bpSystolic || "",
      bpDiastolic: vitals.bpDiastolic || "",
      hr: vitals.hr || ""
    },
    createdAt,
    updatedAt: input?.updatedAt || createdAt
  };
}

function normalizeAdherence(input) {
  const dateKey = input?.date || getLocalDateKey(new Date());
  const medicationId = input?.medicationId || "";
  const scheduleTime = input?.scheduleTime || "";
  const occurrenceId = input?.occurrenceId || (medicationId && scheduleTime ? createDoseOccurrenceId(dateKey, medicationId, scheduleTime) : input?.id || uid());
  return {
    id: input?.id || occurrenceId,
    occurrenceId,
    date: dateKey,
    medicationId,
    medicationName: input?.medicationName || "",
    scheduleTime,
    status: normalizeAdherenceStatus(input?.status),
    actionAt: input?.actionAt || input?.updatedAt || input?.createdAt || "",
    takenAt: input?.takenAt || "",
    skippedAt: input?.skippedAt || "",
    createdAt: input?.createdAt || isoDateTime(new Date()),
    updatedAt: input?.updatedAt || input?.createdAt || isoDateTime(new Date())
  };
}

function normalizeDoseSnooze(input) {
  const occurrenceId = String(input?.occurrenceId || "").trim();
  if (!occurrenceId) return null;
  const untilAt = String(input?.untilAt || "").trim();
  const parsed = new Date(untilAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    occurrenceId,
    untilAt: parsed.toISOString(),
    createdAt: input?.createdAt || isoDateTime(new Date())
  };
}

function normalizeReminderSettings(input) {
  const source = input || {};
  const leadMinutes = Number(source.leadMinutes);
  const minLevel = String(source.riskAlertsMinLevel || "elevated").toLowerCase();
  return {
    enabled: Boolean(source.enabled),
    leadMinutes: Number.isFinite(leadMinutes) ? Math.min(120, Math.max(0, Math.round(leadMinutes))) : 15,
    desktopNotifications: Boolean(source.desktopNotifications),
    riskAlertsEnabled: source.riskAlertsEnabled !== false,
    riskAlertsMinLevel: ["watch", "elevated", "high"].includes(minLevel) ? minLevel : "elevated"
  };
}

function normalizeInterpretation(input) {
  return {
    shortTerm: input.shortTerm || "May shift in the first 1-7 days; monitor day-to-day variability.",
    longTerm: input.longTerm || "May evolve over 2-6 weeks as effects stabilize.",
    monitor: input.monitor || "Track mood, anxiety, focus, sleep, appetite, and side effects.",
    improvement: input.improvement || "Potential markers may include steadier focus, calmer mood, and improved routine consistency.",
    deterioration: input.deterioration || "Potential markers may include worsening anxiety, sleep disruption, or functional decline.",
    uncertainty: input.uncertainty || "Individual response can vary; interpretation should be reviewed with the prescribing clinician."
  };
}

function normalizePermissions(input) {
  const source = input || {};
  return {
    showSensitiveNotes: Boolean(source.showSensitiveNotes),
    showSensitiveTags: Boolean(source.showSensitiveTags),
    showJournalText: Boolean(source.showJournalText),
    showLibido: Boolean(source.showLibido),
    showSubstance: Boolean(source.showSubstance),
    showFreeText: Boolean(source.showFreeText)
  };
}

function normalizeAllowedModes(input) {
  const incoming = Array.isArray(input) ? input : [];
  const allowed = incoming.filter((mode) => ["daily", "clinical", "personal"].includes(mode));
  return allowed.length ? allowed : ["daily", "clinical", "personal"];
}

function normalizeTimes(times) {
  return Array.from(new Set((Array.isArray(times) ? times : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)))
    .sort();
}

function normalizeSchedulePresetValue(preset) {
  const incoming = String(preset || "").trim();
  if (incoming === "once_morning") return "am";
  if (incoming === "once_evening") return "pm";
  if (incoming === "twice_daily") return "bid";
  if (SCHEDULE_PRESET_ORDER.includes(incoming)) return incoming;
  return "custom";
}

function parseSharePayload() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#share=")) {
    return null;
  }

  try {
    const encoded = decodeURIComponent(hash.slice("#share=".length));
    const decoded = decodeURIComponent(escape(atob(encoded)));
    const payload = JSON.parse(decoded);

    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (payload.version === 2 && payload.snapshot) {
      return {
        version: 2,
        linkId: payload.linkId || "",
        token: payload.token || "",
        recipient: payload.recipient || { name: "Shared viewer", email: "" },
        preset: payload.preset || "full",
        permissions: normalizePermissions(payload.permissions || PRESETS.full.permissions),
        allowedModes: normalizeAllowedModes(payload.allowedModes || PRESETS.full.defaultModes),
        expiresAt: payload.expiresAt || "",
        createdAt: payload.createdAt || isoDateTime(new Date()),
        snapshot: ensureStateShape(migrateToV2(payload.snapshot))
      };
    }

    // Legacy share links from older builds.
    if (payload.data && typeof payload.data === "object") {
      const migratedData = migrateToV2(payload.data);
      return {
        version: payload.version || 1,
        linkId: payload.linkId || "",
        token: payload.token || "",
        recipient: payload.recipient || { name: "Shared viewer", email: "" },
        preset: "full",
        permissions: normalizePermissions(PRESETS.full.permissions),
        allowedModes: ["daily", "clinical", "personal"],
        expiresAt: "",
        createdAt: payload.createdAt || isoDateTime(new Date()),
        snapshot: ensureStateShape(migratedData)
      };
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function parseInviteTokenFromHash() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#invite=")) return "";
  try {
    return decodeURIComponent(hash.slice("#invite=".length)).trim();
  } catch (_error) {
    return "";
  }
}

function handleShareSessionInit() {
  const token = app.shareSession.token;
  if (token) {
    recordAccess(token);
  }

  if (app.shareSession.expiresAt) {
    const expiry = new Date(app.shareSession.expiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
      app.shareSession.blockedReason = "This shared link has expired.";
    }
  }

  if (token) {
    const localLink = app.ownerData.shareLinks.find((entry) => entry.token === token);
    if (localLink && localLink.revoked) {
      app.shareSession.blockedReason = "This shared link has been revoked on this device.";
    }
  }

  app.ui.viewerMode = "my";
  app.ui.activeViewMode = app.shareSession.allowedModes[0] || "daily";
  app.ui.activeSection = "dashboard";
}

function loadDrafts() {
  const raw = storage.readText(DRAFT_KEY, "");
  if (!raw) {
    return {
      medication: {},
      change: {},
      note: {},
      checkin: {}
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      medication: parsed.medication || {},
      change: parsed.change || {},
      note: parsed.note || {},
      checkin: parsed.checkin || {}
    };
  } catch (_error) {
    return {
      medication: {},
      change: {},
      note: {},
      checkin: {}
    };
  }
}

function saveDrafts() {
  storage.writeJson(DRAFT_KEY, app.drafts);
  app.ui.lastDraftSavedAt = isoDateTime(new Date());
}

function defaultOwnerProfile() {
  return {
    displayName: "",
    personalizationEnabled: true
  };
}

function normalizeOwnerProfile(input) {
  return {
    displayName: String(input?.displayName || "").trim(),
    personalizationEnabled: input?.personalizationEnabled !== false
  };
}

function defaultDashboardConfig() {
  return {
    summaryNote: "",
    monitoringReminders: []
  };
}

function normalizeDashboardConfig(input) {
  const defaults = defaultDashboardConfig();
  const reminders = Array.isArray(input?.monitoringReminders)
    ? input.monitoringReminders.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
    : defaults.monitoringReminders;

  return {
    summaryNote: String(input?.summaryNote || "").trim(),
    monitoringReminders: reminders
  };
}

function defaultSyncConfig() {
  return {
    enabled: false,
    endpoint: LOCAL_ONLY_MODE ? "" : inferDefaultSyncEndpoint(),
    accountId: "default",
    ownerKey: "",
    authToken: "",
    authRole: "",
    authUser: null
  };
}

function inferDefaultSyncEndpoint() {
  if (LOCAL_ONLY_MODE) return "";
  if (typeof window === "undefined") return "";
  const meta = document.querySelector("meta[name='mt-sync-endpoint']")?.getAttribute("content")?.trim();
  if (meta) return meta;
  const host = String(window.location.hostname || "").toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return window.location.origin;
  }
  if (host.endsWith(".onrender.com")) {
    return window.location.origin;
  }
  if (host === "bradckennedy.org" || host === "www.bradckennedy.org") {
    return PRODUCTION_SYNC_ENDPOINT;
  }
  return "";
}

function loadSyncConfig() {
  const defaults = defaultSyncConfig();
  if (LOCAL_ONLY_MODE) return defaults;
  const raw = storage.readText(SYNC_CONFIG_KEY, "");
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      endpoint: String(parsed.endpoint || defaults.endpoint || "").trim(),
      accountId: String(parsed.accountId || "default").trim() || "default",
      ownerKey: String(parsed.ownerKey || ""),
      authToken: String(parsed.authToken || ""),
      authRole: String(parsed.authRole || "").trim().toLowerCase(),
      authUser: parsed.authUser && typeof parsed.authUser === "object"
        ? {
            id: String(parsed.authUser.id || ""),
            email: String(parsed.authUser.email || ""),
            name: String(parsed.authUser.name || "")
          }
        : null
    };
  } catch (_error) {
    return defaults;
  }
}

function saveSyncConfig() {
  storage.writeJson(SYNC_CONFIG_KEY, app.syncConfig);
}

function hasCloudSession() {
  return Boolean(String(app.syncConfig.authToken || "").trim());
}

function authRolePresetKey(role) {
  return AUTH_ROLE_TO_PRESET[String(role || "").toLowerCase()] || "full";
}

function applyCloudAuthSession(payload) {
  const token = String(payload?.token || "").trim();
  if (!token) {
    throw new Error("Missing auth token.");
  }
  app.syncConfig = {
    ...app.syncConfig,
    authToken: token,
    authRole: String(payload?.role || "").trim().toLowerCase(),
    accountId: String(payload?.accountId || app.syncConfig.accountId || "default").trim() || "default",
    authUser: payload?.user && typeof payload.user === "object"
      ? {
          id: String(payload.user.id || ""),
          email: String(payload.user.email || ""),
          name: String(payload.user.name || "")
        }
      : null,
    enabled: true
  };
  if (app.syncConfig.authRole && app.syncConfig.authRole !== "owner") {
    clearSyncQueue();
  }
  app.cloud.loaded = false;
  saveSyncConfig();
}

function clearCloudAuthSession() {
  app.syncConfig = {
    ...app.syncConfig,
    authToken: "",
    authRole: "",
    authUser: null
  };
  app.cloud.loaded = false;
  saveSyncConfig();
}

function loadReminderLog() {
  const raw = storage.readText(REMINDER_LOG_KEY, "");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function saveReminderLog() {
  storage.writeJson(REMINDER_LOG_KEY, app.reminderLog);
}

function loadAccessLogs() {
  const raw = storage.readText(ACCESS_LOG_KEY, "");
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

function saveAccessLogs() {
  storage.writeJson(ACCESS_LOG_KEY, app.accessLogs);
}

function loadSyncQueue() {
  const queue = storage.readJson(SYNC_QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

function saveSyncQueue() {
  storage.writeJson(SYNC_QUEUE_KEY, app.syncQueue || []);
}

function queueSyncMutation(reason = "state_update") {
  const next = Array.isArray(app.syncQueue) ? app.syncQueue.slice(-120) : [];
  next.push({
    id: uid(),
    reason,
    createdAt: isoDateTime(new Date())
  });
  app.syncQueue = next;
  saveSyncQueue();
  updateConnectivityBanner();
}

function clearSyncQueue() {
  app.syncQueue = [];
  saveSyncQueue();
  updateConnectivityBanner();
}

function recordAccess(token) {
  if (!token) return;

  const current = app.accessLogs[token] || {
    totalOpens: 0,
    lastOpenedAt: ""
  };

  current.totalOpens += 1;
  current.lastOpenedAt = isoDateTime(new Date());
  app.accessLogs[token] = current;
  saveAccessLogs();

  const match = app.ownerData.shareLinks.find((entry) => entry.token === token);
  if (match) {
    match.lastOpenedAt = current.lastOpenedAt;
    match.totalOpens = current.totalOpens;
    saveOwnerData(app.ownerData);
  }

  if (!app.shareSession && canUseRemoteSync()) {
    void postShareAccessEvent(token);
  }
}

function getActiveContext() {
  if (app.shareSession) {
    return {
      type: "share",
      label: app.shareSession.recipient?.name || "Shared viewer",
      readOnly: true,
      permissions: app.shareSession.permissions,
      allowedModes: app.shareSession.allowedModes,
      blockedReason: app.shareSession.blockedReason || "",
      expiresAt: app.shareSession.expiresAt || "",
      preset: app.shareSession.preset || "full"
    };
  }

  if (app.ui.viewerMode === "preview_link") {
    const links = app.ownerData.shareLinks.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!links.length) {
      return {
        type: "preview",
        label: "Preview Shared Link",
        readOnly: true,
        permissions: normalizePermissions(PRESETS.family.permissions),
        allowedModes: normalizeAllowedModes(PRESETS.family.defaultModes),
        blockedReason: "No shared links available to preview yet.",
        expiresAt: "",
        preset: "family"
      };
    }

    const selected = links.find((entry) => entry.id === app.ui.previewLinkId) || links[0];
    app.ui.previewLinkId = selected.id;
    const expired = selected.expiresAt && new Date(selected.expiresAt).getTime() < Date.now();

    return {
      type: "preview",
      label: `Preview Shared Link: ${selected.name}`,
      readOnly: true,
      permissions: normalizePermissions(selected.permissions || PRESETS.full.permissions),
      allowedModes: normalizeAllowedModes(selected.allowedModes || PRESETS.full.defaultModes),
      blockedReason: selected.revoked ? "This link is revoked." : expired ? "This link is expired." : "",
      expiresAt: selected.expiresAt || "",
      preset: selected.preset || "full",
      selectedLinkId: selected.id
    };
  }

  if (app.ui.viewerMode === "clinician" || app.ui.viewerMode === "family") {
    const preset = PRESETS[app.ui.viewerMode];
    return {
      type: "preview",
      label: `${preset.label} preview`,
      readOnly: true,
      permissions: normalizePermissions(preset.permissions),
      allowedModes: normalizeAllowedModes(preset.defaultModes),
      blockedReason: "",
      expiresAt: "",
      preset: app.ui.viewerMode
    };
  }

  const authRole = String(app.syncConfig.authRole || "").toLowerCase();
  if (hasCloudSession() && authRole && authRole !== "owner") {
    const presetKey = authRolePresetKey(authRole);
    const preset = PRESETS[presetKey] || PRESETS.full;
    return {
      type: "authenticated_viewer",
      label: `${authRole === "clinician" ? "Clinician" : authRole === "family" ? "Family" : "Viewer"} account`,
      readOnly: true,
      permissions: normalizePermissions(preset.permissions),
      allowedModes: normalizeAllowedModes(preset.defaultModes),
      blockedReason: "",
      expiresAt: "",
      preset: presetKey
    };
  }

  return {
    type: "owner",
    label: "Owner View",
    readOnly: false,
    permissions: normalizePermissions(OWNER_PERMISSIONS),
    allowedModes: ["daily", "clinical", "personal"],
    blockedReason: "",
    expiresAt: "",
    preset: "my"
  };
}

function getSourceData() {
  if (app.shareSession) {
    return app.shareSession.snapshot;
  }
  return app.ownerData;
}

function getVisibleData() {
  const context = getActiveContext();
  const source = deepClone(getSourceData());

  if (!context.permissions.showSensitiveTags) {
    source.notes = source.notes.map((note) => ({
      ...note,
      tags: Array.isArray(note.tags)
        ? note.tags.filter((tag) => !SENSITIVE_TAG_KEYWORDS.some((keyword) => String(tag || "").toLowerCase().includes(keyword)))
        : []
    }));
  }

  const filteredNotes = source.notes.filter((note) => {
    if (!context.permissions.showSensitiveNotes && note.isSensitive) return false;
    if (!context.permissions.showJournalText && note.noteType === "journal") return false;
    if (!context.permissions.showLibido && note.noteType === "libido") return false;
    if (!context.permissions.showSubstance && note.noteType === "substance") return false;
    if (!context.permissions.showFreeText && note.noteType === "free_text") return false;
    return true;
  });

  source.notes = filteredNotes;

  if (!context.permissions.showFreeText) {
    source.notes = source.notes.map((note) => ({
      ...note,
      noteText: note.noteText ? "[Hidden by link settings]" : "",
      trainingNotes: note.trainingNotes ? "[Hidden by link settings]" : ""
    }));

    source.checkins = source.checkins.map((checkin) => ({
      ...checkin,
      sideEffectsText: checkin.sideEffectsText ? "[Hidden by link settings]" : "",
      trainingNotes: checkin.trainingNotes ? "[Hidden by link settings]" : ""
    }));
  }

  if (!context.permissions.showSensitiveNotes) {
    source.checkins = source.checkins.map((checkin) => ({
      ...checkin,
      cravingsImpulsivity: "hidden"
    }));
  }

  return source;
}

function hydrateMedicationNameOptions() {
  const names = new Set(COMMON_MEDICATION_NAMES);
  for (const med of app.ownerData.medications) {
    names.add(med.name);
  }

  dom.commonMedicationNames.innerHTML = Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function bindGlobalHandlers() {
  dom.viewerModeSelect.addEventListener("change", (event) => {
    app.ui.viewerMode = event.target.value;
    if (app.ui.viewerMode !== "preview_link") {
      app.ui.previewLinkId = "";
    }
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.viewModeSelect.addEventListener("change", (event) => {
    app.ui.activeViewMode = event.target.value;
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.previewLinkSelect.addEventListener("change", (event) => {
    app.ui.viewerMode = "preview_link";
    app.ui.previewLinkId = event.target.value;
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.quickCheckinButton.addEventListener("click", () => {
    if (getActiveContext().readOnly) return;
    app.ui.activeSection = "entry";
    app.ui.entryWorkflow = "checkin";
    renderAll();
  });

  dom.closeMedicationModal.addEventListener("click", closeMedicationModal);
  dom.medicationModal.addEventListener("click", (event) => {
    if (event.target === dom.medicationModal) {
      closeMedicationModal();
    }
  });

  window.addEventListener("online", () => {
    updateConnectivityBanner();
    if (canUseRemoteSync() && app.syncQueue.length) {
      scheduleRemoteSync();
    }
  });

  window.addEventListener("offline", () => {
    updateConnectivityBanner();
  });
}

function bindShareHashListener() {
  window.addEventListener("hashchange", () => {
    app.shareSession = parseSharePayload();
    const inviteToken = parseInviteTokenFromHash();
    if (inviteToken) {
      app.drafts.cloudInviteToken = inviteToken;
      app.ui.activeSection = "sharing";
      app.ui.activeViewMode = "clinical";
    }
    if (app.shareSession) {
      handleShareSessionInit();
    } else {
      app.ui.viewerMode = "my";
    }
    restartReminderLoop();
    ensureSectionForCurrentMode();
    renderAll();
  });
}

function initializeBackgroundServices() {
  updateConnectivityBanner();
  if (app.shareSession) return;
  if (canUseRemoteSync()) {
    if (hasCloudSession() || app.syncConfig.ownerKey) {
      void pullRemoteStateOnBoot();
      void refreshCloudSideData();
      if (app.syncQueue.length) {
        scheduleRemoteSync();
      }
    } else {
      app.sync.status = "auth-required";
      app.sync.lastError = "Sign in to enable cloud sync.";
    }
  } else {
    app.sync.status = "local-only";
  }
  restartReminderLoop();
}

async function registerPwaServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
}

function updateConnectivityBanner() {
  if (!dom.offlineBanner) return;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (!offline) {
    dom.offlineBanner.classList.add("hidden");
    dom.offlineBanner.textContent = "";
    return;
  }
  const pendingSync = canUseRemoteSync() ? app.syncQueue.length : 0;
  dom.offlineBanner.classList.remove("hidden");
  dom.offlineBanner.textContent = pendingSync
    ? `Offline mode active. ${pendingSync} change${pendingSync === 1 ? "" : "s"} queued for sync when connection returns.`
    : "Offline mode active. Changes will continue saving locally.";
}

function canUseRemoteSync() {
  if (LOCAL_ONLY_MODE) return false;
  return Boolean(app.syncConfig.enabled && String(app.syncConfig.endpoint || "").trim());
}

function normalizedApiBase() {
  if (LOCAL_ONLY_MODE) return "";
  return String(app.syncConfig.endpoint || "").trim().replace(/\/+$/, "");
}

function remoteHeaders() {
  const headers = {
    "content-type": "application/json",
    "x-account-id": String(app.syncConfig.accountId || "default")
  };
  if (app.syncConfig.ownerKey) {
    headers["x-owner-key"] = app.syncConfig.ownerKey;
  }
  if (app.syncConfig.authToken) {
    headers.authorization = `Bearer ${app.syncConfig.authToken}`;
  }
  return headers;
}

async function remoteRequest(path, init = {}) {
  const base = normalizedApiBase();
  if (!base) {
    throw new Error("Remote sync endpoint is not configured.");
  }
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...remoteHeaders(),
      ...(init.headers || {})
    }
  });
}

async function postShareAccessEvent(token) {
  try {
    await remoteRequest("/api/share-access", {
      method: "POST",
      body: JSON.stringify({
        token,
        openedAt: isoDateTime(new Date())
      })
    });
  } catch (_error) {
    // Access logging should not block UI.
  }
}

function scheduleRemoteSync() {
  if (!canUseRemoteSync() || app.shareSession) return;
  if (hasCloudSession() && app.syncConfig.authRole && app.syncConfig.authRole !== "owner" && !app.syncConfig.ownerKey) {
    return;
  }
  if (!hasCloudSession() && !app.syncConfig.ownerKey) {
    app.sync.status = "auth-required";
    app.sync.lastError = "Sign in to enable cloud sync.";
    return;
  }
  clearTimeout(app.syncDebounceTimeout);
  app.syncDebounceTimeout = window.setTimeout(() => {
    void flushRemoteSync();
  }, REMOTE_SYNC_DEBOUNCE_MS);
}

async function flushRemoteSync() {
  if (!canUseRemoteSync() || app.shareSession || app.sync.inFlight) return;
  if (hasCloudSession() && app.syncConfig.authRole && app.syncConfig.authRole !== "owner" && !app.syncConfig.ownerKey) {
    return;
  }
  if (!hasCloudSession() && !app.syncConfig.ownerKey) {
    app.sync.status = "auth-required";
    app.sync.lastError = "Sign in to enable cloud sync.";
    renderAll();
    return;
  }
  app.sync.inFlight = true;
  app.sync.status = "syncing";
  renderAll();
  try {
    const payload = ensureStateShape(app.ownerData);
    const response = await remoteRequest("/api/state", {
      method: "PUT",
      body: JSON.stringify({ state: payload })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Sync failed (${response.status})`);
    }
    const result = await response.json().catch(() => ({}));
    app.sync.status = "connected";
    app.sync.lastSyncedAt = result.updatedAt || isoDateTime(new Date());
    app.sync.lastError = "";
    clearSyncQueue();
  } catch (error) {
    app.sync.status = "error";
    app.sync.lastError = error instanceof Error ? error.message : "Unknown sync error";
  } finally {
    app.sync.inFlight = false;
    updateConnectivityBanner();
    renderAll();
  }
}

async function pullRemoteStateOnBoot() {
  if (!canUseRemoteSync() || app.shareSession) return;
  if (!hasCloudSession() && !app.syncConfig.ownerKey) {
    app.sync.status = "auth-required";
    app.sync.lastError = "Sign in to enable cloud sync.";
    renderAll();
    return;
  }
  app.sync.status = "syncing";
  renderAll();
  try {
    const response = await remoteRequest("/api/state", { method: "GET" });
    if (response.status === 404) {
      app.sync.status = "connected";
      app.sync.lastSyncedAt = "";
      app.sync.lastError = "";
      scheduleRemoteSync();
      renderAll();
      return;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Sync fetch failed (${response.status})`);
    }
    const payload = await response.json();
    const remoteState = payload?.state ? ensureStateShape(migrateToV2(payload.state)) : null;
    if (remoteState) {
      const localUpdatedAt = parseSortableDate(app.ownerData.stateUpdatedAt);
      const remoteUpdatedAt = parseSortableDate(remoteState.stateUpdatedAt);
      if (remoteUpdatedAt > localUpdatedAt) {
        app.ownerData = remoteState;
        saveOwnerData(app.ownerData, { skipRemote: true, keepTimestamp: true });
        setStatus("Synced latest data from cloud.");
      } else if (localUpdatedAt > remoteUpdatedAt && (!hasCloudSession() || String(app.syncConfig.authRole || "") === "owner" || app.syncConfig.ownerKey)) {
        scheduleRemoteSync();
      }
    }
    await pullRemoteShareAccess();
    app.sync.status = "connected";
    app.sync.lastSyncedAt = payload?.updatedAt || isoDateTime(new Date());
    app.sync.lastError = "";
  } catch (error) {
    app.sync.status = "error";
    app.sync.lastError = error instanceof Error ? error.message : "Unknown sync error";
  } finally {
    renderAll();
  }
}

async function pullRemoteShareAccess() {
  if (!canUseRemoteSync()) return;
  try {
    const response = await remoteRequest("/api/share-access", { method: "GET" });
    if (!response.ok) return;
    const payload = await response.json();
    const remoteMap = payload?.shareAccess || {};
    for (const [token, access] of Object.entries(remoteMap)) {
      app.accessLogs[token] = {
        totalOpens: Number(access.opens || 0),
        lastOpenedAt: String(access.lastOpenedAt || "")
      };
    }
    saveAccessLogs();
    if (app.ownerData.shareLinks.length) {
      for (const link of app.ownerData.shareLinks) {
        const access = app.accessLogs[link.token];
        if (!access) continue;
        link.totalOpens = access.totalOpens;
        link.lastOpenedAt = access.lastOpenedAt;
      }
      saveOwnerData(app.ownerData, { skipRemote: true, keepTimestamp: true });
    }
  } catch (_error) {
    // Optional enrichment only.
  }
}

async function cloudRegisterOwner(payload) {
  const response = await remoteRequest("/api/auth/register-owner", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Owner registration failed (${response.status})`);
  }
  applyCloudAuthSession(json);
  return json;
}

async function cloudLogin(payload) {
  const response = await remoteRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Sign in failed (${response.status})`);
  }
  applyCloudAuthSession(json);
  return json;
}

async function cloudAcceptInvite(payload) {
  const response = await remoteRequest("/api/auth/invites/accept", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Invite acceptance failed (${response.status})`);
  }
  applyCloudAuthSession(json);
  return json;
}

async function cloudLogout() {
  if (!hasCloudSession()) return;
  try {
    await remoteRequest("/api/auth/logout", { method: "POST" });
  } catch (_error) {
    // Ignore logout API errors and clear local session anyway.
  }
  clearCloudAuthSession();
}

async function cloudFetchMe() {
  if (!hasCloudSession()) return null;
  const response = await remoteRequest("/api/auth/me", { method: "GET" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearCloudAuthSession();
    }
    throw new Error(json.error || `Could not load cloud profile (${response.status})`);
  }
  app.syncConfig = {
    ...app.syncConfig,
    accountId: String(json.accountId || app.syncConfig.accountId || "default"),
    authRole: String(json.role || app.syncConfig.authRole || "").toLowerCase(),
    authUser: json.user && typeof json.user === "object"
      ? {
          id: String(json.user.id || ""),
          email: String(json.user.email || ""),
          name: String(json.user.name || "")
        }
      : app.syncConfig.authUser
  };
  saveSyncConfig();
  return json;
}

async function cloudCreateInvite(payload) {
  const response = await remoteRequest("/api/auth/invites", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Invite creation failed (${response.status})`);
  }
  return json;
}

async function cloudListInvites() {
  const response = await remoteRequest("/api/auth/invites", { method: "GET" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Could not load invites (${response.status})`);
  }
  app.cloud.invites = Array.isArray(json.invites) ? json.invites : [];
  return app.cloud.invites;
}

async function cloudRevokeInvite(inviteId) {
  const response = await remoteRequest("/api/auth/invites/revoke", {
    method: "POST",
    body: JSON.stringify({ inviteId })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Could not revoke invite (${response.status})`);
  }
  return json;
}

async function cloudLoadAudit(limit = 80) {
  const response = await remoteRequest(`/api/audit?limit=${encodeURIComponent(String(limit))}`, { method: "GET" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Could not load audit log (${response.status})`);
  }
  app.cloud.audit = Array.isArray(json.audit) ? json.audit : [];
  return app.cloud.audit;
}

async function cloudLoadNotifications() {
  const response = await remoteRequest("/api/notifications", { method: "GET" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Could not load notifications (${response.status})`);
  }
  app.cloud.notifications = Array.isArray(json.notifications) ? json.notifications : [];
  return app.cloud.notifications;
}

async function cloudPostRiskNotification(payload) {
  if (!hasCloudSession()) return;
  try {
    await remoteRequest("/api/notifications/risk", {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
  } catch (_error) {
    // Notifications are optional and should not block user flow.
  }
}

async function refreshCloudSideData() {
  if (!hasCloudSession()) {
    app.cloud.invites = [];
    app.cloud.audit = [];
    app.cloud.notifications = [];
    app.cloud.loaded = false;
    return;
  }
  try {
    await cloudFetchMe();
  } catch (_error) {
    return;
  }

  if (String(app.syncConfig.authRole || "") === "owner") {
    await Promise.allSettled([
      cloudListInvites(),
      cloudLoadAudit(),
      cloudLoadNotifications()
    ]);
  } else {
    app.cloud.invites = [];
    app.cloud.audit = [];
    await Promise.allSettled([cloudLoadNotifications()]);
  }
  app.cloud.loaded = true;
}

function restartReminderLoop() {
  if (app.reminderIntervalId) {
    window.clearInterval(app.reminderIntervalId);
    app.reminderIntervalId = null;
  }
  const settings = normalizeReminderSettings(app.ownerData.reminderSettings);
  if ((!settings.enabled && !settings.riskAlertsEnabled) || app.shareSession) return;
  app.reminderIntervalId = window.setInterval(() => {
    runReminderSweep();
    runRiskAlertSweep();
  }, 60 * 1000);
  runReminderSweep();
  runRiskAlertSweep();
}

function runReminderSweep() {
  const settings = normalizeReminderSettings(app.ownerData.reminderSettings);
  if (!settings.enabled || app.shareSession) return;
  const leadMinutes = Number(settings.leadMinutes || 0);
  const now = new Date();
  const today = getLocalDateKey(now);
  let reminderLogChanged = false;
  for (const [key, value] of Object.entries(app.reminderLog)) {
    if (!value?.date) continue;
    if (value.date < shiftDateKey(today, -7)) {
      delete app.reminderLog[key];
      reminderLogChanged = true;
    }
  }
  if (reminderLogChanged) {
    saveReminderLog();
  }
  const activeMeds = resolveCurrentMedications(app.ownerData).filter((med) => med.isCurrent);
  const dueState = getDoseState(activeMeds, app.ownerData.adherence, app.ownerData.doseSnoozes);
  const candidates = [...dueState.dueNow, ...dueState.next].filter((item) => {
    const scheduled = parseDateTime(today, item.time);
    const diffMinutes = (scheduled.getTime() - now.getTime()) / 60000;
    return diffMinutes <= leadMinutes;
  });

  for (const item of candidates) {
    const log = app.reminderLog[item.occurrenceId];
    if (log?.date === today) continue;
    const scheduled = parseDateTime(today, item.time);
    const diffMinutes = Math.round((scheduled.getTime() - now.getTime()) / 60000);
    const message = diffMinutes <= 0
      ? `Dose due now: ${item.medicationName} at ${item.time}`
      : `Dose due in ${diffMinutes}m: ${item.medicationName} at ${item.time}`;

    app.reminderLog[item.occurrenceId] = {
      date: today,
      firedAt: isoDateTime(now)
    };
    saveReminderLog();
    pushToast(message, "success");
    if (settings.desktopNotifications && "Notification" in window && Notification.permission === "granted") {
      new Notification("Medication reminder", { body: message });
    }
  }
}

function runRiskAlertSweep() {
  const settings = normalizeReminderSettings(app.ownerData.reminderSettings);
  if (!settings.riskAlertsEnabled || app.shareSession) return;

  const meds = resolveCurrentMedications(app.ownerData).filter((med) => med.isCurrent);
  const dueState = getDoseState(meds, app.ownerData.adherence, app.ownerData.doseSnoozes);
  const riskAssessment = computeDashboardRisk(app.ownerData, dueState);
  if (riskLevelRank(riskAssessment.level) < riskLevelRank(settings.riskAlertsMinLevel)) return;

  const dayKey = getLocalDateKey(new Date());
  const alertKey = `risk:${dayKey}:${riskAssessment.level}`;
  if (app.reminderLog[alertKey]) return;

  const reasonSummary = riskAssessment.reasons[0] || "Multiple warning signs triggered.";
  const message = `Risk status ${riskAssessment.label}: ${reasonSummary}`;
  app.reminderLog[alertKey] = {
    date: dayKey,
    firedAt: isoDateTime(new Date()),
    level: riskAssessment.level
  };
  saveReminderLog();
  pushToast(message, "success");

  if (settings.desktopNotifications && "Notification" in window && Notification.permission === "granted") {
    new Notification("Risk status update", { body: message });
  }

  void cloudPostRiskNotification({
    level: riskAssessment.level,
    reasons: riskAssessment.reasons.slice(0, 6),
    triggeredAt: isoDateTime(new Date())
  });
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    setStatus("Browser notifications are not supported in this browser.", "error");
    return;
  }
  const permission = await Notification.requestPermission();
  app.ownerData.reminderSettings.desktopNotifications = permission === "granted";
  saveOwnerData(app.ownerData);
  setStatus(permission === "granted" ? "Desktop notifications enabled." : "Notification permission not granted.", permission === "granted" ? "ok" : "error");
  restartReminderLoop();
}

function renderAll() {
  const context = getActiveContext();

  if (!context.allowedModes.includes(app.ui.activeViewMode)) {
    app.ui.activeViewMode = context.allowedModes[0] || "daily";
  }

  const visibleData = getVisibleData();

  renderViewModeSelector(context);
  renderContextElements(context);
  renderNavigation(context);
  renderMobileNav(context);
  renderSectionMeta(context);
  renderSections(context, visibleData);
  renderUtilityPanel(context, visibleData);

  if (!app.ui.hasRendered) {
    app.ui.hasRendered = true;
    document.body.classList.add("app-ready");
    dom.initialSkeleton?.classList.add("hidden");
  }
}

function renderViewModeSelector(context) {
  if (!app.shareSession && context.type === "authenticated_viewer") {
    const role = String(app.syncConfig.authRole || "viewer").toLowerCase();
    const label = role === "clinician" ? "Clinician Account" : role === "family" ? "Family Account" : "Viewer Account";
    dom.viewerModeSelect.innerHTML = `<option value="my">${escapeHtml(label)}</option>`;
    dom.viewerModeSelect.disabled = true;
    dom.viewerModeSegment.innerHTML = `<button type="button" role="tab" aria-selected="true" class="active" disabled>${escapeHtml(label)}</button>`;
    app.ui.viewerMode = "my";
  } else if (!app.shareSession) {
    dom.viewerModeSelect.innerHTML = VIEWER_MODE_ORDER
      .map((value) => `<option value="${value}">${escapeHtml(VIEWER_MODE_OPTIONS[value].label)}</option>`)
      .join("");
    dom.viewerModeSelect.disabled = false;
    dom.viewerModeSelect.value = app.ui.viewerMode;

    dom.viewerModeSegment.innerHTML = VIEWER_MODE_ORDER
      .map((value) => {
        const meta = VIEWER_MODE_OPTIONS[value];
        const active = app.ui.viewerMode === value;
        return `<button type="button" role="tab" aria-selected="${active ? "true" : "false"}" class="${active ? "active" : ""}" data-viewer-mode="${value}" title="${escapeHtml(meta.label)}">${escapeHtml(meta.shortLabel || meta.label)}</button>`;
      })
      .join("");

    dom.viewerModeSegment.querySelectorAll("[data-viewer-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        app.ui.viewerMode = button.dataset.viewerMode || "my";
        if (app.ui.viewerMode !== "preview_link") {
          app.ui.previewLinkId = "";
        }
        ensureSectionForCurrentMode();
        renderAll();
      });
    });
  } else {
    dom.viewerModeSelect.innerHTML = `<option value="share">Shared link view</option>`;
    dom.viewerModeSelect.disabled = true;
    dom.viewerModeSegment.innerHTML = `<button type="button" role="tab" aria-selected="true" class="active" disabled>Shared Link View</button>`;
  }

  const options = context.allowedModes.map((mode) => {
    const meta = VIEW_MODE_META[mode];
    return `<option value="${mode}">${meta.label}</option>`;
  });

  dom.viewModeSelect.innerHTML = options.join("");
  dom.viewModeSelect.value = app.ui.activeViewMode;
}

function renderContextElements(context) {
  dom.contextPill.textContent = resolveContextBadge(context);

  if (!app.shareSession && app.ui.viewerMode === "preview_link") {
    const links = app.ownerData.shareLinks.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    dom.previewLinkControl.classList.remove("hidden");
    dom.previewLinkSelect.innerHTML = links.length
      ? links
          .map((link) => {
            const expired = link.expiresAt && new Date(link.expiresAt).getTime() < Date.now();
            const status = link.revoked ? "revoked" : expired ? "expired" : "active";
            return `<option value="${link.id}">${escapeHtml(link.name)} (${escapeHtml(status)})</option>`;
          })
          .join("")
      : `<option value="">No links available</option>`;
    dom.previewLinkSelect.value = app.ui.previewLinkId || links[0]?.id || "";
    dom.previewLinkSelect.disabled = !links.length;
  } else {
    dom.previewLinkControl.classList.add("hidden");
    dom.previewLinkSelect.innerHTML = "";
  }

  if (context.type === "share") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Read-only access:</strong> Shared for ${escapeHtml(context.label)}.${context.expiresAt ? ` Link expires ${escapeHtml(niceDate(context.expiresAt))}.` : ""}`;
  } else if (context.type === "authenticated_viewer") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Read-only account:</strong> You are signed in with viewer permissions (${escapeHtml(context.label)}).`;
  } else if (context.type === "preview") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Preview mode:</strong> You are previewing ${escapeHtml(context.label)} permissions in read-only mode.`;
  } else {
    dom.readOnlyBanner.classList.add("hidden");
    dom.readOnlyBanner.innerHTML = "";
  }

  if (context.blockedReason) {
    dom.globalStatus.classList.remove("hidden");
    dom.globalStatus.classList.add("error", "context-block");
    dom.globalStatus.textContent = context.blockedReason;
  } else if (dom.globalStatus.classList.contains("context-block")) {
    dom.globalStatus.classList.add("hidden");
    dom.globalStatus.classList.remove("error", "context-block");
    dom.globalStatus.textContent = "";
  }
}

function resolveContextBadge(context) {
  if (context.type === "owner") return VIEWER_BADGES.owner;
  if (context.type === "share") return VIEWER_BADGES.share;
  if (context.type === "authenticated_viewer") return "Account View (Read-only)";
  if (app.ui.viewerMode === "clinician") return VIEWER_BADGES.clinician;
  if (app.ui.viewerMode === "family") return VIEWER_BADGES.family;
  if (app.ui.viewerMode === "preview_link") return VIEWER_BADGES.preview_link;
  return context.label;
}

function ensureSectionForCurrentMode() {
  const context = getActiveContext();
  const sections = availableSections(context, app.ui.activeViewMode);
  if (!sections.find((section) => section.id === app.ui.activeSection)) {
    app.ui.activeSection = sections[0]?.id || "dashboard";
  }
}

function availableSections(context, mode) {
  return SECTION_META.filter((section) => {
    if (!section.viewModes.includes(mode)) return false;
    if (section.ownerOnly && context.readOnly) return false;
    return true;
  });
}

function findModeForSection(context, sectionId, preferredModes = []) {
  const modeCandidates = [...new Set([...preferredModes, ...context.allowedModes])];

  for (const mode of modeCandidates) {
    if (!context.allowedModes.includes(mode)) continue;
    const sections = availableSections(context, mode);
    if (sections.some((section) => section.id === sectionId)) {
      return mode;
    }
  }

  return "";
}

function navigateToSection(sectionId, options = {}) {
  const context = getActiveContext();
  const preferredModes = Array.isArray(options.preferredModes) ? options.preferredModes : [];
  const fallbackSections = Array.isArray(options.fallbackSections) ? options.fallbackSections : [];
  const candidates = [sectionId, ...fallbackSections];

  for (const candidate of candidates) {
    const mode = findModeForSection(context, candidate, preferredModes);
    if (!mode) continue;
    app.ui.activeViewMode = mode;
    app.ui.activeSection = candidate;
    return true;
  }

  const currentSections = availableSections(context, app.ui.activeViewMode);
  app.ui.activeSection = currentSections[0]?.id || "dashboard";
  setStatus("That section is not available in this viewer context.", "error");
  return false;
}

function renderNavigation(context) {
  const sections = availableSections(context, app.ui.activeViewMode);
  if (!sections.find((section) => section.id === app.ui.activeSection)) {
    app.ui.activeSection = sections[0]?.id || "dashboard";
  }

  renderTopNav(sections);

  dom.sectionNav.innerHTML = sections
    .map((section) => {
      const activeClass = section.id === app.ui.activeSection ? "active" : "";
      return `
        <button type="button" class="${activeClass} nav-item" data-section="${section.id}">
          ${renderIcon(section.icon || "home", "nav-icon")}
          <span class="nav-label">${escapeHtml(section.label)}</span>
        </button>
      `;
    })
    .join("");

  dom.sectionNav.querySelectorAll("button[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.activeSection = button.dataset.section;
      renderAll();
    });
  });
}

function renderTopNav(sections) {
  if (!dom.topNavLinks) return;
  const context = getActiveContext();

  dom.topNavLinks.innerHTML = TOP_NAV_ITEMS.map((item) => {
    const allItemSections = [item.primarySection, ...(item.fallbackSections || [])];
    const active = allItemSections.includes(app.ui.activeSection);
    const firstAvailableSection = allItemSections.find((sectionId) => findModeForSection(context, sectionId, item.preferredModes));
    const disabled = !firstAvailableSection;
    return `
      <button
        type="button"
        class="top-nav-link nav-link ${active ? "active" : ""}"
        data-topnav-id="${item.id}"
        aria-label="Open ${escapeHtml(item.label)}"
        ${disabled ? "disabled" : ""}
      >
        ${renderIcon(item.icon || "home", "top-nav-icon")}
        <span>${escapeHtml(item.label)}</span>
      </button>
    `;
  }).join("");

  dom.topNavLinks.querySelectorAll("[data-topnav-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const navId = button.dataset.topnavId || "";
      const item = TOP_NAV_ITEMS.find((entry) => entry.id === navId);
      if (!item) return;
      navigateToSection(item.primarySection, {
        preferredModes: item.preferredModes,
        fallbackSections: item.fallbackSections
      });
      renderAll();
    });
  });
}

function renderMobileNav(context) {
  if (!dom.mobileNav) return;
  dom.mobileNav.innerHTML = MOBILE_TABS.map((tab) => {
    const allTabSections = [tab.primarySection, ...(tab.fallbackSections || [])];
    const active = allTabSections.includes(app.ui.activeSection);
    const enabled = Boolean(findModeForSection(context, tab.primarySection, tab.preferredModes) || (tab.fallbackSections || []).some((sectionId) => findModeForSection(context, sectionId, tab.preferredModes)));
    return `
      <button
        type="button"
        class="${active ? "active" : ""}"
        data-mobile-tab="${tab.id}"
        aria-label="${escapeHtml(tab.label)}"
        ${enabled ? "" : "disabled"}
      >
        ${renderIcon(tab.icon || "home", "mobile-icon")}
        <span>${escapeHtml(tab.label)}</span>
      </button>
    `;
  }).join("");

  dom.mobileNav.querySelectorAll("[data-mobile-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.mobileTab || "";
      const tab = MOBILE_TABS.find((entry) => entry.id === tabId);
      if (!tab) return;
      navigateToSection(tab.primarySection, {
        preferredModes: tab.preferredModes,
        fallbackSections: tab.fallbackSections
      });
      renderAll();
    });
  });
}

function renderUtilityPanel(context, data) {
  if (!dom.utilityPanel) return;
  if (context.blockedReason) {
    dom.utilityPanel.innerHTML = `<div class="utility-section"><h3>Access status</h3><p class="subtle">${escapeHtml(context.blockedReason)}</p></div>`;
    return;
  }

  const meds = resolveCurrentMedications(data).filter((med) => med.isCurrent);
  const dueState = getDoseState(meds, data.adherence, data.doseSnoozes);
  const riskAssessment = computeDashboardRisk(data, dueState);
  const pending = [...dueState.dueNow, ...dueState.next].sort((left, right) => left.time.localeCompare(right.time));
  const nextDose = pending[0] || null;
  const alerts = buildAlerts(data).slice(0, 4);
  const today = getLocalDateKey(new Date());
  const todayCheckin = data.checkins.find((entry) => entry.date === today);

  dom.utilityPanel.innerHTML = `
    <div class="utility-section">
      <h3>Today summary</h3>
      <div class="subtle">Taken ${dueState.counts.taken} · Remaining ${dueState.counts.remaining} · Missed ${dueState.counts.missed}</div>
      <div class="subtle" style="margin-top:8px;">${nextDose ? `Next dose: <strong>${escapeHtml(nextDose.medicationName)}</strong> at ${escapeHtml(nextDose.time)}` : "No scheduled doses remaining for today."}</div>
      <div class="subtle" style="margin-top:8px;">Risk status: <strong>${escapeHtml(riskAssessment.label)}</strong></div>
    </div>

    <div class="utility-section">
      <h3>Quick check-in</h3>
      ${todayCheckin
        ? `<div class="subtle">Completed today · Mood ${todayCheckin.mood}/10 · Anxiety ${todayCheckin.anxiety}/10</div>`
        : `<div class="subtle">Complete your quick check-in (30 seconds).</div>
           ${context.readOnly ? "" : `<button class="btn btn-secondary small" type="button" data-utility-action="checkin">Open check-in</button>`}`}
    </div>

    <div class="utility-section">
      <h3>Alerts</h3>
      ${alerts.length
        ? `<ul class="timeline-list">${alerts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : `<div class="subtle">No active alerts right now.</div>`}
    </div>

    <div class="utility-section">
      <h3>Share status</h3>
      <div class="subtle">${context.readOnly ? "Read-only session active." : `${app.ownerData.shareLinks.length} shared links configured.`}</div>
      ${hasCloudSession() ? `<div class="subtle">Cloud user: ${escapeHtml(app.syncConfig.authUser?.email || app.syncConfig.authUser?.name || "signed in")} (${escapeHtml(app.syncConfig.authRole || "viewer")})</div>` : ""}
      ${context.readOnly ? "" : `<div class="subtle">Sync: ${escapeHtml(
        app.sync.status === "connected"
          ? "Connected"
          : app.sync.status === "syncing"
            ? "Syncing"
            : app.sync.status === "auth-required"
              ? "Sign in required"
              : app.sync.status === "error"
                ? "Error"
                : "Local-only"
      )}</div>`}
      ${context.readOnly ? "" : `<div class="subtle">Reminders: ${app.ownerData.reminderSettings?.enabled ? `On (${app.ownerData.reminderSettings.leadMinutes || 0}m)` : "Off"}</div>`}
      ${hasCloudSession() ? `<button class="btn btn-ghost small" type="button" data-utility-action="cloud-logout">Sign out cloud</button>` : ""}
      ${context.readOnly ? "" : `<button class="btn btn-ghost small" type="button" data-utility-action="sharing">Manage sharing</button>`}
    </div>
  `;

  dom.utilityPanel.querySelectorAll("[data-utility-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.utilityAction;
      if (action === "checkin") {
        app.ui.activeSection = "entry";
        app.ui.entryWorkflow = "checkin";
      }
      if (action === "sharing") {
        app.ui.activeSection = "sharing";
      }
      if (action === "cloud-logout") {
        void (async () => {
          await cloudLogout();
          app.sync.status = "auth-required";
          app.sync.lastError = "Sign in to enable cloud sync.";
          setStatus("Signed out from cloud account.");
          renderAll();
        })();
        return;
      }
      renderAll();
    });
  });
}

function renderSectionMeta(context) {
  const meta = SECTION_META.find((section) => section.id === app.ui.activeSection) || SECTION_META[0];
  dom.sectionTitle.textContent = meta.title;
  dom.sectionSubtitle.textContent = meta.subtitle;
  if (dom.roleBadge) {
    const roleLabel = context.readOnly
      ? context.type === "share"
        ? "Viewer (Shared)"
        : context.type === "authenticated_viewer"
          ? `Viewer (${(app.syncConfig.authRole || "viewer").replace(/^./, (ch) => ch.toUpperCase())})`
          : app.ui.viewerMode === "clinician"
            ? "Viewer (Clinician)"
            : app.ui.viewerMode === "family"
              ? "Viewer (Family)"
              : "Viewer"
      : "Owner";
    dom.roleBadge.textContent = roleLabel;
    dom.roleBadge.className = `role-badge ${context.readOnly ? "is-viewer" : "is-owner"}`;
  }
}

function renderSections(context, visibleData) {
  Object.values(dom.sections).forEach((sectionNode) => {
    sectionNode.classList.add("hidden");
  });

  if (context.blockedReason) {
    return;
  }

  if (app.ui.activeSection === "dashboard") {
    dom.sections.dashboard.classList.remove("hidden");
    renderDashboard(dom.sections.dashboard, visibleData, context);
  }

  if (app.ui.activeSection === "medications") {
    dom.sections.medications.classList.remove("hidden");
    renderMedications(dom.sections.medications, visibleData, context);
  }

  if (app.ui.activeSection === "changes") {
    dom.sections.changes.classList.remove("hidden");
    renderChanges(dom.sections.changes, visibleData, context);
  }

  if (app.ui.activeSection === "checkins") {
    dom.sections.checkins.classList.remove("hidden");
    renderCheckins(dom.sections.checkins, visibleData, context);
  }

  if (app.ui.activeSection === "notes") {
    dom.sections.notes.classList.remove("hidden");
    renderNotes(dom.sections.notes, visibleData);
  }

  if (app.ui.activeSection === "timeline") {
    dom.sections.timeline.classList.remove("hidden");
    renderTimeline(dom.sections.timeline, visibleData, context);
  }

  if (app.ui.activeSection === "entry") {
    dom.sections.entry.classList.remove("hidden");
    renderEntryWorkflows(dom.sections.entry, visibleData, context);
  }

  if (app.ui.activeSection === "sharing") {
    dom.sections.sharing.classList.remove("hidden");
    renderSharing(dom.sections.sharing, visibleData, context);
  }

  if (app.ui.activeSection === "exports") {
    dom.sections.exports.classList.remove("hidden");
    renderExports(dom.sections.exports, visibleData, context);
  }
}

function resolveCurrentMedications(data) {
  const grouped = new Map();

  for (const med of data.medications || []) {
    const key = normalizeMedicationKey(med.name || med.id || uid());
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(med);
  }

  const resolved = [];

  for (const [key, records] of grouped.entries()) {
    const sorted = records.slice().sort((a, b) => medicationSortValue(b) - medicationSortValue(a));
    const activeRecords = sorted.filter((entry) => entry.active);
    const latestRecord = sorted[0];
    const canonical = activeRecords[0] || latestRecord;
    const sourceIds = new Set(sorted.map((entry) => entry.id));

    const latestChange = (data.changes || [])
      .filter((change) => {
        if (change.medicationId && sourceIds.has(change.medicationId)) return true;
        if (change.medicationName && normalizeMedicationKey(change.medicationName) === key) return true;
        return false;
      })
      .sort((a, b) => changeSortValue(b) - changeSortValue(a))[0];

    const fallbackScheduleSource = activeRecords.find((entry) => (entry.scheduleTimes || []).length) || latestRecord;
    const isTargetMedication = isTargetMedicationRecord(canonical);
    resolved.push({
      ...canonical,
      scheduleTimes: normalizeTimes((canonical.scheduleTimes || []).length ? canonical.scheduleTimes : fallbackScheduleSource?.scheduleTimes || []),
      currentDose: latestChange?.newDose || canonical.currentDose || "",
      isCurrent: activeRecords.length > 0,
      isTargetMedication,
      sourceCount: sorted.length,
      latestChangeDate: latestChange?.date || ""
    });
  }

  return resolved.sort((a, b) => {
    if (Number(b.isCurrent) !== Number(a.isCurrent)) return Number(b.isCurrent) - Number(a.isCurrent);
    if (Number(b.isTargetMedication) !== Number(a.isTargetMedication)) return Number(b.isTargetMedication) - Number(a.isTargetMedication);
    return (a.name || "").localeCompare(b.name || "");
  });
}

function isTargetMedicationRecord(medication) {
  const medKey = normalizeMedicationKey(medication?.name);
  const genericKey = normalizeMedicationKey(medication?.genericName);
  return TARGET_MEDICATION_KEYS.includes(medKey) || TARGET_MEDICATION_KEYS.includes(genericKey);
}

function resolveCurrentMedsLastUpdatedDate(data) {
  const resolved = resolveCurrentMedications(data).filter((med) => med.isCurrent);
  const target = resolved.filter((med) => {
    const medKey = normalizeMedicationKey(med.name);
    const genericKey = normalizeMedicationKey(med.genericName);
    return TARGET_MEDICATION_KEYS.includes(medKey) || TARGET_MEDICATION_KEYS.includes(genericKey);
  });
  const source = target.length ? target : resolved;
  const latest = source
    .map((med) => parseSortableDate(med.updatedAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];
  if (!latest) {
    return isoDate(new Date());
  }
  return isoDate(new Date(latest));
}

function renderRecentMedicationSummary() {
  return `
    <ul class="timeline-list">
      <li>Fluvoxamine reduced from 200 mg -> 150 mg -> 100 mg over time.</li>
      <li>Psychiatrist intent: taper/discontinue fluvoxamine due to interaction/enzyme profile concerns.</li>
      <li>Vyvanse dose is under review / approval discussion for dose above 70 mg PBS-covered range. <strong>Needs confirmation</strong> and not listed as approved.</li>
    </ul>
  `;
}

function normalizeMedicationKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function medicationSortValue(medication) {
  return Math.max(
    parseSortableDate(medication.updatedAt),
    parseSortableDate(medication.createdAt),
    parseSortableDate(medication.startDate)
  );
}

function changeSortValue(change) {
  return Math.max(parseSortableDate(change.date), parseSortableDate(change.createdAt));
}

function parseSortableDate(value) {
  if (!value) return 0;
  const raw = String(value);
  const normalized = raw.includes("T") ? raw : `${raw}T12:00:00`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function renderIcon(name, className = "mini-icon", label = "") {
  const icon = ICON_SVG_PATHS[name] || ICON_SVG_PATHS.capsule;
  const aria = label
    ? ` role="img" aria-label="${escapeHtml(label)}"`
    : ` aria-hidden="true"`;
  return `
    <span class="${className}"${aria}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        ${icon}
      </svg>
    </span>
  `;
}

function safeDateFromKey(dateKey) {
  const parsed = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function computeRecentRiskHistory(data, days = 14, referenceDate = new Date()) {
  const timeline = [];
  const totalDays = Math.max(1, Number(days || 14));
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - (totalDays - 1));

  for (let offset = 0; offset < totalDays; offset += 1) {
    const pointDate = new Date(start);
    pointDate.setDate(start.getDate() + offset);
    const dateKey = getLocalDateKey(pointDate);
    const checkins = (data.checkins || []).filter((entry) => String(entry.date || "") <= dateKey);
    const notes = (data.notes || []).filter((entry) => String(entry.date || "") <= dateKey);
    const adherence = (data.adherence || []).filter((entry) => String(entry.date || "") === dateKey);
    const pointRisk = computeRiskAssessment({
      now: pointDate,
      checkins,
      notes,
      adherence,
      dueState: null,
      warningSigns: data.warningSigns,
      riskConfig: data.riskConfig
    });
    timeline.push({
      date: dateKey,
      level: pointRisk.level
    });
  }
  return timeline;
}

function computeDashboardRisk(data, dueState) {
  return computeRiskAssessment({
    now: new Date(),
    checkins: data.checkins || [],
    notes: data.notes || [],
    adherence: data.adherence || [],
    dueState,
    warningSigns: data.warningSigns,
    riskConfig: data.riskConfig
  });
}

function riskToneClass(level) {
  const normalized = String(level || "low").toLowerCase();
  if (normalized === "high") return "risk-high";
  if (normalized === "elevated") return "risk-elevated";
  if (normalized === "watch") return "risk-watch";
  return "risk-low";
}

function renderActionPlanSteps(actionPlans, level) {
  const normalizedPlans = normalizeActionPlans(actionPlans || []);
  return normalizedPlans
    .filter((entry) => entry.enabled && entry.triggerLevel === level)
    .sort((left, right) => left.stepOrder - right.stepOrder);
}

function riskLevelRank(level) {
  const normalized = String(level || "low").toLowerCase();
  if (normalized === "high") return 3;
  if (normalized === "elevated") return 2;
  if (normalized === "watch") return 1;
  return 0;
}

function renderRiskHistoryDots(history = []) {
  const rows = Array.isArray(history) ? history.slice(-14) : [];
  if (!rows.length) return "";
  return `
    <div class="risk-history-dots" aria-label="Risk history last 14 days">
      ${rows.map((entry) => `<span class="risk-dot ${escapeHtml(riskToneClass(entry.level))}" title="${escapeHtml(`${entry.date}: ${(RISK_LEVEL_META[entry.level] || RISK_LEVEL_META.low).label}`)}"></span>`).join("")}
    </div>
  `;
}

function actionPlanLinesByLevel(actionPlans, level) {
  return renderActionPlanSteps(actionPlans, level)
    .map((step) => {
      const rolePrefix = step.notifyRole ? `[${step.notifyRole}] ` : "";
      return `${rolePrefix}${step.stepText}`;
    })
    .join("\n");
}

function parseActionPlanLines(lines, level) {
  return String(lines || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^\[(self|family|clinician|gp|psychiatrist|other)\]\s*/i);
      const notifyRole = match ? String(match[1] || "").toLowerCase() : "";
      const stepText = match ? line.replace(match[0], "").trim() : line;
      return {
        id: uid(),
        triggerLevel: level,
        stepOrder: index + 1,
        stepText,
        notifyRole,
        enabled: true
      };
    })
    .filter((entry) => entry.stepText);
}

function isOverdueDose(item) {
  return String(item?.statusLabel || "").toLowerCase().includes("overdue");
}

function splitPendingDoseGroups(dueState) {
  const overdue = [];
  const dueNow = [];

  for (const item of dueState.dueNow || []) {
    if (isOverdueDose(item)) {
      overdue.push(item);
    } else {
      dueNow.push(item);
    }
  }

  return {
    overdue,
    dueNow,
    upcoming: dueState.next || []
  };
}

function matchesDoseSearch(item, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return true;
  const haystack = `${item.medicationName || ""} ${item.time || ""} ${item.statusLabel || ""}`.toLowerCase();
  return haystack.includes(normalized);
}

function getDashboardDoseItems(groups, filterKey) {
  if (filterKey === "due_now") return groups.dueNow || [];
  if (filterKey === "upcoming") return groups.upcoming || [];
  if (filterKey === "all") return [...(groups.overdue || []), ...(groups.dueNow || []), ...(groups.upcoming || [])];
  return groups.overdue || [];
}

function renderDashboardDoseCards(items, context, medications) {
  const doseByMedicationId = new Map((medications || []).map((med) => [med.id, med.currentDose || "-"]));

  return `
    <div class="dose-card-list">
      ${items.map((item) => {
        const stateClass = isOverdueDose(item)
          ? "is-overdue"
          : String(item.statusLabel || "").toLowerCase().includes("due")
            ? "is-due-now"
            : "is-upcoming";
        const isPending = app.ui.pendingDoseActions.has(item.occurrenceId);
        return `
          <details class="dose-card-item ${stateClass}" ${isOverdueDose(item) ? "open" : ""}>
            <summary>
              <div class="dose-card-main">
                ${renderIcon("capsule", "mini-icon soft", "Medication dose")}
                <div>
                  <strong>${escapeHtml(item.medicationName)}</strong>
                  <div class="subtle">${escapeHtml(doseByMedicationId.get(item.medicationId) || "-")}</div>
                </div>
              </div>
              <div class="dose-card-time">${escapeHtml(item.time)}</div>
            </summary>
            <div class="dose-card-body">
              <div class="dose-card-status">
                <span class="status-chip ${escapeHtml(statusChipClass(item.statusLabel))}">${escapeHtml(item.statusLabel)}</span>
              </div>
              ${context.readOnly ? "" : `
                <div class="inline-row dose-actions-primary">
                  <button class="btn btn-secondary small ${isPending ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.TAKEN}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as taken" ${isPending ? "disabled" : ""}>${isPending ? "Saving" : "Taken"}</button>
                  <button class="btn btn-secondary small ${isPending ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.SKIPPED}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as skipped" ${isPending ? "disabled" : ""}>${isPending ? "Saving" : "Skip"}</button>
                  <button class="btn btn-ghost small" type="button" data-dose-snooze="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" aria-label="Snooze ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)}" ${isPending ? "disabled" : ""}>Snooze</button>
                  <button class="btn btn-ghost small" type="button" data-dose-note="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-medication-name="${escapeHtml(item.medicationName)}" aria-label="Add note for ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)}">Note</button>
                </div>
              `}
            </div>
          </details>
        `;
      }).join("")}
    </div>
  `;
}

function renderDashboardDoseQueue(dueState, context, medications) {
  const groups = splitPendingDoseGroups(dueState);
  const filterOptions = [
    { key: "overdue", label: "Overdue", count: groups.overdue.length },
    { key: "due_now", label: "Due now", count: groups.dueNow.length },
    { key: "upcoming", label: "Upcoming", count: groups.upcoming.length },
    { key: "all", label: "All", count: groups.overdue.length + groups.dueNow.length + groups.upcoming.length }
  ];

  if (!filterOptions.some((item) => item.key === app.ui.dashboardDoseFilter)) {
    app.ui.dashboardDoseFilter = "all";
  }
  if (!["cards", "table"].includes(app.ui.dashboardDoseView)) {
    app.ui.dashboardDoseView = "cards";
  }

  const filteredBase = getDashboardDoseItems(groups, app.ui.dashboardDoseFilter);
  const filtered = filteredBase.filter((item) => matchesDoseSearch(item, app.ui.dashboardDoseSearch));
  const totalPages = Math.max(1, Math.ceil(filtered.length / DASHBOARD_DOSE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, Number(app.ui.dashboardDosePage || 1)), totalPages);
  app.ui.dashboardDosePage = currentPage;
  const start = (currentPage - 1) * DASHBOARD_DOSE_PAGE_SIZE;
  const pagedItems = filtered.slice(start, start + DASHBOARD_DOSE_PAGE_SIZE);

  const emptyMessage = app.ui.dashboardDoseFilter === "overdue"
    ? "No overdue doses right now. Great work staying on track."
    : "No doses match this filter right now.";

  return `
    <div class="dose-queue-controls">
      <div class="chip-group">
        ${filterOptions.map((filter) => `
          <button type="button" class="chip ${app.ui.dashboardDoseFilter === filter.key ? "active" : ""}" data-dashboard-dose-filter="${filter.key}">
            ${escapeHtml(filter.label)} (${filter.count})
          </button>
        `).join("")}
      </div>
      <div class="dose-queue-actions">
        <input
          type="search"
          class="dose-search-input"
          placeholder="Filter by medication or time"
          value="${escapeHtml(app.ui.dashboardDoseSearch)}"
          data-dashboard-dose-search="1"
          aria-label="Filter today's doses"
        >
        <div class="chip-group">
          <button type="button" class="chip ${app.ui.dashboardDoseView === "cards" ? "active" : ""}" data-dashboard-dose-view="cards">Cards</button>
          <button type="button" class="chip ${app.ui.dashboardDoseView === "table" ? "active" : ""}" data-dashboard-dose-view="table">Table</button>
        </div>
      </div>
    </div>
    ${pagedItems.length
      ? app.ui.dashboardDoseView === "table"
        ? renderDoseTable(dueState, context, medications, pagedItems)
        : renderDashboardDoseCards(pagedItems, context, medications)
      : `<div class="empty">${escapeHtml(emptyMessage)}</div>`
    }
    ${filtered.length > DASHBOARD_DOSE_PAGE_SIZE ? `
      <div class="dose-pagination">
        <button class="btn btn-ghost small" type="button" data-dashboard-dose-page="-1" ${currentPage <= 1 ? "disabled" : ""}>Previous</button>
        <span class="subtle">Page ${currentPage} of ${totalPages}</span>
        <button class="btn btn-ghost small" type="button" data-dashboard-dose-page="1" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    ` : ""}
  `;
}

function renderDashboardTrendPreview(data, recentChanges, context) {
  const rangeDays = Number(app.ui.dashboardTrendRangeDays || 7) === 30 ? 30 : 7;
  const sortedCheckins = (data.checkins || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const windowed = sortedCheckins.slice(-rangeDays);

  if (!windowed.length) {
    return `<div class="empty">No wellbeing check-ins yet.${context.readOnly ? "" : ` <button class="btn btn-secondary small" type="button" data-dashboard-checkin="1">Add check-in</button>`}</div>`;
  }

  if (app.ui.dashboardTrendView === "simple") {
    const moodAvg = average(windowed.map((entry) => toNumber(entry.mood)));
    const anxietyAvg = average(windowed.map((entry) => toNumber(entry.anxiety)));
    const focusAvg = average(windowed.map((entry) => toNumber(entry.focus)));
    const sleepAvg = average(windowed.map((entry) => toNumber(entry.sleepHours)));

    return `
      <div class="dashboard-trend-simple">
        <div class="kpi-badge">Mood avg: ${Number.isFinite(moodAvg) ? roundNumber(moodAvg, 1) : "-"}</div>
        <div class="kpi-badge">Anxiety avg: ${Number.isFinite(anxietyAvg) ? roundNumber(anxietyAvg, 1) : "-"}</div>
        <div class="kpi-badge">Focus avg: ${Number.isFinite(focusAvg) ? roundNumber(focusAvg, 1) : "-"}</div>
        <div class="kpi-badge">Sleep avg: ${Number.isFinite(sleepAvg) ? roundNumber(sleepAvg, 1) : "-"}h</div>
      </div>
    `;
  }

  const changeDates = (recentChanges || []).map((change) => change.date).slice(0, 10);
  return renderLineChart(
    [
      {
        label: "Mood",
        color: CHART_COLORS.mood,
        points: windowed.map((entry) => ({ date: entry.date, value: toNumber(entry.mood) }))
      },
      {
        label: "Anxiety",
        color: CHART_COLORS.anxiety,
        points: windowed.map((entry) => ({ date: entry.date, value: toNumber(entry.anxiety) }))
      },
      {
        label: "Focus",
        color: CHART_COLORS.focus,
        points: windowed.map((entry) => ({ date: entry.date, value: toNumber(entry.focus) }))
      }
    ],
    { yMin: 0, yMax: 10, changeDates }
  );
}

function dashboardGreetingLabel(context, profile) {
  if (context.readOnly || !profile.personalizationEnabled) {
    return "Today";
  }
  const hour = new Date().getHours();
  const base = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return profile.displayName ? `${base}, ${profile.displayName}` : base;
}

function computeCheckinStreak(checkins, todayKey) {
  const recordedDates = new Set((checkins || []).map((entry) => String(entry?.date || "")).filter(Boolean));
  let streak = 0;
  let cursor = todayKey;
  while (recordedDates.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

function dashboardConsistencyMessage(data, dueState, todayKey, profile) {
  if (!profile.personalizationEnabled) return "";
  const streak = computeCheckinStreak(data.checkins, todayKey);
  if (streak >= 3) {
    return `You have logged ${streak} check-in days in a row.`;
  }

  const weeklyCheckins = (data.checkins || []).filter((entry) => dateDiffDays(entry.date, todayKey) <= 6).length;
  if (weeklyCheckins >= 5) {
    return `Strong consistency this week: ${weeklyCheckins} check-ins recorded.`;
  }

  if (dueState.counts.remaining === 0 && dueState.counts.taken > 0) {
    return "Nice work completing your scheduled doses today.";
  }

  return "Keep entries short and consistent for cleaner weekly trends.";
}

function renderDashboard(root, data, context) {
  pruneExpiredDoseSnoozes();
  if (!["simple", "visual"].includes(app.ui.dashboardTrendView)) {
    app.ui.dashboardTrendView = "simple";
  }
  if (!["7", "30"].includes(app.ui.dashboardTrendRangeDays)) {
    app.ui.dashboardTrendRangeDays = "7";
  }
  if (!app.ui.dashboardEdits || typeof app.ui.dashboardEdits !== "object") {
    app.ui.dashboardEdits = {
      summary: false,
      alerts: false,
      changes: false,
      medications: false,
      actionPlan: false
    };
  }
  app.ui.dashboardEdits = {
    summary: false,
    alerts: false,
    changes: false,
    medications: false,
    actionPlan: false,
    ...(app.ui.dashboardEdits || {})
  };

  const ownerEditable = context.type === "owner" && !context.readOnly;
  if (!ownerEditable) {
    app.ui.dashboardEdits = {
      summary: false,
      alerts: false,
      changes: false,
      medications: false,
      actionPlan: false
    };
  }

  const dashboardConfig = normalizeDashboardConfig(app.ownerData.dashboardConfig || data.dashboardConfig);
  const summaryNote = dashboardConfig.summaryNote;

  const resolvedMeds = resolveCurrentMedications(data);
  const activeMeds = resolvedMeds.filter((med) => med.isCurrent);
  const currentMedsLastUpdated = resolveCurrentMedsLastUpdatedDate(data);
  const today = getLocalDateKey(new Date());
  const todayCheckin = data.checkins.find((entry) => entry.date === today);
  const latestCheckin = (data.checkins || [])
    .slice()
    .sort((left, right) => changeSortValue(right) - changeSortValue(left))[0] || null;
  const recentChanges = data.changes
    .filter((entry) => dateDiffDays(entry.date, today) <= 14)
    .sort((a, b) => b.date.localeCompare(a.date));

  const dueState = getDoseState(activeMeds, data.adherence, data.doseSnoozes);
  const riskAssessment = computeDashboardRisk(data, dueState);
  const riskHistory = computeRecentRiskHistory(data, 14, new Date());
  const riskTone = riskToneClass(riskAssessment.level);
  const alerts = buildAlerts(data);
  const pendingItems = [...dueState.dueNow, ...dueState.next].sort((left, right) => left.time.localeCompare(right.time));
  const nextDose = pendingItems[0] || null;
  const overdueCount = dueState.dueNow.filter((item) => String(item.statusLabel).toLowerCase().includes("overdue")).length;
  const dashboardAlerts = Array.from(
    new Set([
      ...riskAssessment.reasons.map((reason) => `Risk trigger: ${reason}`),
      ...alerts
    ])
  ).slice(0, 8);
  const topChanges = recentChanges.slice(0, 6);
  const profile = normalizeOwnerProfile(app.ownerData.profile);
  const greetingLabel = dashboardGreetingLabel(context, profile);
  const consistencyMessage = dashboardConsistencyMessage(data, dueState, today, profile);
  const checkinStreak = computeCheckinStreak(data.checkins, today);
  const nextDueLabel = nextDose
    ? `Next dose: ${nextDose.medicationName} at ${nextDose.time}`
    : "No scheduled doses remaining for today.";
  const latestCheckinLabel = latestCheckin
    ? `${niceDate(latestCheckin.date)}${latestCheckin.updatedAt ? ` · ${formatClockTime(latestCheckin.updatedAt)}` : ""}`
    : "No check-in recorded";
  const totalScheduledToday = dueState.counts.taken + dueState.counts.remaining + dueState.counts.missed;
  const adherencePct = totalScheduledToday
    ? roundNumber((dueState.counts.taken / totalScheduledToday) * 100, 0)
    : 100;
  const checkinSleepHours = toNumber(todayCheckin?.sleepHours);
  const undoActive = Boolean(app.lastDoseUndo && Number(app.lastDoseUndo.expiresAt) > Date.now());
  const actionPlans = normalizeActionPlans(data.actionPlans || []);
  const activeActionPlanSteps = renderActionPlanSteps(actionPlans, riskAssessment.level);
  const showActionPlanCard = ownerEditable || riskLevelRank(riskAssessment.level) >= riskLevelRank("elevated");

  root.innerHTML = `
    <div class="grid dashboard-flow">
      <article class="card card-accent card-accent-ocean dashboard-summary-strip">
        <div class="card-head-row">
          <div>
            <h3>Today at a glance</h3>
            <div class="subtle">${escapeHtml(greetingLabel)} · ${escapeHtml(niceDate(today))}</div>
          </div>
          <div class="dashboard-readonly-wrap">
            ${context.readOnly ? `<span class="readonly-badge">Read-only</span>` : ""}
            <span class="risk-pill ${escapeHtml(riskTone)}">${escapeHtml(riskAssessment.label)} risk</span>
          </div>
        </div>
        <div class="summary-strip-grid">
          <article class="summary-strip-item">
            <div class="summary-strip-label">Adherence today</div>
            <div class="summary-strip-value">${escapeHtml(`${adherencePct}%`)}</div>
            <div class="summary-strip-help">${escapeHtml(`${dueState.counts.taken} taken of ${totalScheduledToday || 0}`)}</div>
          </article>
          <article class="summary-strip-item">
            <div class="summary-strip-label">Next dose due</div>
            <div class="summary-strip-value">${escapeHtml(nextDose ? `${nextDose.medicationName} ${nextDose.time}` : "None remaining")}</div>
            <div class="summary-strip-help">${escapeHtml(`${overdueCount} overdue`)}</div>
          </article>
          <article class="summary-strip-item">
            <div class="summary-strip-label">Risk status</div>
            <div class="summary-strip-value">${escapeHtml(riskAssessment.label)}</div>
            <details>
              <summary class="summary-strip-help">Why this status?</summary>
              ${riskAssessment.reasons.length
                ? `<ul class="risk-why-list">${riskAssessment.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
                : `<div class="summary-strip-help">No active triggers right now.</div>`}
              ${riskAssessment.triggeredSigns.length
                ? `<ul class="warning-sign-list">${riskAssessment.triggeredSigns.map((sign) => `<li>${escapeHtml(sign.label)}</li>`).join("")}</ul>`
                : ""}
              ${renderRiskHistoryDots(riskHistory)}
            </details>
          </article>
          <article class="summary-strip-item">
            <div class="summary-strip-label">Last check-in</div>
            <div class="summary-strip-value">${escapeHtml(latestCheckinLabel)}</div>
            <div class="summary-strip-help">${latestCheckin ? `Mood ${escapeHtml(String(latestCheckin.mood))} · Anxiety ${escapeHtml(String(latestCheckin.anxiety))}` : "Complete quick check-in to update."}</div>
          </article>
        </div>
      </article>

      <article class="card card-accent card-accent-sky card-doses dashboard-priority-card">
        <div class="card-head-row">
          <div>
            <h3>Today’s Doses</h3>
            <div class="subtle">${escapeHtml(greetingLabel)} · ${escapeHtml(niceDate(today))}</div>
          </div>
          <div class="dashboard-readonly-wrap">
            ${context.readOnly ? `<span class="readonly-badge">Read-only</span>` : ""}
            <span class="subtle">Updated ${escapeHtml(niceDate(currentMedsLastUpdated))}</span>
          </div>
        </div>
        <div class="kpi-strip">
          <div class="kpi-box"><span>Taken</span><strong>${dueState.counts.taken}</strong></div>
          <div class="kpi-box"><span>Remaining</span><strong>${dueState.counts.remaining}</strong></div>
          <div class="kpi-box"><span>Missed</span><strong>${dueState.counts.missed}</strong></div>
          <div class="kpi-box"><span>Overdue</span><strong>${overdueCount}</strong></div>
        </div>
        <div class="today-summary-line">
          <div class="today-summary-copy">
            <div class="subtle">${escapeHtml(nextDueLabel)}</div>
            ${profile.personalizationEnabled ? `<div class="subtle">${escapeHtml(consistencyMessage)} ${checkinStreak ? `(${checkinStreak}d streak)` : ""}</div>` : ""}
          </div>
          ${ownerEditable ? `
            <div class="inline-row">
              <button class="btn btn-secondary small" type="button" data-dashboard-checkin="1">${todayCheckin ? "Edit check-in" : "Quick check-in"}</button>
              <button class="btn btn-ghost small" type="button" data-dashboard-new-change="1">Log change</button>
              <button class="btn btn-ghost small" type="button" data-dashboard-add-med="1">Add medication</button>
            </div>
          ` : ""}
        </div>
        ${ownerEditable && undoActive ? `
          <div class="dose-undo-banner">
            <span>Dose marked ${escapeHtml(app.lastDoseUndo.status)}.</span>
            <button class="btn btn-ghost small" type="button" data-dose-undo="1">Undo</button>
          </div>
        ` : ""}
        <div class="subtle" style="margin: 8px 0 10px;">Actions update immediately. Use filters to focus overdue doses.</div>
        ${renderDashboardDoseQueue(dueState, context, activeMeds)}
      </article>

      <article class="card card-accent card-accent-teal card-quick-checkin">
        <div class="card-head-row">
          <div>
            <h3>Quick check-in</h3>
            <div class="subtle">${todayCheckin ? "Today’s check-in completed." : "No check-in recorded yet today."}</div>
          </div>
          ${ownerEditable ? `<button class="btn btn-secondary small" type="button" data-dashboard-checkin="1">${todayCheckin ? "Update" : "Start"}</button>` : ""}
        </div>
        ${todayCheckin ? `
          <div class="today-snapshot-grid compact-kpi-grid">
            <article class="snapshot-tile">
              <div class="snapshot-tile-head">${renderIcon("heart", "mini-icon soft")}<span>Mood</span></div>
              <strong class="snapshot-value">${todayCheckin.mood}/10</strong>
            </article>
            <article class="snapshot-tile">
              <div class="snapshot-tile-head">${renderIcon("pulse", "mini-icon soft")}<span>Anxiety</span></div>
              <strong class="snapshot-value">${todayCheckin.anxiety}/10</strong>
            </article>
            <article class="snapshot-tile">
              <div class="snapshot-tile-head">${renderIcon("chart", "mini-icon soft")}<span>Focus</span></div>
              <strong class="snapshot-value">${todayCheckin.focus}/10</strong>
            </article>
            <article class="snapshot-tile">
              <div class="snapshot-tile-head">${renderIcon("clock", "mini-icon soft")}<span>Sleep</span></div>
              <strong class="snapshot-value">${Number.isFinite(checkinSleepHours) ? `${roundNumber(checkinSleepHours, 1)}h` : "-"}</strong>
            </article>
          </div>
        ` : `<div class="empty">Complete your quick check-in to generate daily trend signals.</div>`}
        <div class="dashboard-summary-note">
          <div class="card-head-row">
            <div class="label">Summary note</div>
            ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="summary">${app.ui.dashboardEdits.summary ? "Editing" : "Edit"}</button>` : ""}
          </div>
          ${ownerEditable && app.ui.dashboardEdits.summary ? `
            <form id="dashboardSummaryForm" class="edit-inline-form">
              <label for="dashboardSummaryNote">Owner summary note</label>
              <textarea id="dashboardSummaryNote" name="summaryNote" maxlength="420" placeholder="Add a short summary for this dashboard view.">${escapeHtml(summaryNote)}</textarea>
              <div class="inline-row">
                <button class="btn btn-primary small" type="submit">Save</button>
                <button class="btn btn-ghost small" type="button" data-dashboard-edit-cancel="summary">Cancel</button>
              </div>
            </form>
          ` : `<div class="subtle">${summaryNote ? escapeHtml(summaryNote) : "No summary note set."}</div>`}
        </div>
      </article>

      <article class="card card-accent card-accent-rose card-alerts">
        <div class="card-head-row">
          <div>
            <h3>Alerts / monitoring reminders</h3>
            <div class="subtle">Prioritised alerts from notes, recent changes, and custom reminders.</div>
          </div>
          ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="alerts">${app.ui.dashboardEdits.alerts ? "Editing" : "Edit"}</button>` : ""}
        </div>
        ${ownerEditable && app.ui.dashboardEdits.alerts ? `
          <form id="dashboardAlertsForm" class="edit-inline-form">
            <label for="dashboardMonitoringReminders">Monitoring reminders (one per line)</label>
            <textarea id="dashboardMonitoringReminders" name="monitoringReminders" placeholder="Example: Check BP before evening clonidine dose.">${escapeHtml(dashboardConfig.monitoringReminders.join("\n"))}</textarea>
            <div class="inline-row">
              <button class="btn btn-primary small" type="submit">Save</button>
              <button class="btn btn-ghost small" type="button" data-dashboard-edit-cancel="alerts">Cancel</button>
            </div>
          </form>
        ` : (
          dashboardAlerts.length
            ? `<ul class="alert-list">${dashboardAlerts.map((item) => `<li class="alert-list-item">${renderIcon("bell", "mini-icon soft", "Alert")}<span>${escapeHtml(item)}</span></li>`).join("")}</ul>`
            : `<div class="empty">No active monitoring alerts right now.</div>`
        )}
      </article>

      <article class="card card-accent card-accent-violet card-changes">
        <div class="card-head-row">
          <div>
            <h3>Recent medication changes (14 days)</h3>
            <div class="subtle">Timeline shown in reverse chronological order.</div>
          </div>
          ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="changes">${app.ui.dashboardEdits.changes ? "Editing" : "Edit"}</button>` : ""}
        </div>
        ${ownerEditable && app.ui.dashboardEdits.changes ? `
          ${topChanges.length ? `
            <form id="dashboardChangesForm" class="edit-inline-form">
              ${topChanges.map((entry) => `
                <fieldset class="inline-edit-change">
                  <legend>${escapeHtml(niceDate(entry.date))} · ${escapeHtml(entry.medicationName || "Medication")}</legend>
                  <div class="field-grid dashboard-edit-grid">
                    <div><label>Date</label><input name="date__${entry.id}" type="date" value="${escapeHtml(entry.date)}" required></div>
                    <div><label>Medication</label><input name="medicationName__${entry.id}" value="${escapeHtml(entry.medicationName || "")}" required></div>
                    <div><label>Old dose</label><input name="oldDose__${entry.id}" value="${escapeHtml(entry.oldDose || "")}" required></div>
                    <div><label>New dose</label><input name="newDose__${entry.id}" value="${escapeHtml(entry.newDose || "")}" required></div>
                    <div><label>Route (optional)</label><input name="route__${entry.id}" value="${escapeHtml(entry.route || "")}"></div>
                    <div>
                      <label>Changed by</label>
                      <select name="changedBy__${entry.id}">
                        ${["self", "psychiatrist", "gp", "clinician", "other"].map((role) => `<option value="${role}" ${String(entry.changedBy || "self") === role ? "selected" : ""}>${escapeHtml(role)}</option>`).join("")}
                      </select>
                    </div>
                    <div><label>Review date</label><input name="reviewDate__${entry.id}" type="date" value="${escapeHtml(entry.reviewDate || "")}"></div>
                    <div style="grid-column: 1 / -1;"><label>Reason for change</label><textarea name="reasonForChange__${entry.id}" required>${escapeHtml(entry.reasonForChange || entry.reason || "")}</textarea></div>
                    <div style="grid-column: 1 / -1;"><label>Expected effects</label><textarea name="expectedEffects__${entry.id}">${escapeHtml(entry.expectedEffects || "")}</textarea></div>
                    <div style="grid-column: 1 / -1;"><label>Monitor for</label><textarea name="monitorFor__${entry.id}">${escapeHtml(entry.monitorFor || "")}</textarea></div>
                    <div style="grid-column: 1 / -1;"><label>Notes</label><textarea name="notes__${entry.id}">${escapeHtml(entry.notes || "")}</textarea></div>
                  </div>
                </fieldset>
              `).join("")}
              <div class="inline-row">
                <button class="btn btn-primary small" type="submit">Save</button>
                <button class="btn btn-ghost small" type="button" data-dashboard-edit-cancel="changes">Cancel</button>
              </div>
            </form>
          ` : `<div class="empty">No medication changes in the last 14 days.</div>`}
        ` : (
          topChanges.length
            ? `<ul class="timeline-list">${topChanges.map((entry) => `<li><strong>${escapeHtml(niceDate(entry.date))}</strong> · ${escapeHtml(entry.medicationName || "Medication")}: ${escapeHtml(entry.oldDose || "-")} → ${escapeHtml(entry.newDose || "-")}<br><span class="subtle">${escapeHtml(entry.reasonForChange || entry.reason || "-")}${entry.changedBy ? ` · changed by ${escapeHtml(entry.changedBy)}` : ""}${entry.reviewDate ? ` · review ${escapeHtml(niceDate(entry.reviewDate))}` : ""}</span></li>`).join("")}</ul>`
            : `<div class="empty">No medication changes logged in the last 14 days.${ownerEditable ? ` <button class="btn btn-secondary small" type="button" data-dashboard-new-change="1">Log a change</button>` : ""}</div>`
        )}
      </article>

      <article class="card card-accent card-accent-sky card-medication-details">
        <div class="card-head-row">
          <div>
            <h3>Medication details</h3>
            <div class="subtle">Current medications, doses, and schedules.</div>
          </div>
          <div class="inline-row">
            ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="medications">${app.ui.dashboardEdits.medications ? "Editing" : "Edit"}</button>` : ""}
            <button class="btn btn-ghost small" type="button" data-dashboard-open-meds="1">Open full medications</button>
          </div>
        </div>
        ${activeMeds.length ? (
          ownerEditable && app.ui.dashboardEdits.medications
            ? `
              <form id="dashboardMedicationForm" class="dashboard-med-edit-grid">
                ${activeMeds.map((med) => `
                  <article class="dashboard-med-edit-row">
                    <h4>${escapeHtml(med.name)}</h4>
                    <div class="field-grid">
                      <div><label>Dose</label><input name="currentDose__${med.id}" value="${escapeHtml(med.currentDose || "")}" required></div>
                      <div><label>Route</label><input name="route__${med.id}" value="${escapeHtml(med.route || "")}" required></div>
                      <div><label>Schedule times</label><input name="scheduleTimes__${med.id}" value="${escapeHtml((med.scheduleTimes || []).join(", "))}" placeholder="08:00, 20:00"></div>
                      <div><label>Start date</label><input name="startDate__${med.id}" type="date" value="${escapeHtml(med.startDate || "")}" required></div>
                      <div style="grid-column: 1 / -1;"><label>Indication</label><textarea name="indication__${med.id}">${escapeHtml(med.indication || "")}</textarea></div>
                      <div style="grid-column: 1 / -1;"><label>Monitor</label><textarea name="monitor__${med.id}">${escapeHtml(med.monitor || "")}</textarea></div>
                    </div>
                  </article>
                `).join("")}
                <div class="inline-row" style="grid-column: 1 / -1;">
                  <button class="btn btn-primary small" type="submit">Save</button>
                  <button class="btn btn-ghost small" type="button" data-dashboard-edit-cancel="medications">Cancel</button>
                </div>
              </form>
            `
            : `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medication</th>
                  <th>Dose</th>
                  <th>Schedule</th>
                  <th>Route</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${activeMeds.map((med) => `
                  <tr>
                    <td><span class="table-wrap-text">${escapeHtml(med.name)}</span></td>
                    <td><span class="table-wrap-text">${escapeHtml(med.currentDose || "-")}</span></td>
                    <td><span class="table-wrap-text">${escapeHtml(formatSchedule(med))}</span></td>
                    <td><span class="table-wrap-text">${escapeHtml(med.route || "-")}</span></td>
                    <td><button class="btn btn-secondary small" type="button" data-med-detail="${escapeHtml(med.id)}">View</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        ) : `<div class="empty">No active medications yet.${ownerEditable ? ` <button class="btn btn-secondary small" type="button" data-dashboard-add-med="1">Add medication</button>` : ""}</div>`}
      </article>

      ${showActionPlanCard ? `
        <article class="card card-accent card-accent-teal action-plan-card">
          <div class="card-head-row">
            <div>
              <h3>Action plan ${riskLevelRank(riskAssessment.level) >= riskLevelRank("elevated") ? `(for ${escapeHtml(riskAssessment.label)} risk)` : ""}</h3>
              <div class="subtle">Pre-agreed response steps for Watch / Elevated / High risk levels.</div>
            </div>
            ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="actionPlan">${app.ui.dashboardEdits.actionPlan ? "Editing" : "Edit"}</button>` : ""}
          </div>
          ${ownerEditable && app.ui.dashboardEdits.actionPlan ? `
            <form id="dashboardActionPlanForm" class="edit-inline-form">
              <div>
                <label for="actionPlanWatch">Watch steps (one per line, optional prefix: [family] or [clinician])</label>
                <textarea id="actionPlanWatch" name="watch">${escapeHtml(actionPlanLinesByLevel(actionPlans, "watch"))}</textarea>
              </div>
              <div>
                <label for="actionPlanElevated">Elevated steps (one per line)</label>
                <textarea id="actionPlanElevated" name="elevated">${escapeHtml(actionPlanLinesByLevel(actionPlans, "elevated"))}</textarea>
              </div>
              <div>
                <label for="actionPlanHigh">High steps (one per line)</label>
                <textarea id="actionPlanHigh" name="high">${escapeHtml(actionPlanLinesByLevel(actionPlans, "high"))}</textarea>
              </div>
              <p class="inline-note">Tip: prefix a line with [family], [clinician], [gp], [psychiatrist], or [self] to set a notify role.</p>
              <div class="inline-row">
                <button class="btn btn-primary small" type="submit">Save</button>
                <button class="btn btn-ghost small" type="button" data-dashboard-edit-cancel="actionPlan">Cancel</button>
              </div>
            </form>
          ` : (
            activeActionPlanSteps.length
              ? `<ol class="action-plan-list">${activeActionPlanSteps.map((step) => `<li class="action-plan-item"><div>${escapeHtml(step.stepText)}</div>${step.notifyRole ? `<div class="action-plan-meta">Notify: ${escapeHtml(step.notifyRole)}</div>` : ""}</li>`).join("")}</ol>`
              : `<div class="action-plan-empty">No steps configured for ${escapeHtml(riskAssessment.label)} risk.</div>`
          )}
          <p class="safety-footnote">Action plan steps are informational support prompts and should align with your prescriber plan.</p>
        </article>
      ` : ""}

      <article class="card card-accent card-accent-ocean dashboard-trend-preview">
      <div class="dashboard-trend-head">
        <div>
          <h3>Wellbeing trends preview</h3>
          <div class="subtle">Use simple stats or visual chart view for quick pattern spotting.</div>
        </div>
        <div class="dashboard-trend-controls">
          <div class="chip-group">
            <button type="button" class="chip ${app.ui.dashboardTrendView === "simple" ? "active" : ""}" data-dashboard-trend-view="simple">Simple</button>
            <button type="button" class="chip ${app.ui.dashboardTrendView === "visual" ? "active" : ""}" data-dashboard-trend-view="visual">Visual</button>
          </div>
          <div class="chip-group">
            <button type="button" class="chip ${app.ui.dashboardTrendRangeDays === "7" ? "active" : ""}" data-dashboard-trend-range="7">7d</button>
            <button type="button" class="chip ${app.ui.dashboardTrendRangeDays === "30" ? "active" : ""}" data-dashboard-trend-range="30">30d</button>
          </div>
        </div>
      </div>
      ${renderDashboardTrendPreview(data, recentChanges, context)}
      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-ghost small" type="button" data-dashboard-open-trends="1">Open full trends</button>
      </div>
    </article>
  `;

  root.querySelectorAll("[data-dashboard-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!ownerEditable) return;
      const section = button.dataset.dashboardEdit || "";
      if (!["summary", "alerts", "changes", "medications", "actionPlan"].includes(section)) return;
      app.ui.dashboardEdits = { ...app.ui.dashboardEdits, [section]: true };
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-edit-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.dashboardEditCancel || "";
      if (!["summary", "alerts", "changes", "medications", "actionPlan"].includes(section)) return;
      app.ui.dashboardEdits = { ...app.ui.dashboardEdits, [section]: false };
      renderAll();
    });
  });

  root.querySelector("#dashboardSummaryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ownerEditable) return;
    const form = event.currentTarget;
    const summaryValue = String(form.elements.summaryNote?.value || "").trim();
    if (summaryValue.length > 420) {
      setStatus("Summary note is too long. Keep it under 420 characters.", "error");
      return;
    }
    app.ownerData.dashboardConfig = normalizeDashboardConfig({
      ...(app.ownerData.dashboardConfig || {}),
      summaryNote: summaryValue
    });
    saveOwnerData(app.ownerData);
    app.ui.dashboardEdits = { ...app.ui.dashboardEdits, summary: false };
    setStatus("Summary note updated.");
    renderAll();
  });

  root.querySelector("#dashboardAlertsForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ownerEditable) return;
    const form = event.currentTarget;
    const lines = String(form.elements.monitoringReminders?.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.some((line) => line.length > 140)) {
      setStatus("Each monitoring reminder should be 140 characters or fewer.", "error");
      return;
    }
    app.ownerData.dashboardConfig = normalizeDashboardConfig({
      ...(app.ownerData.dashboardConfig || {}),
      monitoringReminders: lines
    });
    saveOwnerData(app.ownerData);
    app.ui.dashboardEdits = { ...app.ui.dashboardEdits, alerts: false };
    setStatus("Monitoring reminders updated.");
    renderAll();
  });

  root.querySelector("#dashboardChangesForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ownerEditable) return;
    const form = event.currentTarget;
    const updates = new Map();

    for (const entry of topChanges) {
      const date = String(form.elements[`date__${entry.id}`]?.value || "").trim();
      const medicationName = String(form.elements[`medicationName__${entry.id}`]?.value || "").trim();
      const oldDose = String(form.elements[`oldDose__${entry.id}`]?.value || "").trim();
      const newDose = String(form.elements[`newDose__${entry.id}`]?.value || "").trim();
      const reasonForChange = String(form.elements[`reasonForChange__${entry.id}`]?.value || "").trim();
      const route = String(form.elements[`route__${entry.id}`]?.value || "").trim();
      const changedBy = String(form.elements[`changedBy__${entry.id}`]?.value || "self").trim();
      const expectedEffects = String(form.elements[`expectedEffects__${entry.id}`]?.value || "").trim();
      const monitorFor = String(form.elements[`monitorFor__${entry.id}`]?.value || "").trim();
      const reviewDate = String(form.elements[`reviewDate__${entry.id}`]?.value || "").trim();
      const notes = String(form.elements[`notes__${entry.id}`]?.value || "").trim();

      if (!date || !medicationName || !reasonForChange) {
        setStatus("Recent changes edit failed: date, medication, and reason are required.", "error");
        return;
      }
      if (!doseLooksValid(oldDose) || !doseLooksValid(newDose)) {
        setStatus(`Dose format is invalid for ${medicationName}. Use value + unit (e.g. 40 mg).`, "error");
        return;
      }

      updates.set(entry.id, {
        ...entry,
        date,
        medicationName,
        oldDose,
        newDose,
        reason: reasonForChange,
        reasonForChange,
        route,
        changedBy,
        expectedEffects,
        monitorFor,
        reviewDate,
        notes
      });
    }

    app.ownerData.changes = app.ownerData.changes.map((entry) => updates.get(entry.id) || entry);
    saveOwnerData(app.ownerData);
    app.ui.dashboardEdits = { ...app.ui.dashboardEdits, changes: false };
    setStatus("Recent medication changes updated.");
    renderAll();
  });

  root.querySelector("#dashboardMedicationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ownerEditable) return;
    const form = event.currentTarget;
    const targetIds = new Set(activeMeds.map((med) => med.id));
    const medicationById = new Map(app.ownerData.medications.map((med) => [med.id, med]));

    for (const med of activeMeds) {
      const nextDose = String(form.elements[`currentDose__${med.id}`]?.value || "").trim();
      const route = String(form.elements[`route__${med.id}`]?.value || "").trim();
      const scheduleTimesRaw = String(form.elements[`scheduleTimes__${med.id}`]?.value || "").trim();
      const startDate = String(form.elements[`startDate__${med.id}`]?.value || "").trim();
      const indication = String(form.elements[`indication__${med.id}`]?.value || "").trim();
      const monitor = String(form.elements[`monitor__${med.id}`]?.value || "").trim();

      if (!doseLooksValid(nextDose)) {
        setStatus(`Dose format is invalid for ${med.name}. Use value + unit (e.g. 40 mg).`, "error");
        return;
      }

      const scheduleTimes = normalizeTimes(scheduleTimesRaw.split(",").map((item) => item.trim()).filter(Boolean));
      const invalidTime = scheduleTimes.find((time) => !isTimeValue(time));
      if (invalidTime) {
        setStatus(`Schedule time "${invalidTime}" for ${med.name} is invalid. Use HH:MM (24-hour).`, "error");
        return;
      }

      const target = medicationById.get(med.id);
      if (!target || !targetIds.has(med.id)) continue;
      target.currentDose = nextDose;
      target.route = route || "oral";
      target.scheduleTimes = scheduleTimes;
      target.startDate = startDate || target.startDate;
      target.indication = indication;
      target.monitor = monitor;
      target.updatedAt = isoDateTime(new Date());
    }

    saveOwnerData(app.ownerData);
    app.ui.dashboardEdits = { ...app.ui.dashboardEdits, medications: false };
    setStatus("Medication details updated.");
    renderAll();
  });

  root.querySelector("#dashboardActionPlanForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!ownerEditable) return;
    const form = event.currentTarget;
    const watchPlans = parseActionPlanLines(form.elements.watch?.value || "", "watch");
    const elevatedPlans = parseActionPlanLines(form.elements.elevated?.value || "", "elevated");
    const highPlans = parseActionPlanLines(form.elements.high?.value || "", "high");
    const combined = normalizeActionPlans([...watchPlans, ...elevatedPlans, ...highPlans]);
    if (!combined.length) {
      setStatus("Add at least one action-plan step before saving.", "error");
      return;
    }
    app.ownerData.actionPlans = combined;
    saveOwnerData(app.ownerData);
    app.ui.dashboardEdits = { ...app.ui.dashboardEdits, actionPlan: false };
    setStatus("Action plan updated.");
    renderAll();
  });

  root.querySelectorAll("[data-dashboard-dose-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.dashboardDoseFilter = button.dataset.dashboardDoseFilter || "all";
      app.ui.dashboardDosePage = 1;
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-dose-view]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.dashboardDoseView = button.dataset.dashboardDoseView === "table" ? "table" : "cards";
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-dose-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = Number(button.dataset.dashboardDosePage || 0);
      if (!Number.isFinite(direction) || direction === 0) return;
      app.ui.dashboardDosePage = Math.max(1, Number(app.ui.dashboardDosePage || 1) + direction);
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-dose-search]").forEach((input) => {
    input.addEventListener("input", () => {
      app.ui.dashboardDoseSearch = String(input.value || "");
      app.ui.dashboardDosePage = 1;
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-trend-view]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.dashboardTrendView = button.dataset.dashboardTrendView === "visual" ? "visual" : "simple";
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-trend-range]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.dashboardTrendRangeDays = button.dataset.dashboardTrendRange === "30" ? "30" : "7";
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-open-trends]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToSection("timeline", {
        preferredModes: ["clinical", "personal"],
        fallbackSections: ["changes"]
      });
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-add-med]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "entry";
      app.ui.entryWorkflow = "medication";
      renderAll();
    });
  });

  root.querySelectorAll("[data-dose-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (context.readOnly) return;
      const occurrenceId = button.dataset.doseOccurrenceId || "";
      const status = button.dataset.doseStatus || "";
      await handleDoseAction(occurrenceId, status);
    });
  });

  root.querySelectorAll("[data-dose-snooze]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      const occurrenceId = button.dataset.doseOccurrenceId || "";
      handleDoseSnooze(occurrenceId, DOSE_SNOOZE_MINUTES);
    });
  });

  root.querySelectorAll("[data-dose-note]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      const occurrenceId = button.dataset.doseOccurrenceId || "";
      const medicationName = button.dataset.medicationName || "";
      handleDoseNote(occurrenceId, medicationName);
    });
  });

  root.querySelectorAll("[data-dose-undo]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      handleDoseUndo();
    });
  });

  root.querySelectorAll("[data-dashboard-checkin]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "entry";
      app.ui.entryWorkflow = "checkin";
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-new-change]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "entry";
      app.ui.entryWorkflow = "change";
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-open-meds]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "medications";
      renderAll();
    });
  });

  root.querySelectorAll("[data-med-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const medId = button.dataset.medDetail || "";
      if (!medId) return;
      const medication = app.ownerData.medications.find((entry) => entry.id === medId) || data.medications.find((entry) => entry.id === medId);
      if (!medication) return;
      openMedicationModal(medId, context);
    });
  });
}

function renderDoseTable(dueState, context, medications, itemsOverride = null) {
  const doseByMedicationId = new Map((medications || []).map((med) => [med.id, med.currentDose || "-"]));
  const items = Array.isArray(itemsOverride) ? itemsOverride : [...dueState.dueNow, ...dueState.next];
  if (!items.length) {
    return `
      <div class="empty">
        No scheduled doses remaining for today.
        ${context.readOnly ? "" : `<div style="margin-top:8px;"><button class="btn btn-secondary small" type="button" data-dashboard-checkin="1">Complete quick check-in</button></div>`}
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Medication</th>
            <th>Dose</th>
            <th>Time</th>
            <th>Status</th>
            ${context.readOnly ? "" : "<th>Action</th>"}
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>
                <div class="dose-med-cell">
                  ${renderIcon("capsule", "mini-icon soft")}
                  <span class="table-wrap-text">${escapeHtml(item.medicationName)}</span>
                </div>
              </td>
              <td><span class="table-wrap-text">${escapeHtml(doseByMedicationId.get(item.medicationId) || "-")}</span></td>
              <td>${escapeHtml(item.time)}</td>
              <td><span class="status-chip ${escapeHtml(statusChipClass(item.statusLabel))}">${escapeHtml(item.statusLabel)}</span></td>
              ${context.readOnly ? "" : `<td class="dose-actions-cell">
                <div class="inline-row dose-actions-primary">
                  <button class="btn btn-secondary small ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.TAKEN}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as taken" ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "disabled" : ""}>${app.ui.pendingDoseActions.has(item.occurrenceId) ? "Saving" : "Taken"}</button>
                  <button class="btn btn-secondary small ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.SKIPPED}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as skipped" ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "disabled" : ""}>${app.ui.pendingDoseActions.has(item.occurrenceId) ? "Saving" : "Skip"}</button>
                  <details class="dose-actions-more">
                    <summary>More</summary>
                    <div class="inline-row">
                      <button class="btn btn-ghost small" type="button" data-dose-snooze="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" aria-label="Snooze ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)}" ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "disabled" : ""}>Snooze</button>
                      <button class="btn btn-ghost small" type="button" data-dose-note="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-medication-name="${escapeHtml(item.medicationName)}" aria-label="Add note for ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)}">Note</button>
                    </div>
                  </details>
                </div>
              </td>`}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSharePanelPreview(context) {
  if (context.readOnly) {
    return `<div class="subtle">Shared viewers cannot manage links.</div>`;
  }

  const links = app.ownerData.shareLinks
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);

  if (!links.length) {
    return `<div class="empty">No share links yet. Use the Sharing section to create links.</div>`;
  }

  return `
    <ul class="timeline-list">
      ${links.map((link) => {
        const access = app.accessLogs[link.token] || { totalOpens: link.totalOpens || 0, lastOpenedAt: link.lastOpenedAt || "" };
        const status = link.revoked ? "Revoked" : link.expiresAt && new Date(link.expiresAt).getTime() < Date.now() ? "Expired" : "Active";
        return `<li><strong>${escapeHtml(link.name)}</strong> (${escapeHtml(PRESETS[link.preset]?.label || "Read-only")}) · ${status} · opens: ${access.totalOpens || 0}</li>`;
      }).join("")}
    </ul>
  `;
}

function renderMedications(root, data, context) {
  const resolved = resolveCurrentMedications(data);
  const recordCount = data.medications.length;
  const current = resolved.filter((med) => med.isCurrent);
  const historical = resolved.filter((med) => !med.isCurrent);
  const currentMedsLastUpdated = resolveCurrentMedsLastUpdatedDate(data);

  root.innerHTML = resolved.length
    ? `
      <div class="card" style="margin-bottom:12px;">
        <h3>Current medications (resolved from stored data)</h3>
        <div class="subtle">
          If multiple records conflict, this list shows the most recently updated active/current record while preserving all history.
        </div>
        <div class="subtle" style="margin-top:6px;"><strong>Last updated:</strong> ${escapeHtml(niceDate(currentMedsLastUpdated))}</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Medication</th>
              <th>Dose</th>
              <th>Schedule</th>
              <th>Route</th>
              <th>Start</th>
              <th>Status</th>
              <th>Resolution</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            ${[...current, ...historical].map((med) => `
              <tr>
                <td>
                  <strong>${escapeHtml(med.name)}</strong>
                  ${med.genericName ? `<div class="subtle">${escapeHtml(med.genericName)}</div>` : ""}
                  ${med.brandName ? `<div class="subtle">${escapeHtml(med.brandName)}</div>` : ""}
                  ${med.needsConfirmation || !med.isTargetMedication ? `<div class="needs-confirmation">Needs confirmation: ${escapeHtml(formatNeedsConfirmationMessage(med.confirmationNotes || med.questions || (!med.isTargetMedication ? "Additional active record preserved from existing data." : "Conflicting values require confirmation.")))}</div>` : ""}
                </td>
                <td>${escapeHtml(med.currentDose || "-")}</td>
                <td>${escapeHtml(formatSchedule(med))}</td>
                <td>${escapeHtml(med.route || "-")}</td>
                <td>${escapeHtml(niceDate(med.startDate))}</td>
                <td>${med.isCurrent ? "Current" : "Historical"}</td>
                <td>${med.sourceCount > 1 ? `Resolved from ${med.sourceCount} records` : "Single record"}</td>
                <td>
                  <button type="button" class="btn btn-secondary small" data-open-medication="${med.id}">Open details</button>
                  ${context.readOnly ? "" : `<button type="button" class="btn btn-secondary small" data-toggle-med="${med.id}">${med.isCurrent ? "Set inactive" : "Set active"}</button>`}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="subtle" style="margin-top:8px;">Underlying medication records stored: ${recordCount}. Current list rows: ${current.length}.</div>
    `
    : `<div class="empty">No medications added yet.</div>`;

  root.querySelectorAll("[data-open-medication]").forEach((button) => {
    button.addEventListener("click", () => {
      openMedicationModal(button.dataset.openMedication, context);
    });
  });

  root.querySelectorAll("[data-toggle-med]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.toggleMed;
      const med = app.ownerData.medications.find((entry) => entry.id === id);
      if (!med) return;
      med.active = !med.active;
      med.updatedAt = isoDateTime(new Date());
      saveOwnerData(app.ownerData);
      setStatus(`${med.name} is now ${med.active ? "active" : "inactive"}.`);
      renderAll();
    });
  });
}

function openMedicationModal(medicationId, context) {
  const source = getSourceData();
  const med = source.medications.find((entry) => entry.id === medicationId);
  if (!med) return;

  const changes = source.changes
    .filter((entry) => entry.medicationId === med.id || entry.medicationName === med.name)
    .sort((a, b) => b.date.localeCompare(a.date));

  const editable = !context.readOnly && context.type === "owner";

  dom.medicationModalBody.innerHTML = `
    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <article class="card">
        <h4>Core details</h4>
        <div class="field-grid">
          <div>
            <label>Name</label>
            <input id="modalMedName" value="${escapeHtml(med.name)}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>Generic name</label>
            <input id="modalMedGeneric" value="${escapeHtml(med.genericName || "")}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>Brand name</label>
            <input id="modalMedBrand" value="${escapeHtml(med.brandName || "")}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>Current dose</label>
            <input id="modalMedDose" value="${escapeHtml(med.currentDose || "")}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>Route</label>
            <input id="modalMedRoute" value="${escapeHtml(med.route || "")}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>Start date</label>
            <input id="modalMedStart" type="date" value="${escapeHtml(med.startDate || "")}" ${editable ? "" : "disabled"}>
          </div>
          <div>
            <label>Schedule times (comma separated)</label>
            <input id="modalMedTimes" value="${escapeHtml((med.scheduleTimes || []).join(", "))}" ${editable ? "" : "disabled"}>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Needs confirmation note</label>
            <textarea id="modalMedConfirmation" ${editable ? "" : "disabled"}>${escapeHtml(med.confirmationNotes || "")}</textarea>
          </div>
        </div>
        <label style="margin-top:10px;">Indication (why taken)</label>
        <textarea id="modalMedIndication" ${editable ? "" : "disabled"}>${escapeHtml(med.indication || "")}</textarea>
      </article>

      <article class="card">
        <h4>MOA and interpretation</h4>
        <label>Simple explanation (one bullet per line)</label>
        <textarea id="modalMedMoaSimple" ${editable ? "" : "disabled"}>${escapeHtml((med.moaSimple || []).join("\n"))}</textarea>
        <label style="margin-top:10px;">Technical explanation</label>
        <textarea id="modalMedMoaTechnical" ${editable ? "" : "disabled"}>${escapeHtml(med.moaTechnical || "")}</textarea>
        <label style="margin-top:10px;">Acute vs chronic time-course / adaptation notes</label>
        <textarea id="modalMedTimeCourse" ${editable ? "" : "disabled"}>${escapeHtml(med.timeCourseNotes || "")}</textarea>
        <label style="margin-top:10px;">Dose adjustment interpretation (acute)</label>
        <textarea id="modalMedAdjustAcute" ${editable ? "" : "disabled"}>${escapeHtml(med.adjustmentAcute || "")}</textarea>
        <label style="margin-top:10px;">Dose adjustment interpretation (longer-term)</label>
        <textarea id="modalMedAdjustChronic" ${editable ? "" : "disabled"}>${escapeHtml(med.adjustmentChronic || "")}</textarea>
      </article>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr; margin-top:12px;">
      <article class="card">
        <h4>Side effects and monitoring</h4>
        <label>Common side effects</label>
        <textarea id="modalMedSideEffects" ${editable ? "" : "disabled"}>${escapeHtml(med.commonSideEffects || "")}</textarea>
        <label style="margin-top:10px;">What to monitor</label>
        <textarea id="modalMedMonitor" ${editable ? "" : "disabled"}>${escapeHtml(med.monitor || "")}</textarea>
        <label style="margin-top:10px;">Interactions notes</label>
        <textarea id="modalMedInteractions" ${editable ? "" : "disabled"}>${escapeHtml(med.interactionsNotes || "")}</textarea>
        <label style="margin-top:10px;">Contraindications notes</label>
        <textarea id="modalMedContraindications" ${editable ? "" : "disabled"}>${escapeHtml(med.contraindicationsNotes || "")}</textarea>
        <label style="margin-top:10px;">Notes / questions for psychiatrist or GP</label>
        <textarea id="modalMedQuestions" ${editable ? "" : "disabled"}>${escapeHtml(med.questions || "")}</textarea>
        <p class="safety-footnote">Clinical interpretation may vary. Discuss with prescriber.</p>
      </article>

      <article class="card">
        <h4>Personal change history timeline</h4>
        ${changes.length ? `
          <ul class="timeline-list">
            ${changes.map((entry) => `<li><strong>${escapeHtml(niceDate(entry.date))}</strong> · ${escapeHtml(entry.oldDose || "-")} → ${escapeHtml(entry.newDose || "-")} · ${escapeHtml(entry.reason || "")}</li>`).join("")}
          </ul>
        ` : `<div class="empty">No change events yet for this medication.</div>`}
      </article>
    </div>

    ${editable ? `
      <div class="inline-row" style="margin-top: 12px;">
        <button class="btn btn-primary" type="button" id="saveMedicationModal">Save medication detail</button>
      </div>
    ` : ""}
  `;

  dom.medicationModal.classList.remove("hidden");
  dom.medicationModal.setAttribute("aria-hidden", "false");

  const saveButton = document.getElementById("saveMedicationModal");
  if (saveButton) {
    saveButton.addEventListener("click", () => {
      const target = app.ownerData.medications.find((entry) => entry.id === medicationId);
      if (!target) return;

      target.name = valueOf("modalMedName");
      target.genericName = valueOf("modalMedGeneric");
      target.brandName = valueOf("modalMedBrand");
      target.currentDose = valueOf("modalMedDose");
      target.route = valueOf("modalMedRoute");
      target.startDate = valueOf("modalMedStart") || target.startDate;
      target.scheduleTimes = normalizeTimes(valueOf("modalMedTimes").split(",").map((item) => item.trim()));
      const invalidTime = target.scheduleTimes.find((time) => !isTimeValue(time));
      if (invalidTime) {
        return setStatus(`Schedule time "${invalidTime}" is invalid. Use HH:MM (24-hour).`, "error");
      }
      target.confirmationNotes = valueOf("modalMedConfirmation");
      target.needsConfirmation = Boolean(target.confirmationNotes);
      target.indication = valueOf("modalMedIndication");
      target.moaSimple = valueOf("modalMedMoaSimple").split("\n").map((line) => line.trim()).filter(Boolean);
      target.moaTechnical = valueOf("modalMedMoaTechnical");
      target.timeCourseNotes = valueOf("modalMedTimeCourse");
      target.adjustmentAcute = valueOf("modalMedAdjustAcute");
      target.adjustmentChronic = valueOf("modalMedAdjustChronic");
      target.commonSideEffects = valueOf("modalMedSideEffects");
      target.monitor = valueOf("modalMedMonitor");
      target.interactionsNotes = valueOf("modalMedInteractions");
      target.contraindicationsNotes = valueOf("modalMedContraindications");
      target.questions = valueOf("modalMedQuestions");
      target.updatedAt = isoDateTime(new Date());

      saveOwnerData(app.ownerData);
      hydrateMedicationNameOptions();
      setStatus("Medication details updated.");
      closeMedicationModal();
      renderAll();
    });
  }
}

function closeMedicationModal() {
  dom.medicationModal.classList.add("hidden");
  dom.medicationModal.setAttribute("aria-hidden", "true");
  dom.medicationModalBody.innerHTML = "";
}

function renderChanges(root, data, context) {
  const rows = data.changes.slice().sort((a, b) => b.date.localeCompare(a.date));

  if (!rows.length) {
    root.innerHTML = `<div class="empty">No medication changes logged yet.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <h3>Recent medication changes summary</h3>
      ${renderRecentMedicationSummary()}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Medication</th>
            <th>Change</th>
            <th>Context</th>
            <th>Interpretation</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(niceDate(row.date))}</td>
              <td>${escapeHtml(row.medicationName || "-")}</td>
              <td>${escapeHtml(row.oldDose || "-")} → ${escapeHtml(row.newDose || "-")}</td>
              <td>
                <div><strong>Reason:</strong> ${escapeHtml(row.reasonForChange || row.reason || "-")}</div>
                <div class="subtle">${row.changedBy ? `Changed by: ${escapeHtml(row.changedBy)}` : ""}${row.route ? `${row.changedBy ? " · " : ""}Route: ${escapeHtml(row.route)}` : ""}${row.reviewDate ? `${(row.changedBy || row.route) ? " · " : ""}Review: ${escapeHtml(niceDate(row.reviewDate))}` : ""}</div>
                ${row.monitorFor ? `<div class="subtle">Monitor: ${escapeHtml(row.monitorFor)}</div>` : ""}
                ${row.expectedEffects ? `<div class="subtle">Expected effects: ${escapeHtml(row.expectedEffects)}</div>` : ""}
                ${row.notes ? `<div class="subtle">Notes: ${escapeHtml(row.notes)}</div>` : ""}
              </td>
              <td>
                <details>
                  <summary>Open interpretation card</summary>
                  <div class="interpret-card">
                    ${renderInterpretationCard(row)}
                    ${context.readOnly ? "" : renderInterpretationEditor(row)}
                    <p class="safety-footnote">This interpretation is informational and may change with clinical review. Discuss with prescriber.</p>
                  </div>
                </details>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!context.readOnly) {
    root.querySelectorAll("[data-save-interpretation]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.saveInterpretation;
        const change = app.ownerData.changes.find((entry) => entry.id === id);
        if (!change) return;

        change.interpretation = normalizeInterpretation({
          shortTerm: valueOf(`shortTerm-${id}`),
          longTerm: valueOf(`longTerm-${id}`),
          monitor: valueOf(`monitor-${id}`),
          improvement: valueOf(`improvement-${id}`),
          deterioration: valueOf(`deterioration-${id}`),
          uncertainty: valueOf(`uncertainty-${id}`)
        });

        saveOwnerData(app.ownerData);
        setStatus("Interpretation card updated.");
        renderAll();
      });
    });
  }
}

function renderInterpretationCard(change) {
  const i = normalizeInterpretation(change.interpretation || {});
  return `
    <div class="interpret-grid">
      <div class="interpret-item"><div class="label">What changed</div><div>${escapeHtml(change.oldDose || "-")} → ${escapeHtml(change.newDose || "-")}</div></div>
      <div class="interpret-item"><div class="label">Reason</div><div>${escapeHtml(change.reason || "-")}</div></div>
      <div class="interpret-item"><div class="label">Short term (1-7 days)</div><div>${escapeHtml(i.shortTerm)}</div></div>
      <div class="interpret-item"><div class="label">Longer term (2-6 weeks)</div><div>${escapeHtml(i.longTerm)}</div></div>
      <div class="interpret-item"><div class="label">What to monitor</div><div>${escapeHtml(i.monitor)}</div></div>
      <div class="interpret-item"><div class="label">Improvement markers</div><div>${escapeHtml(i.improvement)}</div></div>
      <div class="interpret-item"><div class="label">Deterioration markers</div><div>${escapeHtml(i.deterioration)}</div></div>
      <div class="interpret-item"><div class="label">Uncertainty</div><div>${escapeHtml(i.uncertainty)}</div></div>
    </div>
  `;
}

function renderInterpretationEditor(change) {
  const i = normalizeInterpretation(change.interpretation || {});
  return `
    <hr class="soft">
    <div class="field-grid">
      <div style="grid-column: 1 / -1;"><label>Short term</label><textarea id="shortTerm-${change.id}">${escapeHtml(i.shortTerm)}</textarea></div>
      <div style="grid-column: 1 / -1;"><label>Longer term</label><textarea id="longTerm-${change.id}">${escapeHtml(i.longTerm)}</textarea></div>
      <div style="grid-column: 1 / -1;"><label>Monitor</label><textarea id="monitor-${change.id}">${escapeHtml(i.monitor)}</textarea></div>
      <div style="grid-column: 1 / -1;"><label>Improvement markers</label><textarea id="improvement-${change.id}">${escapeHtml(i.improvement)}</textarea></div>
      <div style="grid-column: 1 / -1;"><label>Deterioration markers</label><textarea id="deterioration-${change.id}">${escapeHtml(i.deterioration)}</textarea></div>
      <div style="grid-column: 1 / -1;"><label>Uncertainty note</label><textarea id="uncertainty-${change.id}">${escapeHtml(i.uncertainty)}</textarea></div>
    </div>
    <button type="button" class="btn btn-secondary" data-save-interpretation="${change.id}">Save interpretation card</button>
  `;
}

function renderCheckins(root, data, context) {
  const today = getLocalDateKey(new Date());
  const todayCheckin = data.checkins.find((entry) => entry.date === today);
  const sorted = data.checkins.slice().sort((a, b) => b.date.localeCompare(a.date));

  root.innerHTML = `
    <div class="card">
      <h3>Today’s check-in summary</h3>
      ${todayCheckin ? `
        <div class="inline-row">
          <span class="kpi-badge">Mood ${todayCheckin.mood}/10</span>
          <span class="kpi-badge">Anxiety ${todayCheckin.anxiety}/10</span>
          <span class="kpi-badge">Focus ${todayCheckin.focus}/10</span>
          <span class="kpi-badge">Sleep ${todayCheckin.sleepHours}h</span>
          <span class="kpi-badge">Energy ${todayCheckin.energy}/10</span>
          <span class="kpi-badge">Irritability ${todayCheckin.irritability}/10</span>
        </div>
      ` : `<div class="empty">No check-in yet for today. ${context.readOnly ? "" : `<button class="btn btn-secondary small" type="button" data-empty-action="checkin">Complete quick check-in (30 seconds)</button>`}</div>`}
    </div>

    <div class="table-wrap" style="margin-top: 12px;">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Mood</th>
            <th>Anxiety</th>
            <th>Focus</th>
            <th>Sleep (h / quality)</th>
            <th>Appetite</th>
            <th>Energy</th>
            <th>Irritability</th>
            <th>Cravings / impulsivity</th>
            <th>Side effects</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => `
            <tr>
              <td>${escapeHtml(niceDate(row.date))}</td>
              <td>${escapeHtml(String(row.mood))}</td>
              <td>${escapeHtml(String(row.anxiety))}</td>
              <td>${escapeHtml(String(row.focus))}</td>
              <td>${escapeHtml(String(row.sleepHours))} / ${escapeHtml(String(row.sleepQuality))}</td>
              <td>${escapeHtml(String(row.appetite))}</td>
              <td>${escapeHtml(String(row.energy))}</td>
              <td>${escapeHtml(String(row.irritability))}</td>
              <td>${escapeHtml(String(row.cravingsImpulsivity))}</td>
              <td>${escapeHtml((row.sideEffectsChecklist || []).join(", ") || row.sideEffectsText || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${context.readOnly ? "" : `
      <div class="subtle" style="margin-top:8px;">Use Add Entries → Daily Wellbeing Check-in for structured entry.</div>
    `}
  `;

  root.querySelectorAll("[data-empty-action='checkin']").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "entry";
      app.ui.entryWorkflow = "checkin";
      renderAll();
    });
  });
}

function renderNotes(root, data) {
  const grouped = {
    effect: [],
    side_effect: [],
    journal: [],
    libido: [],
    substance: [],
    free_text: []
  };

  for (const note of data.notes) {
    if (!grouped[note.noteType]) grouped[note.noteType] = [];
    grouped[note.noteType].push(note);
  }

  const blocks = Object.entries(grouped)
    .map(([type, items]) => {
      if (!items.length) return "";
      return `
        <article class="card">
          <h3>${escapeHtml(type.replaceAll("_", " "))}</h3>
          <ul class="timeline-list">
            ${items
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((item) => `<li><strong>${escapeHtml(niceDate(item.date))}</strong> ${escapeHtml(item.medicationName ? `(${item.medicationName})` : "")} · ${escapeHtml(item.noteText || "-")} ${(item.tags || []).length ? `<div class="subtle">Tags: ${escapeHtml(item.tags.join(", "))}</div>` : ""} ${item.trainingNotes ? `<div class="subtle">Training: ${escapeHtml(item.trainingNotes)}</div>` : ""}</li>`)
              .join("")}
          </ul>
        </article>
      `;
    })
    .filter(Boolean)
    .join("");

  root.innerHTML = blocks || `<div class="empty">No notes available for this view.${getActiveContext().readOnly ? "" : ` <button class="btn btn-secondary small" type="button" data-empty-action="note">Add effects note</button>`}</div>`;

  root.querySelectorAll("[data-empty-action='note']").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.activeSection = "entry";
      app.ui.entryWorkflow = "note";
      renderAll();
    });
  });
}

function renderTimeline(root, data) {
  const showAdvancedTimeline = app.ui.activeViewMode === "personal";
  const meds = resolveCurrentMedications(data);
  const medicationOptions = meds.map((med) => ({ id: med.id, name: med.name }));
  if (app.ui.timelineFilters.medicationId && app.ui.timelineFilters.medicationId !== "all") {
    const exists = medicationOptions.some((option) => option.id === app.ui.timelineFilters.medicationId);
    if (!exists) {
      app.ui.timelineFilters.medicationId = "all";
    }
  }

  const filtered = applyTimelineFilters(data);
  const checkins = filtered.checkins.slice().sort((a, b) => a.date.localeCompare(b.date));
  const changeDates = filtered.changes.map((entry) => entry.date);

  const moodSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.mood) }));
  const anxietySeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.anxiety) }));
  const focusSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.focus) }));
  const sleepSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.sleepHours) }));
  const sideEffectCounts = buildSideEffectCounts(filtered);
  const adherenceTrend = buildAdherenceTrend(filtered.adherence);
  const doseChangeTrend = buildDoseChangeTrend(filtered.changes);

  if (!app.ui.comparisonChangeId && filtered.changes[0]) {
    app.ui.comparisonChangeId = filtered.changes[0].id;
  }

  root.innerHTML = `
    <div class="grid" style="grid-template-columns: 1fr; gap: 12px;">
      <article class="card">
        <h3>Timeline filters</h3>
        <div class="field-grid">
          <div>
            <label for="timelineMedicationFilter">Medication</label>
            <select id="timelineMedicationFilter">
              <option value="all">All medications</option>
              ${medicationOptions
                .map((option) => `<option value="${option.id}" ${app.ui.timelineFilters.medicationId === option.id ? "selected" : ""}>${escapeHtml(option.name)}</option>`)
                .join("")}
            </select>
          </div>
          <div>
            <label for="timelineFromDate">From date</label>
            <input id="timelineFromDate" type="date" value="${escapeHtml(app.ui.timelineFilters.fromDate || "")}">
          </div>
          <div>
            <label for="timelineToDate">To date</label>
            <input id="timelineToDate" type="date" value="${escapeHtml(app.ui.timelineFilters.toDate || "")}">
          </div>
        </div>
        <div class="chip-group" style="margin-top:10px;">
          ${["7", "14", "30"].map((days) => `<button class="chip ${app.ui.timelineFilters.rangeDays === days ? "active" : ""}" type="button" data-range-days="${days}">${days}d</button>`).join("")}
        </div>
        <p class="helper-text" style="margin-top:8px;">${showAdvancedTimeline ? "Personal View: full timeline depth enabled." : "Clinical View: focused chart set."}</p>
      </article>

      <article class="chart-box">
        <h4>Adherence % over time</h4>
        ${renderLineChart([{ label: "Adherence %", color: CHART_COLORS.adherence, points: adherenceTrend }], { yMin: 0, yMax: 100, changeDates })}
      </article>

      <article class="chart-box">
        <h4>Symptom trends: mood / anxiety / focus</h4>
        ${renderLineChart(
          [
            { label: "Mood", color: CHART_COLORS.mood, points: moodSeries },
            { label: "Anxiety", color: CHART_COLORS.anxiety, points: anxietySeries },
            { label: "Focus", color: CHART_COLORS.focus, points: focusSeries }
          ],
          { yMin: 0, yMax: 10, changeDates }
        )}
      </article>

      <article class="chart-box">
        <h4>Sleep hours over time</h4>
        ${renderLineChart([{ label: "Sleep hours", color: CHART_COLORS.sleep, points: sleepSeries }], { yMin: 0, yMax: 12, changeDates })}
      </article>

      <article class="chart-box">
        <h4>Side-effect intensity trend</h4>
        ${renderBarChart(sideEffectCounts, changeDates)}
      </article>

      ${showAdvancedTimeline ? `
        <article class="chart-box">
          <h4>Dose changes timeline</h4>
          ${renderBarChart(doseChangeTrend, [], { label: "Dose changes", color: CHART_COLORS.doseChangeMarker })}
        </article>
      ` : ""}

      <article class="card">
        <h3>Before/After comparison around a medication change</h3>
        ${renderBeforeAfterComparison(filtered)}
      </article>

      ${showAdvancedTimeline ? `
        <article class="card">
          <h3>Timeline</h3>
          ${renderCombinedTimeline(filtered)}
        </article>
      ` : ""}
    </div>
  `;

  root.querySelector("#timelineMedicationFilter")?.addEventListener("change", (event) => {
    app.ui.timelineFilters.medicationId = event.target.value;
    renderAll();
  });

  root.querySelector("#timelineFromDate")?.addEventListener("change", (event) => {
    app.ui.timelineFilters.fromDate = event.target.value;
    app.ui.timelineFilters.rangeDays = "";
    renderAll();
  });

  root.querySelector("#timelineToDate")?.addEventListener("change", (event) => {
    app.ui.timelineFilters.toDate = event.target.value;
    app.ui.timelineFilters.rangeDays = "";
    renderAll();
  });

  root.querySelectorAll("[data-range-days]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.timelineFilters.rangeDays = button.dataset.rangeDays || "14";
      app.ui.timelineFilters.fromDate = "";
      app.ui.timelineFilters.toDate = "";
      renderAll();
    });
  });

  const comparisonSelect = root.querySelector("#comparisonChangeSelect");
  if (comparisonSelect) {
    comparisonSelect.addEventListener("change", () => {
      app.ui.comparisonChangeId = comparisonSelect.value;
      renderAll();
    });
  }

  root.querySelectorAll("[data-empty-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.emptyAction;
      if (action === "checkin") {
        app.ui.activeSection = "entry";
        app.ui.entryWorkflow = "checkin";
      } else if (action === "change") {
        app.ui.activeSection = "entry";
        app.ui.entryWorkflow = "change";
      }
      renderAll();
    });
  });
}

function applyTimelineFilters(data) {
  const medicationId = app.ui.timelineFilters.medicationId || "all";
  const selectedMedication = (data.medications || []).find((med) => med.id === medicationId);
  const selectedKey = selectedMedication ? normalizeMedicationKey(selectedMedication.name) : "";
  let fromDate = app.ui.timelineFilters.fromDate || "";
  let toDate = app.ui.timelineFilters.toDate || "";
  const rangeDays = Number(app.ui.timelineFilters.rangeDays || 0);

  if (!fromDate && !toDate && Number.isFinite(rangeDays) && rangeDays > 0) {
    toDate = getLocalDateKey(new Date());
    fromDate = shiftDateKey(toDate, -(rangeDays - 1));
  }

  const inDateWindow = (value) => {
    if (!value) return true;
    if (fromDate && value < fromDate) return false;
    if (toDate && value > toDate) return false;
    return true;
  };

  const changes = (data.changes || []).filter((change) => {
    if (!inDateWindow(change.date)) return false;
    if (medicationId === "all") return true;
    if (change.medicationId && change.medicationId === medicationId) return true;
    if (change.medicationName && normalizeMedicationKey(change.medicationName) === selectedKey) return true;
    return false;
  });

  const notes = (data.notes || []).filter((note) => {
    if (!inDateWindow(note.date)) return false;
    if (medicationId === "all") return true;
    if (note.medicationId && note.medicationId === medicationId) return true;
    if (note.medicationName && normalizeMedicationKey(note.medicationName) === selectedKey) return true;
    return false;
  });

  const checkins = (data.checkins || []).filter((checkin) => inDateWindow(checkin.date));
  const adherence = (data.adherence || []).filter((entry) => inDateWindow(entry.date));
  return {
    ...data,
    changes,
    notes,
    checkins,
    adherence
  };
}

function renderCombinedTimeline(data) {
  const events = [];

  for (const change of data.changes) {
    events.push({
      date: change.date,
      type: "Medication change",
      detail: `${change.medicationName || "Medication"}: ${change.oldDose || "-"} → ${change.newDose || "-"}`
    });
  }

  for (const checkin of data.checkins) {
    events.push({
      date: checkin.date,
      type: "Check-in",
      detail: `Mood ${checkin.mood}/10, Anxiety ${checkin.anxiety}/10, Focus ${checkin.focus}/10`
    });
  }

  for (const note of data.notes) {
    events.push({
      date: note.date,
      type: `Note (${note.noteType.replaceAll("_", " ")})`,
      detail: note.noteText || ""
    });
  }

  const sorted = events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  if (!sorted.length) {
    return `<div class="empty">No timeline events yet.${getActiveContext().readOnly ? "" : ` <button class="btn btn-secondary small" type="button" data-empty-action="checkin">Add check-in</button>`}</div>`;
  }

  return `
    <ul class="timeline-list">
      ${sorted.map((event) => `<li><strong>${escapeHtml(niceDate(event.date))}</strong> · ${escapeHtml(event.type)} · ${escapeHtml(event.detail)}</li>`).join("")}
    </ul>
  `;
}

function renderBeforeAfterComparison(data) {
  if (!data.changes.length) {
    return `<div class="empty">No medication changes available for comparison.${getActiveContext().readOnly ? "" : ` <button class="btn btn-secondary small" type="button" data-empty-action="change">Log a medication change</button>`}</div>`;
  }

  const sortedChanges = data.changes.slice().sort((a, b) => b.date.localeCompare(a.date));
  const selectedId = sortedChanges.find((item) => item.id === app.ui.comparisonChangeId)?.id || sortedChanges[0].id;
  app.ui.comparisonChangeId = selectedId;

  const selectedChange = sortedChanges.find((item) => item.id === selectedId);
  const result = computeBeforeAfterMetrics(data.checkins, selectedChange.date);

  return `
    <div class="field-grid">
      <div>
        <label for="comparisonChangeSelect">Select change</label>
        <select id="comparisonChangeSelect">
          ${sortedChanges.map((change) => `<option value="${change.id}" ${change.id === selectedId ? "selected" : ""}>${escapeHtml(niceDate(change.date))} · ${escapeHtml(change.medicationName || "Medication")} (${escapeHtml(change.oldDose || "-")} → ${escapeHtml(change.newDose || "-")})</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="table-wrap" style="margin-top:10px;">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>7 days before</th>
            <th>14 days after</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>
          ${["mood", "anxiety", "focus", "sleepHours"].map((metric) => {
            const before = result.before[metric];
            const after = result.after[metric];
            const delta = roundNumber(after - before, 2);
            return `<tr><td>${escapeHtml(metric)}</td><td>${roundNumber(before, 2)}</td><td>${roundNumber(after, 2)}</td><td>${delta >= 0 ? "+" : ""}${delta}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <p class="subtle">Window uses 7 days before and 14 days after ${escapeHtml(niceDate(selectedChange.date))}. Interpret trends in clinical context.</p>
  `;
}

function renderEntryWorkflows(root, data, context) {
  if (context.readOnly) {
    root.innerHTML = `<div class="empty">Entry workflows are disabled in read-only mode.</div>`;
    return;
  }

  const workflowTabs = [
    { id: "medication", label: "Add Current Medication" },
    { id: "change", label: "Log Medication Change" },
    { id: "note", label: "Log Effects / Side Effects Note" },
    { id: "checkin", label: "Daily Wellbeing Check-in" }
  ];

  root.innerHTML = `
    <div class="chip-group">
      ${workflowTabs.map((workflow) => `<button class="chip ${app.ui.entryWorkflow === workflow.id ? "active" : ""}" type="button" data-workflow="${workflow.id}">${workflow.label}</button>`).join("")}
    </div>

    <p class="autosave-indicator">${escapeHtml(renderDraftSaveLabel())}</p>

    <div style="margin-top: 12px;">
      ${renderWorkflowForm(data)}
    </div>
  `;

  root.querySelectorAll("[data-workflow]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.entryWorkflow = button.dataset.workflow;
      renderAll();
    });
  });

  bindWorkflowFormHandlers(root, data);
}

function renderDraftSaveLabel() {
  if (!app.ui.lastDraftSavedAt) {
    return "Draft autosave is on.";
  }
  const savedAt = new Date(app.ui.lastDraftSavedAt);
  if (Number.isNaN(savedAt.getTime())) {
    return "Draft autosave is on.";
  }
  const secondsAgo = Math.max(0, Math.floor((Date.now() - savedAt.getTime()) / 1000));
  if (secondsAgo < 60) return "Saved just now.";
  if (secondsAgo < 3600) return `Saved ${Math.floor(secondsAgo / 60)}m ago.`;
  return `Saved ${niceDateTime(savedAt.toISOString())}.`;
}

function renderWorkflowForm(data) {
  if (app.ui.entryWorkflow === "medication") {
    const draft = app.drafts.medication || {};
    const selectedPreset = normalizeSchedulePresetValue(draft.schedulePreset || "custom");
    return `
      <form id="formMedication" class="card">
        <h3>Add Current Medication</h3>
        <div class="field-grid">
          <div>
            <label>Medication name</label>
            <input name="name" list="commonMedicationNames" value="${escapeHtml(draft.name || "")}" placeholder="Start typing medication name" required>
            <p class="helper-text">Autocomplete shows names already used in your tracker.</p>
          </div>
          <div>
            <label>Generic name</label>
            <input name="genericName" value="${escapeHtml(draft.genericName || "")}">
          </div>
          <div>
            <label>Brand name</label>
            <input name="brandName" value="${escapeHtml(draft.brandName || "")}">
          </div>
          <div>
            <label>Current dose</label>
            <input name="currentDose" placeholder="e.g. 40 mg" value="${escapeHtml(draft.currentDose || "")}" required>
            <p class="helper-text">Include number and unit, for example 100 mg.</p>
          </div>
          <div>
            <label>Route</label>
            <select name="route">
              ${["oral", "transdermal", "sublingual", "injectable", "other"].map((route) => `<option value="${route}" ${draft.route === route ? "selected" : ""}>${route}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Start date</label>
            <input name="startDate" type="date" value="${escapeHtml(draft.startDate || isoDate(new Date()))}" required>
          </div>
          <div>
            <label>Schedule preset</label>
            <select name="schedulePreset" id="medSchedulePreset">
              ${SCHEDULE_PRESET_ORDER.map((key) => `<option value="${key}" ${selectedPreset === key ? "selected" : ""}>${escapeHtml(SCHEDULE_PRESETS[key].label)}</option>`).join("")}
            </select>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Schedule times (HH:MM, comma separated)</label>
            <input name="scheduleTimes" id="medScheduleTimes" value="${escapeHtml(draft.scheduleTimes || "")}" placeholder="08:00, 14:00">
            <p class="helper-text">Use 24-hour times. Presets can auto-fill common schedules.</p>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Indication (why taken)</label>
            <textarea name="indication">${escapeHtml(draft.indication || "")}</textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>MOA simple bullets (one per line)</label>
            <textarea name="moaSimple">${escapeHtml(draft.moaSimple || "")}</textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>MOA technical explanation</label>
            <textarea name="moaTechnical">${escapeHtml(draft.moaTechnical || "")}</textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Common side effects and what to monitor</label>
            <textarea name="monitor">${escapeHtml(draft.monitor || "")}</textarea>
          </div>
        </div>
        <div class="inline-row" style="margin-top:10px;">
          <button class="btn btn-primary btn-large" type="submit">Add medication</button>
          <button class="btn btn-secondary" type="button" data-reset-draft="medication">Clear draft</button>
        </div>
        <p class="safety-footnote">MOA and interpretation text is informational. Discuss with prescriber.</p>
      </form>
    `;
  }

  if (app.ui.entryWorkflow === "change") {
    const draft = app.drafts.change || {};
    return `
      <form id="formChange" class="card">
        <h3>Log Medication Change</h3>
        <div class="field-grid">
          <div>
            <label>Date</label>
            <input name="date" type="date" value="${escapeHtml(draft.date || isoDate(new Date()))}" required>
          </div>
          <div>
            <label>Medication</label>
            <input name="medicationName" list="commonMedicationNames" value="${escapeHtml(draft.medicationName || "")}" required>
            <p class="helper-text">Pick or type the medication name exactly.</p>
          </div>
          <div>
            <label>Old dose</label>
            <input name="oldDose" value="${escapeHtml(draft.oldDose || "")}" required>
          </div>
          <div>
            <label>New dose</label>
            <input name="newDose" value="${escapeHtml(draft.newDose || "")}" required>
            <p class="helper-text">Example format: 40 mg daily.</p>
          </div>
          <div>
            <label>Route (optional)</label>
            <input name="route" value="${escapeHtml(draft.route || "")}" placeholder="oral, transdermal, etc">
          </div>
          <div>
            <label>Changed by</label>
            <select name="changedBy">
              ${["self", "psychiatrist", "gp", "clinician", "other"].map((role) => `<option value="${role}" ${String(draft.changedBy || "self") === role ? "selected" : ""}>${escapeHtml(role)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Review date (optional)</label>
            <input name="reviewDate" type="date" value="${escapeHtml(draft.reviewDate || "")}">
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Reason for change</label>
            <textarea name="reason" required>${escapeHtml(draft.reason || draft.reasonForChange || "")}</textarea>
            <p class="helper-text">Use neutral language describing what changed and why.</p>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Expected effects (optional)</label>
            <textarea name="expectedEffects">${escapeHtml(draft.expectedEffects || "")}</textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>What to monitor (optional)</label>
            <textarea name="monitorFor">${escapeHtml(draft.monitorFor || "")}</textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Notes (optional)</label>
            <textarea name="notes">${escapeHtml(draft.notes || "")}</textarea>
          </div>
        </div>
        <div class="interpret-card">
          <h4>Change interpretation card (editable template)</h4>
          <div class="field-grid">
            <div style="grid-column: 1 / -1;"><label>Short term (1-7 days)</label><textarea name="shortTerm">${escapeHtml(draft.shortTerm || "")}</textarea></div>
            <div style="grid-column: 1 / -1;"><label>Longer term (2-6 weeks)</label><textarea name="longTerm">${escapeHtml(draft.longTerm || "")}</textarea></div>
            <div style="grid-column: 1 / -1;"><label>What to monitor</label><textarea name="monitor">${escapeHtml(draft.monitor || "")}</textarea></div>
            <div style="grid-column: 1 / -1;"><label>Improvement markers</label><textarea name="improvement">${escapeHtml(draft.improvement || "")}</textarea></div>
            <div style="grid-column: 1 / -1;"><label>Deterioration markers</label><textarea name="deterioration">${escapeHtml(draft.deterioration || "")}</textarea></div>
            <div style="grid-column: 1 / -1;"><label>Uncertainty note</label><textarea name="uncertainty">${escapeHtml(draft.uncertainty || "")}</textarea></div>
          </div>
        </div>
        <div class="inline-row" style="margin-top:10px;">
          <button class="btn btn-secondary" type="button" id="fillInterpretationTemplate">Apply template</button>
          <button class="btn btn-primary btn-large" type="submit">Log medication change</button>
          <button class="btn btn-secondary" type="button" data-reset-draft="change">Clear draft</button>
        </div>
        <p class="safety-footnote">Interpretation language uses probabilities only and does not replace prescriber advice.</p>
      </form>
    `;
  }

  if (app.ui.entryWorkflow === "note") {
    const draft = app.drafts.note || {};
    return `
      <form id="formNote" class="card">
        <h3>Log Effects / Side Effects Note</h3>
        <div class="field-grid">
          <div>
            <label>Date</label>
            <input name="date" type="date" value="${escapeHtml(draft.date || isoDate(new Date()))}" required>
          </div>
          <div>
            <label>Medication (optional)</label>
            <input name="medicationName" list="commonMedicationNames" value="${escapeHtml(draft.medicationName || "")}">
          </div>
          <div>
            <label>Note category</label>
            <select name="noteType">
              ${[
                ["effect", "Effect"],
                ["side_effect", "Side effect"],
                ["journal", "Journal"],
                ["libido", "Libido / sexual side effects"],
                ["substance", "Substance-use notes"],
                ["free_text", "General free-text"]
              ].map(([key, label]) => `<option value="${key}" ${draft.noteType === key ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Severity</label>
            <select name="severity">
              ${["mild", "moderate", "high"].map((level) => `<option value="${level}" ${draft.severity === level ? "selected" : ""}>${level}</option>`).join("")}
            </select>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Tags (comma separated, optional)</label>
            <input name="tags" value="${escapeHtml(draft.tags || "")}" placeholder="e.g. daytime, sedation, sensitive">
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Side effects checklist</label>
            <div class="checklist">
              ${SIDE_EFFECT_OPTIONS.map((item) => `
                <label class="check-item">
                  <input type="checkbox" name="checklist" value="${escapeHtml(item)}" ${Array.isArray(draft.checklist) && draft.checklist.includes(item) ? "checked" : ""}>
                  <span>${escapeHtml(item)}</span>
                </label>
              `).join("")}
            </div>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Note text</label>
            <textarea name="noteText" required>${escapeHtml(draft.noteText || "")}</textarea>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Training / exercise notes</label>
            <textarea name="trainingNotes">${escapeHtml(draft.trainingNotes || "")}</textarea>
          </div>
          <div>
            <label class="check-item">
              <input type="checkbox" name="isSensitive" ${draft.isSensitive ? "checked" : ""}>
              <span>Mark as sensitive note</span>
            </label>
          </div>
        </div>
        <div class="inline-row" style="margin-top:10px;">
          <button class="btn btn-primary btn-large" type="submit">Log note</button>
          <button class="btn btn-secondary" type="button" data-reset-draft="note">Clear draft</button>
        </div>
      </form>
    `;
  }

  const draft = app.drafts.checkin || {};
  return `
    <form id="formCheckin" class="card">
      <h3>Daily Wellbeing Check-in</h3>
      <div class="field-grid">
        <div><label>Date</label><input name="date" type="date" value="${escapeHtml(draft.date || isoDate(new Date()))}" required></div>
        <div><label>Mood (1-10)</label><input name="mood" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.mood, 6))}" required></div>
        <div><label>Anxiety (1-10)</label><input name="anxiety" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.anxiety, 5))}" required></div>
        <div><label>Focus (1-10)</label><input name="focus" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.focus, 6))}" required></div>
        <div><label>Sleep hours</label><input name="sleepHours" type="number" step="0.1" min="0" max="24" value="${escapeHtml(valueOrDefault(draft.sleepHours, 7))}" required></div>
        <div><label>Sleep quality (1-10)</label><input name="sleepQuality" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.sleepQuality, 6))}" required></div>
        <div><label>Appetite (1-10)</label><input name="appetite" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.appetite, 5))}" required></div>
        <div><label>Energy (1-10)</label><input name="energy" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.energy, 6))}" required></div>
        <div><label>Irritability (1-10)</label><input name="irritability" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.irritability, 4))}" required></div>
        <div><label>Cravings / impulsivity (1-10)</label><input name="cravingsImpulsivity" type="number" min="1" max="10" value="${escapeHtml(valueOrDefault(draft.cravingsImpulsivity, 4))}" required></div>
      </div>

      <label style="margin-top:10px;">Side effects checklist</label>
      <div class="checklist">
        ${SIDE_EFFECT_OPTIONS.map((item) => `
          <label class="check-item">
            <input type="checkbox" name="sideEffectsChecklist" value="${escapeHtml(item)}" ${Array.isArray(draft.sideEffectsChecklist) && draft.sideEffectsChecklist.includes(item) ? "checked" : ""}>
            <span>${escapeHtml(item)}</span>
          </label>
        `).join("")}
      </div>
      <p class="helper-text">Keep this quick and consistent for cleaner trend charts.</p>

      <div class="field-grid" style="margin-top:10px;">
        <div style="grid-column: 1 / -1;"><label>Side effects free text</label><textarea name="sideEffectsText">${escapeHtml(draft.sideEffectsText || "")}</textarea></div>
        <div style="grid-column: 1 / -1;"><label>Training / exercise notes</label><textarea name="trainingNotes">${escapeHtml(draft.trainingNotes || "")}</textarea></div>
        <div><label>Weight (optional)</label><input name="weight" value="${escapeHtml(draft.weight || "")}"></div>
        <div><label>BP systolic (optional)</label><input name="bpSystolic" value="${escapeHtml(draft.bpSystolic || "")}"></div>
        <div><label>BP diastolic (optional)</label><input name="bpDiastolic" value="${escapeHtml(draft.bpDiastolic || "")}"></div>
        <div><label>HR (optional)</label><input name="hr" value="${escapeHtml(draft.hr || "")}"></div>
      </div>

      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-primary btn-large" type="submit">Save daily check-in</button>
        <button class="btn btn-secondary" type="button" data-reset-draft="checkin">Clear draft</button>
      </div>
    </form>
  `;
}

function bindWorkflowFormHandlers(root, data) {
  const medicationForm = root.querySelector("#formMedication");
  if (medicationForm) {
    medicationForm.addEventListener("input", () => {
      app.drafts.medication = formToObject(medicationForm);
      saveDrafts();
    });

    const schedulePreset = medicationForm.querySelector("#medSchedulePreset");
    const scheduleTimes = medicationForm.querySelector("#medScheduleTimes");

    schedulePreset.addEventListener("change", () => {
      const presetKey = normalizeSchedulePresetValue(schedulePreset.value);
      schedulePreset.value = presetKey;
      const preset = SCHEDULE_PRESETS[presetKey];
      if (preset && preset.times.length) {
        scheduleTimes.value = preset.times.join(", ");
      }
      app.drafts.medication = formToObject(medicationForm);
      saveDrafts();
    });

    medicationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formToObject(medicationForm);

      if (!doseLooksValid(values.currentDose)) {
        return setStatus("Dose format looks invalid. Use a number and unit (for example: 40 mg).", "error");
      }

      const normalizedSchedulePreset = normalizeSchedulePresetValue(values.schedulePreset);
      const normalizedScheduleTimes = normalizeTimes((values.scheduleTimes || "").split(",").map((item) => item.trim()));
      const invalidTime = normalizedScheduleTimes.find((time) => !isTimeValue(time));
      if (invalidTime) {
        return setStatus(`Schedule time "${invalidTime}" is invalid. Use HH:MM (24-hour).`, "error");
      }

      const duplicate = app.ownerData.medications.find(
        (entry) => entry.active && entry.name.trim().toLowerCase() === (values.name || "").trim().toLowerCase()
      );

      if (duplicate) {
        return setStatus("Duplicate warning: an active medication with this name already exists.", "error");
      }

      const now = isoDateTime(new Date());
      app.ownerData.medications.push({
        id: uid(),
        name: values.name,
        genericName: values.genericName || "",
        brandName: values.brandName || "",
        route: values.route || "oral",
        currentDose: values.currentDose,
        schedulePreset: normalizedSchedulePreset,
        scheduleTimes: normalizedScheduleTimes,
        startDate: values.startDate,
        indication: values.indication || "",
        moaSimple: (values.moaSimple || "").split("\n").map((line) => line.trim()).filter(Boolean),
        moaTechnical: values.moaTechnical || "",
        timeCourseNotes: "",
        adjustmentAcute: "",
        adjustmentChronic: "",
        interactionsNotes: "",
        contraindicationsNotes: "",
        commonSideEffects: "",
        monitor: values.monitor || "",
        questions: "",
        active: true,
        createdAt: now,
        updatedAt: now
      });

      saveOwnerData(app.ownerData);
      app.drafts.medication = {};
      saveDrafts();
      hydrateMedicationNameOptions();
      setStatus("Medication added.");
      renderAll();
    });
  }

  const changeForm = root.querySelector("#formChange");
  if (changeForm) {
    changeForm.addEventListener("input", () => {
      app.drafts.change = formToObject(changeForm);
      saveDrafts();
    });

    const fillTemplateButton = root.querySelector("#fillInterpretationTemplate");
    fillTemplateButton.addEventListener("click", () => {
      const values = formToObject(changeForm);
      const template = generateInterpretationTemplate(values);
      changeForm.elements.shortTerm.value = template.shortTerm;
      changeForm.elements.longTerm.value = template.longTerm;
      changeForm.elements.monitor.value = template.monitor;
      changeForm.elements.improvement.value = template.improvement;
      changeForm.elements.deterioration.value = template.deterioration;
      changeForm.elements.uncertainty.value = template.uncertainty;
      app.drafts.change = formToObject(changeForm);
      saveDrafts();
    });

    changeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formToObject(changeForm);

      if (!doseLooksValid(values.oldDose) || !doseLooksValid(values.newDose)) {
        return setStatus("Dose validation failed. Include numeric dose and unit.", "error");
      }

      const duplicate = app.ownerData.changes.find(
        (entry) =>
          entry.date === values.date &&
          entry.medicationName.trim().toLowerCase() === values.medicationName.trim().toLowerCase() &&
          entry.newDose.trim().toLowerCase() === values.newDose.trim().toLowerCase()
      );

      if (duplicate) {
        return setStatus("Duplicate warning: this change already exists.", "error");
      }

      const medication = app.ownerData.medications.find((entry) => entry.name.toLowerCase() === values.medicationName.toLowerCase());

      app.ownerData.changes.push({
        id: uid(),
        medicationId: medication?.id || "",
        medicationName: values.medicationName,
        date: values.date,
        oldDose: values.oldDose,
        newDose: values.newDose,
        reason: values.reason,
        reasonForChange: values.reason,
        route: values.route || "",
        changedBy: values.changedBy || "self",
        expectedEffects: values.expectedEffects || "",
        monitorFor: values.monitorFor || values.monitor || "",
        reviewDate: values.reviewDate || "",
        notes: values.notes || "",
        interpretation: normalizeInterpretation({
          shortTerm: values.shortTerm,
          longTerm: values.longTerm,
          monitor: values.monitor,
          improvement: values.improvement,
          deterioration: values.deterioration,
          uncertainty: values.uncertainty
        }),
        createdAt: isoDateTime(new Date())
      });

      if (medication) {
        medication.currentDose = values.newDose;
        medication.updatedAt = isoDateTime(new Date());
      }

      saveOwnerData(app.ownerData);
      app.drafts.change = {};
      saveDrafts();
      setStatus("Medication change logged.");
      renderAll();
    });

    if (!app.drafts.change?.shortTerm && !app.drafts.change?.longTerm) {
      fillTemplateButton.click();
    }
  }

  const noteForm = root.querySelector("#formNote");
  if (noteForm) {
    noteForm.addEventListener("input", () => {
      app.drafts.note = formToObject(noteForm);
      app.drafts.note.checklist = checkedValues(noteForm, "checklist");
      app.drafts.note.isSensitive = noteForm.elements.isSensitive.checked;
      saveDrafts();
    });

    noteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formToObject(noteForm);
      const checklist = checkedValues(noteForm, "checklist");

      if (!values.noteText.trim() && !checklist.length) {
        return setStatus("Add note text or checklist items.", "error");
      }

      app.ownerData.notes.push({
        id: uid(),
        date: values.date,
        medicationId: app.ownerData.medications.find((entry) => entry.name.toLowerCase() === values.medicationName.toLowerCase())?.id || "",
        medicationName: values.medicationName || "",
        noteType: values.noteType,
        severity: values.severity,
        checklist,
        tags: normalizeTags(values.tags || ""),
        noteText: values.noteText,
        trainingNotes: values.trainingNotes || "",
        isSensitive: Boolean(noteForm.elements.isSensitive.checked || values.noteType === "journal"),
        createdAt: isoDateTime(new Date())
      });

      saveOwnerData(app.ownerData);
      app.drafts.note = {};
      saveDrafts();
      setStatus("Effects note logged.");
      renderAll();
    });
  }

  const checkinForm = root.querySelector("#formCheckin");
  if (checkinForm) {
    checkinForm.addEventListener("input", () => {
      app.drafts.checkin = formToObject(checkinForm);
      app.drafts.checkin.sideEffectsChecklist = checkedValues(checkinForm, "sideEffectsChecklist");
      saveDrafts();
    });

    checkinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formToObject(checkinForm);
      const checklist = checkedValues(checkinForm, "sideEffectsChecklist");

      const duplicate = app.ownerData.checkins.find((entry) => entry.date === values.date);

      const rangeValid = ["mood", "anxiety", "focus", "sleepQuality", "appetite", "energy", "irritability", "cravingsImpulsivity"].every((field) => {
        const value = Number(values[field]);
        return Number.isFinite(value) && value >= 1 && value <= 10;
      });

      if (!rangeValid) {
        return setStatus("Validation failed: 1-10 fields must be within range.", "error");
      }

      const nowIso = isoDateTime(new Date());
      const payload = normalizeCheckin({
        id: duplicate?.id || uid(),
        date: values.date,
        mood: Number(values.mood),
        anxiety: Number(values.anxiety),
        focus: Number(values.focus),
        sleepHours: Number(values.sleepHours),
        sleepQuality: Number(values.sleepQuality),
        appetite: Number(values.appetite),
        energy: Number(values.energy),
        irritability: Number(values.irritability),
        cravingsImpulsivity: Number(values.cravingsImpulsivity),
        sideEffectsChecklist: checklist,
        sideEffectsText: values.sideEffectsText || "",
        trainingNotes: values.trainingNotes || "",
        vitals: {
          weight: values.weight || "",
          bpSystolic: values.bpSystolic || "",
          bpDiastolic: values.bpDiastolic || "",
          hr: values.hr || ""
        },
        createdAt: duplicate?.createdAt || nowIso,
        updatedAt: nowIso
      });

      if (duplicate) {
        app.ownerData.checkins = app.ownerData.checkins.map((entry) => (entry.id === duplicate.id ? payload : entry));
      } else {
        app.ownerData.checkins.push(payload);
      }

      saveOwnerData(app.ownerData);
      app.drafts.checkin = {};
      saveDrafts();
      setStatus(duplicate ? "Daily check-in updated." : "Daily check-in saved.");
      renderAll();
    });
  }

  root.querySelectorAll("[data-reset-draft]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.resetDraft;
      app.drafts[key] = {};
      saveDrafts();
      setStatus("Draft cleared.");
      renderAll();
    });
  });
}

function renderSharing(root, _data, context) {
  if (context.readOnly) {
    root.innerHTML = `<div class="empty">Sharing management is available in owner mode only.</div>`;
    return;
  }

  if (hasCloudSession() && !app.cloud.loaded) {
    void refreshCloudSideData().then(() => {
      renderAll();
    });
  }

  const defaultPreset = PRESETS.family;
  const toggles = normalizePermissions(app.drafts.sharePermissions || defaultPreset.permissions);
  const draftShare = app.drafts.share || {};
  const selectedPresetKey = draftShare.preset || "family";
  const selectedPreset = PRESETS[selectedPresetKey] || PRESETS.family;
  const today = getLocalDateKey(new Date());
  const defaultExpiry = draftShare.expiresAt || shiftDateKey(today, 30);
  const reminderSettings = normalizeReminderSettings(app.ownerData.reminderSettings);
  const ownerProfile = normalizeOwnerProfile(app.ownerData.profile);
  const warningSigns = normalizeWarningSigns(app.ownerData.warningSigns);
  const riskConfig = normalizeRiskConfig(app.ownerData.riskConfig);
  const syncStatus = app.sync.status === "connected"
    ? `Connected${app.sync.lastSyncedAt ? ` · last sync ${niceDateTime(app.sync.lastSyncedAt)}` : ""}`
    : app.sync.status === "syncing"
      ? "Syncing..."
      : app.sync.status === "auth-required"
        ? "Sign in required"
      : app.sync.status === "error"
        ? `Error: ${app.sync.lastError || "Unable to sync"}`
        : "Local-only mode";
  const signedInRole = String(app.syncConfig.authRole || "").toLowerCase();
  const signedInName = app.syncConfig.authUser?.name || app.syncConfig.authUser?.email || "";
  const signedInSummary = hasCloudSession()
    ? `Signed in as ${signedInName || "user"} (${signedInRole || "viewer"})`
    : "Not signed in";
  const syncDisabledAttr = LOCAL_ONLY_MODE ? "disabled" : "";
  const syncHelperText = LOCAL_ONLY_MODE
    ? "Cloud sync is disabled in this build. Your data stays in this browser."
    : "Example: https://api.yourdomain.com";
  const cloudInvites = Array.isArray(app.cloud.invites) ? app.cloud.invites : [];
  const cloudAudit = Array.isArray(app.cloud.audit) ? app.cloud.audit : [];
  const cloudNotifications = Array.isArray(app.cloud.notifications) ? app.cloud.notifications : [];
  const isOwnerSession = signedInRole === "owner";

  root.innerHTML = `
    <div class="card">
      <h3>Cloud account and invites</h3>
      <div class="subtle">${escapeHtml(signedInSummary)}</div>
      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-ghost" type="button" id="refreshCloudMetaButton" ${syncDisabledAttr}>Refresh cloud status</button>
        ${hasCloudSession() ? `<button class="btn btn-secondary" type="button" id="cloudLogoutButton" ${syncDisabledAttr}>Sign out</button>` : ""}
      </div>

      ${hasCloudSession() ? `
        <div class="field-grid" style="margin-top:12px;">
          <div>
            <label>Cloud account role</label>
            <div class="subtle">${escapeHtml(signedInRole || "viewer")}</div>
          </div>
          <div>
            <label>Account ID</label>
            <div class="subtle">${escapeHtml(app.syncConfig.accountId || "default")}</div>
          </div>
        </div>
      ` : `
        <div class="field-grid" style="margin-top:12px;">
          <form id="cloudRegisterForm">
            <h4>Create owner account</h4>
            <label>Email</label>
            <input name="email" type="email" required placeholder="owner@example.com" ${syncDisabledAttr}>
            <label>Password</label>
            <input name="password" type="password" minlength="8" required ${syncDisabledAttr}>
            <label>Name</label>
            <input name="name" placeholder="Owner name" ${syncDisabledAttr}>
            <label>Account ID</label>
            <input name="accountId" value="${escapeHtml(app.syncConfig.accountId || "default")}" ${syncDisabledAttr}>
            <button class="btn btn-secondary" type="submit" style="margin-top:8px;" ${syncDisabledAttr}>Register owner</button>
          </form>
          <form id="cloudLoginForm">
            <h4>Sign in</h4>
            <label>Email</label>
            <input name="email" type="email" required placeholder="you@example.com" ${syncDisabledAttr}>
            <label>Password</label>
            <input name="password" type="password" required ${syncDisabledAttr}>
            <label>Account ID (optional)</label>
            <input name="accountId" value="${escapeHtml(app.syncConfig.accountId || "default")}" ${syncDisabledAttr}>
            <button class="btn btn-primary" type="submit" style="margin-top:8px;" ${syncDisabledAttr}>Sign in</button>
          </form>
        </div>
        <form id="cloudAcceptInviteForm" style="margin-top:12px;">
          <h4>Accept invite</h4>
          <div class="field-grid">
            <div>
              <label>Invite token</label>
              <input name="token" value="${escapeHtml(app.drafts.cloudInviteToken || "")}" placeholder="Paste invite token" ${syncDisabledAttr}>
            </div>
            <div>
              <label>Password</label>
              <input name="password" type="password" minlength="8" placeholder="Required (new user or existing account check)" ${syncDisabledAttr}>
            </div>
            <div>
              <label>Name (for first-time account)</label>
              <input name="name" placeholder="Optional display name" ${syncDisabledAttr}>
            </div>
          </div>
          <button class="btn btn-secondary" type="submit" style="margin-top:8px;" ${syncDisabledAttr}>Accept invite</button>
        </form>
      `}

      ${hasCloudSession() && isOwnerSession ? `
        <form id="cloudCreateInviteForm" style="margin-top:12px;">
          <h4>Invite collaborator</h4>
          <div class="field-grid">
            <div>
              <label>Email</label>
              <input name="email" type="email" required placeholder="clinician@example.com">
            </div>
            <div>
              <label>Name</label>
              <input name="name" placeholder="Recipient name">
            </div>
            <div>
              <label>Role</label>
              <select name="role">
                <option value="viewer">Viewer</option>
                <option value="family">Family</option>
                <option value="clinician">Clinician</option>
              </select>
            </div>
            <div>
              <label>Expiry</label>
              <input name="expiresAt" type="date" value="${escapeHtml(defaultExpiry)}">
            </div>
          </div>
          <button class="btn btn-secondary" type="submit" style="margin-top:8px;">Create invite</button>
        </form>
        <div style="margin-top:12px;">
          <h4>Pending and recent invites</h4>
          ${cloudInvites.length ? `
            <div class="timeline-list">
              ${cloudInvites.slice(0, 20).map((invite) => {
                const status = invite.revokedAt ? "revoked" : invite.acceptedAt ? "accepted" : (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now() ? "expired" : "pending");
                return `
                  <div class="timeline-item">
                    <div><strong>${escapeHtml(invite.email || "Invite")}</strong> · ${escapeHtml(invite.role || "viewer")} · ${escapeHtml(status)}</div>
                    <div class="subtle">Created ${escapeHtml(niceDateTime(invite.createdAt || ""))}${invite.acceptedAt ? ` · accepted ${escapeHtml(niceDateTime(invite.acceptedAt))}` : ""}</div>
                    ${status === "pending" ? `<button class="btn btn-ghost small" type="button" data-cloud-revoke-invite="${escapeHtml(invite.id)}">Revoke</button>` : ""}
                  </div>
                `;
              }).join("")}
            </div>
          ` : `<div class="subtle">No cloud invites yet.</div>`}
        </div>
      ` : ""}

      ${hasCloudSession() ? `
        <div style="margin-top:12px;">
          <h4>Recent cloud notifications</h4>
          ${cloudNotifications.length
            ? `<ul class="timeline-list">${cloudNotifications.slice(0, 8).map((item) => `<li>${escapeHtml(item.message || item.type || "Notification")} · ${escapeHtml(niceDateTime(item.createdAt || ""))}</li>`).join("")}</ul>`
            : `<div class="subtle">No cloud notifications yet.</div>`}
        </div>
      ` : ""}

      ${hasCloudSession() && isOwnerSession ? `
        <div style="margin-top:12px;">
          <h4>Recent audit events</h4>
          ${cloudAudit.length
            ? `<ul class="timeline-list">${cloudAudit.slice(0, 8).map((item) => `<li>${escapeHtml(item.action || "event")} · ${escapeHtml(niceDateTime(item.at || ""))}</li>`).join("")}</ul>`
            : `<div class="subtle">No audit events yet.</div>`}
        </div>
      ` : ""}
    </div>

    <div class="card">
      <h3>Settings, sync + reminders</h3>
      <div class="field-grid">
        <div>
          <label for="ownerDisplayName">Display name (optional)</label>
          <input id="ownerDisplayName" value="${escapeHtml(ownerProfile.displayName)}" placeholder="How you want the greeting to appear">
          <p class="helper-text">Used for dashboard greeting only on this device.</p>
        </div>
        <div>
          <label class="check-item">
            <input type="checkbox" id="personalizationEnabled" ${ownerProfile.personalizationEnabled ? "checked" : ""}>
            <span>Enable personalized greeting and consistency feedback</span>
          </label>
        </div>
      </div>
      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-secondary" type="button" id="saveProfileSettingsButton">Save personalization</button>
      </div>

      <hr class="soft">

      <div class="field-grid">
        <div>
          <label>Enable cloud sync</label>
          <label class="check-item">
            <input type="checkbox" id="syncEnabled" ${app.syncConfig.enabled ? "checked" : ""} ${syncDisabledAttr}>
            <span>Use backend persistence for multi-device access</span>
          </label>
        </div>
        <div>
          <label>Sync status</label>
          <div class="subtle">${escapeHtml(syncStatus)}</div>
        </div>
        <div>
          <label for="syncEndpoint">API endpoint</label>
          <input id="syncEndpoint" value="${escapeHtml(app.syncConfig.endpoint || "")}" placeholder="https://your-api.example.com" ${syncDisabledAttr}>
          <p class="helper-text">${escapeHtml(syncHelperText)}</p>
        </div>
        <div>
          <label for="syncAccountId">Account ID</label>
          <input id="syncAccountId" value="${escapeHtml(app.syncConfig.accountId || "default")}" ${syncDisabledAttr}>
        </div>
        <div style="grid-column: 1 / -1;">
          <label for="syncOwnerKey">Owner API key</label>
          <input id="syncOwnerKey" type="password" value="${escapeHtml(app.syncConfig.ownerKey || "")}" placeholder="Owner key for write access" ${syncDisabledAttr}>
        </div>
      </div>
      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-secondary" type="button" id="saveSyncConfigButton" ${syncDisabledAttr}>Save sync settings</button>
        <button class="btn btn-ghost" type="button" id="syncNowButton" ${syncDisabledAttr}>Sync now</button>
      </div>

      <hr class="soft">

      <div class="field-grid">
        <div>
          <label class="check-item">
            <input type="checkbox" id="remindersEnabled" ${reminderSettings.enabled ? "checked" : ""}>
            <span>Enable dose reminders</span>
          </label>
        </div>
        <div>
          <label for="reminderLeadMinutes">Reminder lead time</label>
          <select id="reminderLeadMinutes">
            ${[0, 5, 10, 15, 30, 45, 60].map((mins) => `<option value="${mins}" ${Number(reminderSettings.leadMinutes) === mins ? "selected" : ""}>${mins === 0 ? "At scheduled time" : `${mins} minutes before`}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="check-item">
            <input type="checkbox" id="desktopNotificationsEnabled" ${reminderSettings.desktopNotifications ? "checked" : ""}>
            <span>Desktop notifications</span>
          </label>
        </div>
        <div>
          <label class="check-item">
            <input type="checkbox" id="riskAlertsEnabled" ${reminderSettings.riskAlertsEnabled ? "checked" : ""}>
            <span>Risk threshold alerts</span>
          </label>
        </div>
        <div>
          <label for="riskAlertsMinLevel">Alert from risk level</label>
          <select id="riskAlertsMinLevel">
            ${["watch", "elevated", "high"].map((level) => `<option value="${level}" ${reminderSettings.riskAlertsMinLevel === level ? "selected" : ""}>${escapeHtml(level)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Notification permission</label>
          <div class="subtle">${"Notification" in window ? Notification.permission : "Not supported in this browser"}</div>
        </div>
      </div>
      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-secondary" type="button" id="saveReminderSettingsButton">Save reminder settings</button>
        <button class="btn btn-ghost" type="button" id="requestReminderPermissionButton">Request notification permission</button>
      </div>
    </div>

    <div class="card" style="margin-top:12px;">
      <h3>Warning signs + explainable risk thresholds</h3>
      <form id="riskConfigForm">
        <div class="field-grid">
          <div>
            <label for="riskMissedDoseWatch">Missed doses (Watch)</label>
            <input id="riskMissedDoseWatch" name="missedDoseWatch" type="number" min="0" max="10" value="${escapeHtml(String(riskConfig.missedDoseWatch))}">
          </div>
          <div>
            <label for="riskMissedDoseElevated">Missed doses (Elevated)</label>
            <input id="riskMissedDoseElevated" name="missedDoseElevated" type="number" min="0" max="10" value="${escapeHtml(String(riskConfig.missedDoseElevated))}">
          </div>
          <div>
            <label for="riskMissedDoseHigh">Missed doses (High)</label>
            <input id="riskMissedDoseHigh" name="missedDoseHigh" type="number" min="0" max="10" value="${escapeHtml(String(riskConfig.missedDoseHigh))}">
          </div>
          <div>
            <label for="riskAnxietyWatch">Anxiety threshold (Watch)</label>
            <input id="riskAnxietyWatch" name="anxietyWatch" type="number" min="1" max="10" value="${escapeHtml(String(riskConfig.anxietyWatch))}">
          </div>
          <div>
            <label for="riskAnxietyHigh">Anxiety threshold (High)</label>
            <input id="riskAnxietyHigh" name="anxietyHigh" type="number" min="1" max="10" value="${escapeHtml(String(riskConfig.anxietyHigh))}">
          </div>
          <div>
            <label for="riskLowSleepHours">Low-sleep threshold (hours)</label>
            <input id="riskLowSleepHours" name="lowSleepHours" type="number" min="0" max="24" step="0.1" value="${escapeHtml(String(riskConfig.lowSleepHours))}">
          </div>
          <div>
            <label for="riskNoCheckinHours">No check-in threshold (hours)</label>
            <input id="riskNoCheckinHours" name="noCheckinHours" type="number" min="1" max="168" value="${escapeHtml(String(riskConfig.noCheckinHours))}">
          </div>
          <div>
            <label for="riskSideEffectsWindowDays">Side effects window (days)</label>
            <input id="riskSideEffectsWindowDays" name="sideEffectsWindowDays" type="number" min="1" max="30" value="${escapeHtml(String(riskConfig.sideEffectsWindowDays))}">
          </div>
          <div>
            <label for="riskSideEffectsTriggerCount">Side effects trigger count</label>
            <input id="riskSideEffectsTriggerCount" name="sideEffectsTriggerCount" type="number" min="1" max="50" value="${escapeHtml(String(riskConfig.sideEffectsTriggerCount))}">
          </div>
          <div>
            <label for="riskWatchScore">Watch score threshold</label>
            <input id="riskWatchScore" name="watchScore" type="number" min="1" max="100" value="${escapeHtml(String(riskConfig.watchScore))}">
          </div>
          <div>
            <label for="riskElevatedScore">Elevated score threshold</label>
            <input id="riskElevatedScore" name="elevatedScore" type="number" min="1" max="100" value="${escapeHtml(String(riskConfig.elevatedScore))}">
          </div>
          <div>
            <label for="riskHighScore">High score threshold</label>
            <input id="riskHighScore" name="highScore" type="number" min="1" max="100" value="${escapeHtml(String(riskConfig.highScore))}">
          </div>
        </div>

        <h4 style="margin-top:12px;">Personal warning signs</h4>
        <div class="settings-warning-grid">
          ${warningSigns.map((sign) => `
            <article class="settings-warning-row">
              <div class="field-grid">
                <div>
                  <label>Label</label>
                  <input name="warningLabel__${sign.id}" value="${escapeHtml(sign.label)}" required>
                </div>
                <div>
                  <label>Category</label>
                  <select name="warningCategory__${sign.id}">
                    ${["sleep", "mood", "meds", "behaviour", "social", "custom"].map((category) => `<option value="${category}" ${sign.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label>Weight (1-5)</label>
                  <input name="warningWeight__${sign.id}" type="number" min="1" max="5" value="${escapeHtml(String(sign.severityWeight))}">
                </div>
                <div>
                  <label class="check-item">
                    <input type="checkbox" name="warningActive__${sign.id}" ${sign.active ? "checked" : ""}>
                    <span>Active</span>
                  </label>
                </div>
              </div>
            </article>
          `).join("")}
        </div>

        <div class="inline-row" style="margin-top:10px;">
          <button class="btn btn-secondary" type="button" id="addWarningSignButton">Add warning sign</button>
          <button class="btn btn-primary" type="submit">Save warning signs + thresholds</button>
        </div>
        <p class="helper-text">Risk status remains rule-based and explainable. No opaque AI predictions are used.</p>
      </form>
    </div>

    <div class="card">
      <h3>Create read-only link</h3>
      <form id="shareForm">
        <div class="field-grid">
          <div><label>Person name</label><input name="name" value="${escapeHtml(draftShare.name || "")}" required></div>
          <div><label>Email (optional)</label><input name="email" value="${escapeHtml(draftShare.email || "")}"></div>
          <div>
            <label>Role preset</label>
            <select name="preset" id="sharePresetSelect">
              ${Object.entries(PRESETS).map(([key, preset]) => `<option value="${key}" ${draftShare.preset === key ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}
            </select>
          </div>
          <div><label>Link expiry</label><input name="expiresAt" type="date" value="${escapeHtml(defaultExpiry)}"><p class="helper-text">Secure default is 30 days from today.</p></div>
        </div>

        <div class="card" style="margin-top:10px;">
          <h4>Per-link visibility toggles</h4>
          <div class="field-grid">
            ${renderPermissionToggle("showSensitiveNotes", "Show sensitive notes", toggles.showSensitiveNotes)}
            ${renderPermissionToggle("showSensitiveTags", "Show sensitive tags", toggles.showSensitiveTags)}
            ${renderPermissionToggle("showJournalText", "Show journal text", toggles.showJournalText)}
            ${renderPermissionToggle("showLibido", "Show libido / sexual side effects", toggles.showLibido)}
            ${renderPermissionToggle("showSubstance", "Show substance-use notes", toggles.showSubstance)}
            ${renderPermissionToggle("showFreeText", "Show free-text notes", toggles.showFreeText)}
          </div>

          <label style="margin-top:10px;">Allowed views</label>
          <div class="inline-row">
              ${["daily", "clinical", "personal"].map((mode) => {
                const checked = Array.isArray(draftShare.allowedModes)
                  ? draftShare.allowedModes.includes(mode)
                  : selectedPreset.defaultModes.includes(mode);
                return `<label class="check-item"><input type="checkbox" name="allowedModes" value="${mode}" ${checked ? "checked" : ""}><span>${escapeHtml(VIEW_MODE_META[mode].label)}</span></label>`;
              }).join("")}
            </div>
        </div>

        <div class="inline-row" style="margin-top:10px;">
          <button class="btn btn-primary" type="submit">Create read-only link</button>
        </div>
      </form>
    </div>

    <div class="card" style="margin-top:12px;">
      <h3>Existing shared links</h3>
      ${renderShareList()}
    </div>
  `;

  const shareForm = root.querySelector("#shareForm");
  const cloudRegisterForm = root.querySelector("#cloudRegisterForm");
  const cloudLoginForm = root.querySelector("#cloudLoginForm");
  const cloudAcceptInviteForm = root.querySelector("#cloudAcceptInviteForm");
  const cloudCreateInviteForm = root.querySelector("#cloudCreateInviteForm");
  const cloudLogoutButton = root.querySelector("#cloudLogoutButton");
  const refreshCloudMetaButton = root.querySelector("#refreshCloudMetaButton");
  const presetSelect = root.querySelector("#sharePresetSelect");
  const syncEnabled = root.querySelector("#syncEnabled");
  const syncEndpoint = root.querySelector("#syncEndpoint");
  const syncAccountId = root.querySelector("#syncAccountId");
  const syncOwnerKey = root.querySelector("#syncOwnerKey");
  const ownerDisplayName = root.querySelector("#ownerDisplayName");
  const personalizationEnabled = root.querySelector("#personalizationEnabled");
  const remindersEnabled = root.querySelector("#remindersEnabled");
  const reminderLeadMinutes = root.querySelector("#reminderLeadMinutes");
  const desktopNotificationsEnabled = root.querySelector("#desktopNotificationsEnabled");
  const riskAlertsEnabled = root.querySelector("#riskAlertsEnabled");
  const riskAlertsMinLevel = root.querySelector("#riskAlertsMinLevel");

  refreshCloudMetaButton?.addEventListener("click", () => {
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled in this build.", "error");
      return;
    }
    void (async () => {
      try {
        await refreshCloudSideData();
        setStatus("Cloud status refreshed.");
        renderAll();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not refresh cloud status.";
        setStatus(message, "error");
      }
    })();
  });

  cloudLogoutButton?.addEventListener("click", () => {
    void (async () => {
      await cloudLogout();
      app.sync.status = "auth-required";
      app.sync.lastError = "Sign in to enable cloud sync.";
      setStatus("Signed out from cloud account.");
      renderAll();
    })();
  });

  cloudRegisterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled in this build.", "error");
      return;
    }
    const values = formToObject(cloudRegisterForm);
    void (async () => {
      try {
        const payload = await cloudRegisterOwner({
          email: values.email,
          password: values.password,
          name: values.name,
          accountId: values.accountId || app.syncConfig.accountId || "default"
        });
        app.sync.status = "connected";
        app.sync.lastError = "";
        app.sync.lastSyncedAt = isoDateTime(new Date());
        setStatus(`Cloud owner account ready for ${payload.user?.email || values.email}.`);
        await pullRemoteStateOnBoot();
        await refreshCloudSideData();
        renderAll();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not register owner account.";
        setStatus(message, "error");
      }
    })();
  });

  cloudLoginForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled in this build.", "error");
      return;
    }
    const values = formToObject(cloudLoginForm);
    void (async () => {
      try {
        const payload = await cloudLogin({
          email: values.email,
          password: values.password,
          accountId: values.accountId || ""
        });
        app.sync.status = "connected";
        app.sync.lastError = "";
        app.sync.lastSyncedAt = isoDateTime(new Date());
        setStatus(`Signed in as ${payload.user?.email || values.email}.`);
        await pullRemoteStateOnBoot();
        await refreshCloudSideData();
        renderAll();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not sign in.";
        setStatus(message, "error");
      }
    })();
  });

  cloudAcceptInviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled in this build.", "error");
      return;
    }
    const values = formToObject(cloudAcceptInviteForm);
    void (async () => {
      try {
        const payload = await cloudAcceptInvite({
          token: values.token,
          password: values.password,
          name: values.name
        });
        app.drafts.cloudInviteToken = "";
        app.sync.status = "connected";
        app.sync.lastError = "";
        app.sync.lastSyncedAt = isoDateTime(new Date());
        setStatus(`Invite accepted. Signed in as ${payload.user?.email || "user"}.`);
        await pullRemoteStateOnBoot();
        await refreshCloudSideData();
        renderAll();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not accept invite.";
        setStatus(message, "error");
      }
    })();
  });

  cloudCreateInviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formToObject(cloudCreateInviteForm);
    void (async () => {
      try {
        const payload = await cloudCreateInvite({
          email: values.email,
          name: values.name,
          role: values.role,
          expiresAt: values.expiresAt
        });
        await cloudListInvites();
        const token = payload?.inviteToken || "";
        if (token && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(token);
          setStatus("Invite created. Invite token copied to clipboard.");
        } else {
          setStatus(token ? `Invite created. Token: ${token}` : "Invite created.");
        }
        renderAll();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not create invite.";
        setStatus(message, "error");
      }
    })();
  });

  root.querySelectorAll("[data-cloud-revoke-invite]").forEach((button) => {
    button.addEventListener("click", () => {
      const inviteId = String(button.getAttribute("data-cloud-revoke-invite") || "");
      if (!inviteId) return;
      void (async () => {
        try {
          await cloudRevokeInvite(inviteId);
          await cloudListInvites();
          setStatus("Invite revoked.");
          renderAll();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not revoke invite.";
          setStatus(message, "error");
        }
      })();
    });
  });

  root.querySelector("#saveProfileSettingsButton")?.addEventListener("click", () => {
    app.ownerData.profile = normalizeOwnerProfile({
      displayName: String(ownerDisplayName?.value || ""),
      personalizationEnabled: Boolean(personalizationEnabled?.checked)
    });
    saveOwnerData(app.ownerData);
    setStatus("Personalization settings saved.");
    renderAll();
  });

  root.querySelector("#saveSyncConfigButton")?.addEventListener("click", () => {
    if (LOCAL_ONLY_MODE) {
      app.syncConfig = defaultSyncConfig();
      saveSyncConfig();
      app.sync.status = "local-only";
      app.sync.lastError = "";
      setStatus("Cloud sync is disabled. Local-only mode is active.");
      renderAll();
      return;
    }
    app.syncConfig = {
      ...app.syncConfig,
      enabled: Boolean(syncEnabled?.checked),
      endpoint: String(syncEndpoint?.value || "").trim(),
      accountId: String(syncAccountId?.value || "default").trim() || "default",
      ownerKey: String(syncOwnerKey?.value || "")
    };
    saveSyncConfig();
    app.sync.status = canUseRemoteSync()
      ? (hasCloudSession() || app.syncConfig.ownerKey ? "syncing" : "auth-required")
      : "local-only";
    app.sync.lastError = "";
    if (canUseRemoteSync() && (hasCloudSession() || app.syncConfig.ownerKey)) {
      void pullRemoteStateOnBoot();
    }
    setStatus("Sync settings saved.");
    renderAll();
  });

  root.querySelector("#syncNowButton")?.addEventListener("click", () => {
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled. Local-only mode is active.");
      return;
    }
    if (!canUseRemoteSync()) {
      setStatus("Enable sync and set API endpoint first.", "error");
      return;
    }
    if (!hasCloudSession() && !app.syncConfig.ownerKey) {
      setStatus("Sign in to cloud (or provide legacy owner key) before syncing.", "error");
      return;
    }
    void flushRemoteSync();
    setStatus("Sync requested.");
  });

  root.querySelector("#saveReminderSettingsButton")?.addEventListener("click", () => {
    app.ownerData.reminderSettings = normalizeReminderSettings({
      enabled: remindersEnabled?.checked,
      leadMinutes: Number(reminderLeadMinutes?.value || 15),
      desktopNotifications: desktopNotificationsEnabled?.checked,
      riskAlertsEnabled: riskAlertsEnabled?.checked,
      riskAlertsMinLevel: String(riskAlertsMinLevel?.value || "elevated")
    });
    saveOwnerData(app.ownerData);
    restartReminderLoop();
    setStatus("Reminder settings saved.");
    renderAll();
  });

  root.querySelector("#requestReminderPermissionButton")?.addEventListener("click", () => {
    void requestNotificationPermission();
  });

  root.querySelector("#addWarningSignButton")?.addEventListener("click", () => {
    app.ownerData.warningSigns = normalizeWarningSigns([
      ...warningSigns,
      {
        id: uid(),
        label: "New warning sign",
        category: "custom",
        severityWeight: 2,
        active: true,
        thresholdConfig: {}
      }
    ]);
    saveOwnerData(app.ownerData);
    setStatus("Warning sign row added.");
    renderAll();
  });

  root.querySelector("#riskConfigForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const nextWarningSigns = warningSigns
      .map((sign) => ({
        id: sign.id,
        label: String(form.elements[`warningLabel__${sign.id}`]?.value || "").trim(),
        category: String(form.elements[`warningCategory__${sign.id}`]?.value || "custom").trim(),
        severityWeight: Number(form.elements[`warningWeight__${sign.id}`]?.value || 2),
        active: Boolean(form.elements[`warningActive__${sign.id}`]?.checked),
        thresholdConfig: sign.thresholdConfig || {}
      }))
      .filter((sign) => sign.label);

    if (!nextWarningSigns.length) {
      setStatus("Add at least one warning sign before saving.", "error");
      return;
    }

    const nextRiskConfig = normalizeRiskConfig({
      missedDoseWatch: Number(form.elements.missedDoseWatch?.value || riskConfig.missedDoseWatch),
      missedDoseElevated: Number(form.elements.missedDoseElevated?.value || riskConfig.missedDoseElevated),
      missedDoseHigh: Number(form.elements.missedDoseHigh?.value || riskConfig.missedDoseHigh),
      anxietyWatch: Number(form.elements.anxietyWatch?.value || riskConfig.anxietyWatch),
      anxietyHigh: Number(form.elements.anxietyHigh?.value || riskConfig.anxietyHigh),
      lowSleepHours: Number(form.elements.lowSleepHours?.value || riskConfig.lowSleepHours),
      noCheckinHours: Number(form.elements.noCheckinHours?.value || riskConfig.noCheckinHours),
      sideEffectsWindowDays: Number(form.elements.sideEffectsWindowDays?.value || riskConfig.sideEffectsWindowDays),
      sideEffectsTriggerCount: Number(form.elements.sideEffectsTriggerCount?.value || riskConfig.sideEffectsTriggerCount),
      watchScore: Number(form.elements.watchScore?.value || riskConfig.watchScore),
      elevatedScore: Number(form.elements.elevatedScore?.value || riskConfig.elevatedScore),
      highScore: Number(form.elements.highScore?.value || riskConfig.highScore)
    });

    if (nextRiskConfig.missedDoseWatch > nextRiskConfig.missedDoseElevated || nextRiskConfig.missedDoseElevated > nextRiskConfig.missedDoseHigh) {
      setStatus("Missed-dose thresholds must be Watch <= Elevated <= High.", "error");
      return;
    }
    if (nextRiskConfig.watchScore > nextRiskConfig.elevatedScore || nextRiskConfig.elevatedScore > nextRiskConfig.highScore) {
      setStatus("Risk score thresholds must be Watch <= Elevated <= High.", "error");
      return;
    }

    app.ownerData.warningSigns = normalizeWarningSigns(nextWarningSigns);
    app.ownerData.riskConfig = nextRiskConfig;
    saveOwnerData(app.ownerData);
    setStatus("Warning signs and risk thresholds saved.");
    renderAll();
  });

  presetSelect.addEventListener("change", () => {
    const preset = PRESETS[presetSelect.value] || PRESETS.family;
    app.drafts.sharePermissions = normalizePermissions(preset.permissions);
    app.drafts.share = {
      ...formToObject(shareForm),
      allowedModes: preset.defaultModes
    };
    saveDrafts();
    renderAll();
  });

  shareForm.addEventListener("input", () => {
    const values = formToObject(shareForm);
    values.allowedModes = checkedValues(shareForm, "allowedModes");
    app.drafts.share = values;
    app.drafts.sharePermissions = {
      showSensitiveNotes: shareForm.elements.showSensitiveNotes.checked,
      showSensitiveTags: shareForm.elements.showSensitiveTags.checked,
      showJournalText: shareForm.elements.showJournalText.checked,
      showLibido: shareForm.elements.showLibido.checked,
      showSubstance: shareForm.elements.showSubstance.checked,
      showFreeText: shareForm.elements.showFreeText.checked
    };
    saveDrafts();
  });

  shareForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formToObject(shareForm);
    const allowedModes = checkedValues(shareForm, "allowedModes");
    const requestedExpiry = String(values.expiresAt || "").trim();
    const expiresAt = requestedExpiry || shiftDateKey(getLocalDateKey(new Date()), 30);

    if (!allowedModes.length) {
      return setStatus("Select at least one allowed view mode.", "error");
    }

    if (expiresAt && expiresAt < getLocalDateKey(new Date())) {
      return setStatus("Expiry date cannot be in the past.", "error");
    }

    const permissions = normalizePermissions({
      showSensitiveNotes: shareForm.elements.showSensitiveNotes.checked,
      showSensitiveTags: shareForm.elements.showSensitiveTags.checked,
      showJournalText: shareForm.elements.showJournalText.checked,
      showLibido: shareForm.elements.showLibido.checked,
      showSubstance: shareForm.elements.showSubstance.checked,
      showFreeText: shareForm.elements.showFreeText.checked
    });

    const token = createSecureShareToken();
    const linkId = uid();
    const createdAt = isoDateTime(new Date());

    const snapshot = filterDataForShare(app.ownerData, permissions);

    const payload = {
      version: 2,
      linkId,
      token,
      recipient: {
        name: values.name,
        email: values.email || ""
      },
      preset: values.preset || "family",
      permissions,
      allowedModes,
      expiresAt,
      createdAt,
      snapshot
    };

    const encoded = encodeSharePayload(payload);
    const url = `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(encoded)}`;

    app.ownerData.shareLinks.push({
      id: linkId,
      name: values.name,
      email: values.email || "",
      preset: values.preset || "family",
      permissions,
      allowedModes,
      expiresAt,
      revoked: false,
      createdAt,
      token,
      url,
      lastOpenedAt: "",
      totalOpens: 0
    });

    saveOwnerData(app.ownerData);
    app.drafts.share = {};
    app.drafts.sharePermissions = null;
    saveDrafts();
    setStatus("Read-only link created.");
    renderAll();
  });

  root.querySelectorAll("[data-copy-link]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.copyLink;
      const link = app.ownerData.shareLinks.find((entry) => entry.id === id);
      if (!link) return;
      await navigator.clipboard.writeText(link.url);
      setStatus(`Copied link for ${link.name}.`);
    });
  });

  root.querySelectorAll("[data-revoke-link]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.revokeLink;
      const link = app.ownerData.shareLinks.find((entry) => entry.id === id);
      if (!link) return;
      link.revoked = !link.revoked;
      saveOwnerData(app.ownerData);
      setStatus(link.revoked ? "Link revoked." : "Link re-enabled.");
      renderAll();
    });
  });

  root.querySelectorAll("[data-preview-link]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.previewLink;
      const link = app.ownerData.shareLinks.find((entry) => entry.id === id);
      if (!link) return;
      app.ui.viewerMode = "preview_link";
      app.ui.previewLinkId = link.id;
      app.ui.activeSection = "dashboard";
      ensureSectionForCurrentMode();
      setStatus(`Previewing as ${link.name}.`);
      renderAll();
    });
  });

  root.querySelectorAll("[data-delete-link]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ownerData.shareLinks = app.ownerData.shareLinks.filter((entry) => entry.id !== button.dataset.deleteLink);
      saveOwnerData(app.ownerData);
      setStatus("Link deleted.");
      renderAll();
    });
  });
}

function renderShareList() {
  const links = app.ownerData.shareLinks.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (!links.length) {
    return `<div class="empty">No links created yet.</div>`;
  }

  return links
    .map((link) => {
      const access = app.accessLogs[link.token] || { totalOpens: link.totalOpens || 0, lastOpenedAt: link.lastOpenedAt || "" };
      const expired = link.expiresAt && new Date(link.expiresAt).getTime() < Date.now();
      const status = link.revoked ? "Revoked" : expired ? "Expired" : "Active";

      return `
        <article class="share-card">
          <strong>${escapeHtml(link.name)}</strong>
          <div class="subtle">${escapeHtml(link.email || "No email")}</div>
          <div class="subtle">Preset: ${escapeHtml(PRESETS[link.preset]?.label || "Custom")}</div>
          <div class="subtle">Status: ${status}${link.expiresAt ? ` · Expires ${escapeHtml(niceDate(link.expiresAt))}` : ""}</div>
          <div class="subtle">Access log: opens ${access.totalOpens || 0}${access.lastOpenedAt ? ` · last opened ${escapeHtml(niceDateTime(access.lastOpenedAt))}` : ""}</div>
          <textarea class="share-url" readonly>${escapeHtml(link.url)}</textarea>
          <div class="inline-row" style="margin-top:8px;">
            <button class="btn btn-secondary" type="button" data-copy-link="${link.id}">Copy</button>
            <button class="btn btn-secondary" type="button" data-preview-link="${link.id}">Preview as recipient</button>
            <button class="btn btn-danger" type="button" data-revoke-link="${link.id}">${link.revoked ? "Unrevoke" : "Revoke"}</button>
            <button class="btn btn-secondary" type="button" data-delete-link="${link.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPermissionToggle(name, label, checked) {
  return `
    <label class="check-item">
      <input type="checkbox" name="${name}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function buildRangeSnapshot(data, rangeDays = 14) {
  const days = SUMMARY_RANGE_OPTIONS.includes(String(rangeDays)) ? Number(rangeDays) : 14;
  const endDate = getLocalDateKey(new Date());
  const startDate = shiftDateKey(endDate, -(days - 1));
  const inRange = (dateValue) => Boolean(dateValue && String(dateValue) >= startDate && String(dateValue) <= endDate);

  return {
    days,
    startDate,
    endDate,
    medications: resolveCurrentMedications(data).filter((entry) => entry.isCurrent),
    changes: (data.changes || []).filter((entry) => inRange(entry.date)).sort((a, b) => b.date.localeCompare(a.date)),
    checkins: (data.checkins || []).filter((entry) => inRange(entry.date)).sort((a, b) => b.date.localeCompare(a.date)),
    notes: (data.notes || []).filter((entry) => inRange(entry.date)).sort((a, b) => b.date.localeCompare(a.date)),
    adherence: (data.adherence || []).filter((entry) => inRange(entry.date))
  };
}

function renderExportSummaryPreview(data, rangeDays) {
  const snapshot = buildRangeSnapshot(data, rangeDays);
  const trendRisk = computeRiskAssessment({
    now: new Date(),
    checkins: snapshot.checkins,
    notes: snapshot.notes,
    adherence: snapshot.adherence,
    dueState: null,
    warningSigns: data.warningSigns,
    riskConfig: data.riskConfig
  });
  const adherenceTaken = snapshot.adherence.filter((entry) => normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.TAKEN).length;
  const adherenceSkipped = snapshot.adherence.filter((entry) => normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.SKIPPED).length;
  const adherencePct = adherenceTaken + adherenceSkipped
    ? roundNumber((adherenceTaken / (adherenceTaken + adherenceSkipped)) * 100, 0)
    : 0;

  return `
    <article class="card" style="margin-top:12px;">
      <h3>${snapshot.days}-day summary preview</h3>
      <p class="subtle">${escapeHtml(niceDate(snapshot.startDate))} to ${escapeHtml(niceDate(snapshot.endDate))}</p>
      <div class="summary-strip-grid" style="margin-top:8px;">
        <div class="summary-strip-item">
          <div class="summary-strip-label">Current medications</div>
          <div class="summary-strip-value">${snapshot.medications.length}</div>
          <div class="summary-strip-help">Active medications in current list</div>
        </div>
        <div class="summary-strip-item">
          <div class="summary-strip-label">Medication changes</div>
          <div class="summary-strip-value">${snapshot.changes.length}</div>
          <div class="summary-strip-help">Logged in this period</div>
        </div>
        <div class="summary-strip-item">
          <div class="summary-strip-label">Adherence (logged)</div>
          <div class="summary-strip-value">${escapeHtml(`${adherencePct}%`)}</div>
          <div class="summary-strip-help">${adherenceTaken} taken · ${adherenceSkipped} skipped</div>
        </div>
        <div class="summary-strip-item">
          <div class="summary-strip-label">Risk status</div>
          <div class="summary-strip-value">${escapeHtml(trendRisk.label)}</div>
          <div class="summary-strip-help">${escapeHtml(trendRisk.reasons[0] || "No major triggers in the selected window.")}</div>
        </div>
      </div>
    </article>
  `;
}

function renderExports(root, data) {
  root.innerHTML = `
    <div class="card">
      <h3>Export options</h3>
      <div class="summary-range-row" style="margin-bottom:10px;">
        <label for="exportSummaryRange">Summary range</label>
        <select id="exportSummaryRange">
          ${SUMMARY_RANGE_OPTIONS.map((days) => `<option value="${days}" ${String(app.ui.exportSummaryRangeDays || "14") === days ? "selected" : ""}>${days} days</option>`).join("")}
        </select>
      </div>
      <div class="inline-row">
        <button class="btn btn-secondary" type="button" id="exportJson">Download JSON backup</button>
        <button class="btn btn-secondary" type="button" id="exportCsvMedications">Download medications CSV</button>
        <button class="btn btn-secondary" type="button" id="exportCsvChanges">Download changes CSV</button>
        <button class="btn btn-secondary" type="button" id="exportCsvCheckins">Download check-ins CSV</button>
        <button class="btn btn-primary" type="button" id="exportPdfSummary">Generate clinician PDF summary</button>
      </div>
      <p class="safety-footnote">Clinician summary text is informational. Discuss with prescriber.</p>
    </div>
    ${renderExportSummaryPreview(data, app.ui.exportSummaryRangeDays || "14")}
  `;

  root.querySelector("#exportSummaryRange")?.addEventListener("change", (event) => {
    const next = String(event.target.value || "14");
    app.ui.exportSummaryRangeDays = SUMMARY_RANGE_OPTIONS.includes(next) ? next : "14";
    renderAll();
  });

  root.querySelector("#exportJson").addEventListener("click", () => {
    const payload = JSON.stringify(ensureStateShape(data), null, 2);
    downloadFile(`medication-tracker-backup-${isoDate(new Date())}.json`, payload, "application/json");
  });

  root.querySelector("#exportCsvMedications").addEventListener("click", () => {
    const rows = data.medications.map((med) => ({
      name: med.name,
      generic_name: med.genericName,
      brand_name: med.brandName,
      current_dose: med.currentDose,
      schedule_times: (med.scheduleTimes || []).join(" | "),
      route: med.route,
      start_date: med.startDate,
      indication: med.indication,
      time_course_notes: med.timeCourseNotes || "",
      interactions_notes: med.interactionsNotes || "",
      contraindications_notes: med.contraindicationsNotes || "",
      active: med.active
    }));
    downloadFile(`medications-${isoDate(new Date())}.csv`, toCsv(rows), "text/csv");
  });

  root.querySelector("#exportCsvChanges").addEventListener("click", () => {
    const rows = data.changes.map((entry) => ({
      date: entry.date,
      medication: entry.medicationName,
      old_dose: entry.oldDose,
      new_dose: entry.newDose,
      reason: entry.reasonForChange || entry.reason,
      route: entry.route || "",
      changed_by: entry.changedBy || "",
      expected_effects: entry.expectedEffects || "",
      monitor_for: entry.monitorFor || "",
      review_date: entry.reviewDate || "",
      notes: entry.notes || "",
      short_term: entry.interpretation.shortTerm,
      long_term: entry.interpretation.longTerm,
      monitor: entry.interpretation.monitor
    }));
    downloadFile(`medication-changes-${isoDate(new Date())}.csv`, toCsv(rows), "text/csv");
  });

  root.querySelector("#exportCsvCheckins").addEventListener("click", () => {
    const rows = data.checkins.map((entry) => ({
      date: entry.date,
      mood: entry.mood,
      anxiety: entry.anxiety,
      focus: entry.focus,
      sleep_hours: entry.sleepHours,
      sleep_quality: entry.sleepQuality,
      appetite: entry.appetite,
      energy: entry.energy,
      irritability: entry.irritability,
      cravings_impulsivity: entry.cravingsImpulsivity,
      side_effects: (entry.sideEffectsChecklist || []).join(" | "),
      side_effects_text: entry.sideEffectsText,
      training_notes: entry.trainingNotes,
      weight: entry.vitals?.weight || "",
      bp_systolic: entry.vitals?.bpSystolic || "",
      bp_diastolic: entry.vitals?.bpDiastolic || "",
      heart_rate: entry.vitals?.hr || ""
    }));
    downloadFile(`daily-checkins-${isoDate(new Date())}.csv`, toCsv(rows), "text/csv");
  });

  root.querySelector("#exportPdfSummary").addEventListener("click", () => {
    const html = buildClinicianSummaryHtml(data, app.ui.exportSummaryRangeDays || "14");
    const popup = window.open("", "_blank", "noopener,noreferrer,width=1024,height=900");
    if (!popup) {
      return setStatus("Popup blocked. Allow popups to export PDF summary.", "error");
    }
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  });
}

function buildClinicianSummaryHtml(data, rangeDays = "14") {
  const snapshot = buildRangeSnapshot(data, rangeDays);
  const meds = snapshot.medications;
  const recentChanges = snapshot.changes.slice(0, 24);
  const recentCheckins = snapshot.checkins.slice(0, 30);
  const notes = snapshot.notes.slice(0, 20);
  const riskAssessment = computeRiskAssessment({
    now: new Date(),
    checkins: snapshot.checkins,
    notes: snapshot.notes,
    adherence: snapshot.adherence,
    dueState: null,
    warningSigns: data.warningSigns,
    riskConfig: data.riskConfig
  });
  const riskHistory = computeRecentRiskHistory(
    {
      ...data,
      checkins: snapshot.checkins,
      notes: snapshot.notes,
      adherence: snapshot.adherence
    },
    snapshot.days
  );
  const actionPlan = renderActionPlanSteps(data.actionPlans, riskAssessment.level);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Clinician Summary</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #1b2a3d; }
          h1, h2 { margin-bottom: 8px; }
          h2 { margin-top: 20px; border-bottom: 1px solid #dce5ef; padding-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { border: 1px solid #dce5ef; padding: 6px; font-size: 12px; text-align: left; }
          th { background: #f5f9ff; text-transform: uppercase; font-size: 11px; }
          .note { font-size: 12px; color: #435a73; margin-top: 12px; }
        </style>
      </head>
      <body>
        <h1>Medication Tracker · Clinician Summary</h1>
        <p>Generated: ${escapeHtml(niceDateTime(isoDateTime(new Date())))}</p>
        <p>Summary range: ${snapshot.days} days (${escapeHtml(niceDate(snapshot.startDate))} to ${escapeHtml(niceDate(snapshot.endDate))})</p>

        <h2>Risk status</h2>
        <table>
          <thead><tr><th>Current level</th><th>Reasons</th><th>Triggered signs</th><th>Recent history</th></tr></thead>
          <tbody>
            <tr>
              <td>${escapeHtml(riskAssessment.label)}</td>
              <td>${escapeHtml(riskAssessment.reasons.join(" | ") || "No active triggers.")}</td>
              <td>${escapeHtml(riskAssessment.triggeredSigns.map((entry) => entry.label).join(", ") || "-")}</td>
              <td>${escapeHtml(riskHistory.map((entry) => `${entry.date}:${(RISK_LEVEL_META[entry.level] || RISK_LEVEL_META.low).label}`).join(" | ") || "-")}</td>
            </tr>
          </tbody>
        </table>

        <h2>Action plan (${escapeHtml(riskAssessment.label)} level)</h2>
        <table>
          <thead><tr><th>Step</th><th>Notify</th></tr></thead>
          <tbody>
            ${(actionPlan.length ? actionPlan : [{ stepText: "No action-plan steps configured for this level.", notifyRole: "" }]).map((step) => `<tr><td>${escapeHtml(step.stepText || "-")}</td><td>${escapeHtml(step.notifyRole || "-")}</td></tr>`).join("")}
          </tbody>
        </table>

        <h2>Current Medications</h2>
        <table>
          <thead><tr><th>Name</th><th>Dose</th><th>Schedule</th><th>Route</th><th>Indication</th><th>Monitor</th><th>Interactions</th><th>Contraindications</th><th>Questions</th></tr></thead>
          <tbody>
            ${meds.map((med) => `<tr><td>${escapeHtml(med.name)}</td><td>${escapeHtml(med.currentDose)}</td><td>${escapeHtml(formatSchedule(med))}</td><td>${escapeHtml(med.route)}</td><td>${escapeHtml(med.indication || "-")}</td><td>${escapeHtml(med.monitor || "-")}</td><td>${escapeHtml(med.interactionsNotes || "-")}</td><td>${escapeHtml(med.contraindicationsNotes || "-")}</td><td>${escapeHtml(med.questions || "-")}</td></tr>`).join("")}
          </tbody>
        </table>

        <h2>Recent Medication Changes</h2>
        <table>
          <thead><tr><th>Date</th><th>Medication</th><th>Old</th><th>New</th><th>Reason</th><th>Changed by</th><th>Monitor</th><th>Review date</th><th>Short term</th><th>Long term</th></tr></thead>
          <tbody>
            ${recentChanges.map((change) => `<tr><td>${escapeHtml(niceDate(change.date))}</td><td>${escapeHtml(change.medicationName)}</td><td>${escapeHtml(change.oldDose)}</td><td>${escapeHtml(change.newDose)}</td><td>${escapeHtml(change.reasonForChange || change.reason)}</td><td>${escapeHtml(change.changedBy || "-")}</td><td>${escapeHtml(change.monitorFor || change.interpretation.monitor || "-")}</td><td>${escapeHtml(change.reviewDate ? niceDate(change.reviewDate) : "-")}</td><td>${escapeHtml(change.interpretation.shortTerm)}</td><td>${escapeHtml(change.interpretation.longTerm)}</td></tr>`).join("")}
          </tbody>
        </table>

        <h2>Recent Wellbeing Trends</h2>
        <table>
          <thead><tr><th>Date</th><th>Mood</th><th>Anxiety</th><th>Focus</th><th>Sleep (h)</th><th>Sleep quality</th><th>Energy</th><th>Irritability</th></tr></thead>
          <tbody>
            ${recentCheckins.map((entry) => `<tr><td>${escapeHtml(niceDate(entry.date))}</td><td>${entry.mood}</td><td>${entry.anxiety}</td><td>${entry.focus}</td><td>${entry.sleepHours}</td><td>${entry.sleepQuality}</td><td>${entry.energy}</td><td>${entry.irritability}</td></tr>`).join("")}
          </tbody>
        </table>

        <h2>Key Notes</h2>
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Medication</th><th>Detail</th></tr></thead>
          <tbody>
            ${notes.map((note) => `<tr><td>${escapeHtml(niceDate(note.date))}</td><td>${escapeHtml(note.noteType)}</td><td>${escapeHtml(note.medicationName || "-")}</td><td>${escapeHtml(note.noteText || "-")}${(note.tags || []).length ? ` [tags: ${escapeHtml(note.tags.join(", "))}]` : ""}</td></tr>`).join("")}
          </tbody>
        </table>

        <p class="note">Clinical interpretation sections are informational and may vary by person. Discuss with prescriber.</p>
      </body>
    </html>
  `;
}

function filterDataForShare(source, permissions) {
  const clone = deepClone(source);
  clone.shareLinks = [];
  clone.profile = {
    displayName: "",
    personalizationEnabled: false
  };
  clone.dashboardConfig = normalizeDashboardConfig(clone.dashboardConfig);

  if (!permissions.showSensitiveTags) {
    clone.notes = clone.notes.map((note) => ({
      ...note,
      tags: Array.isArray(note.tags)
        ? note.tags.filter((tag) => !SENSITIVE_TAG_KEYWORDS.some((keyword) => String(tag || "").toLowerCase().includes(keyword)))
        : []
    }));
  }

  clone.notes = clone.notes.filter((note) => {
    if (!permissions.showSensitiveNotes && note.isSensitive) return false;
    if (!permissions.showJournalText && note.noteType === "journal") return false;
    if (!permissions.showLibido && note.noteType === "libido") return false;
    if (!permissions.showSubstance && note.noteType === "substance") return false;
    if (!permissions.showFreeText && note.noteType === "free_text") return false;
    return true;
  });

  if (!permissions.showFreeText) {
    clone.notes = clone.notes.map((note) => ({ ...note, noteText: note.noteText ? "[Hidden by link settings]" : "", trainingNotes: note.trainingNotes ? "[Hidden by link settings]" : "" }));
    clone.checkins = clone.checkins.map((entry) => ({ ...entry, sideEffectsText: entry.sideEffectsText ? "[Hidden by link settings]" : "", trainingNotes: entry.trainingNotes ? "[Hidden by link settings]" : "" }));
  }

  return ensureStateShape(clone);
}

function generateInterpretationTemplate(values) {
  const medicationName = values.medicationName || "This medication";
  const oldDose = values.oldDose || "previous dose";
  const newDose = values.newDose || "new dose";
  const reason = values.reason || "clinical review";

  return {
    shortTerm: `${medicationName} changed from ${oldDose} to ${newDose}. In the first 1-7 days, energy, sleep, anxiety, and side effects may shift while the body adapts.`,
    longTerm: `Over 2-6 weeks, response may stabilize and the pattern of benefit or burden can become clearer.`,
    monitor: `Track mood, anxiety, focus, sleep duration/quality, appetite, and side effects after this change (reason logged: ${reason}).`,
    improvement: "Potential improvement markers may include steadier daily function, improved sleep pattern, and reduced distress.",
    deterioration: "Potential deterioration markers may include worsening anxiety, sleep disruption, functional decline, or difficult side effects.",
    uncertainty: "Individual response may vary and interpretation remains uncertain without longitudinal clinical review."
  };
}

function getDoseState(activeMeds, adherence, doseSnoozes = []) {
  const now = new Date();
  const base = buildDoseState(activeMeds, adherence, now);
  const activeSnoozes = new Map();

  for (const snooze of Array.isArray(doseSnoozes) ? doseSnoozes : []) {
    const normalized = normalizeDoseSnooze(snooze);
    if (!normalized) continue;
    const until = new Date(normalized.untilAt);
    if (until.getTime() > now.getTime()) {
      activeSnoozes.set(normalized.occurrenceId, normalized.untilAt);
    }
  }

  if (!activeSnoozes.size) {
    return base;
  }

  const decorate = (item) => {
    const snoozedUntil = activeSnoozes.get(item.occurrenceId);
    if (!snoozedUntil) return item;
    return {
      ...item,
      snoozedUntil,
      statusLabel: `Snoozed until ${formatClockTime(snoozedUntil)}`
    };
  };

  const decoratedDue = base.dueNow.map(decorate);
  const decoratedNext = base.next.map(decorate);
  const dueNow = decoratedDue.filter((item) => !item.snoozedUntil);
  const movedToNext = decoratedDue.filter((item) => item.snoozedUntil);
  const next = [...decoratedNext, ...movedToNext].sort((left, right) => left.time.localeCompare(right.time));

  return {
    ...base,
    dueNow,
    next,
    counts: {
      ...base.counts,
      remaining: dueNow.length + next.length
    }
  };
}

function pruneExpiredDoseSnoozes() {
  const source = Array.isArray(app.ownerData.doseSnoozes) ? app.ownerData.doseSnoozes : [];
  const nowMs = Date.now();
  const filtered = source
    .map((entry) => normalizeDoseSnooze(entry))
    .filter((entry) => entry && new Date(entry.untilAt).getTime() > nowMs);

  if (filtered.length !== source.length) {
    app.ownerData = {
      ...app.ownerData,
      doseSnoozes: filtered
    };
    saveOwnerData(app.ownerData);
  }
}

function statusChipClass(label) {
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("overdue")) return "status-chip--overdue";
  if (normalized.includes("due now")) return "status-chip--due";
  if (normalized.includes("upcoming")) return "status-chip--upcoming";
  if (normalized.includes("snoozed")) return "status-chip--snoozed";
  if (normalized.includes("taken")) return "status-chip--taken";
  if (normalized.includes("skipped")) return "status-chip--skipped";
  return "status-chip--upcoming";
}

function handleDoseSnooze(occurrenceId, minutes = DOSE_SNOOZE_MINUTES) {
  if (!occurrenceId) {
    setStatus("Dose snooze is missing required details.", "error");
    return;
  }

  const now = new Date();
  const until = new Date(now.getTime() + Math.max(5, Number(minutes || 0)) * 60 * 1000);
  const existing = Array.isArray(app.ownerData.doseSnoozes) ? app.ownerData.doseSnoozes : [];
  const nextSnoozes = [
    ...existing.filter((entry) => entry.occurrenceId !== occurrenceId),
    {
      occurrenceId,
      untilAt: until.toISOString(),
      createdAt: isoDateTime(now)
    }
  ];

  app.ownerData = {
    ...app.ownerData,
    doseSnoozes: nextSnoozes
  };
  delete app.reminderLog[occurrenceId];
  saveReminderLog();
  saveOwnerData(app.ownerData);
  setStatus(`Dose snoozed until ${formatClockTime(until)}.`);
  renderAll();
}

function handleDoseNote(occurrenceId, medicationName = "") {
  const details = parseDoseOccurrenceId(occurrenceId);
  const noteDate = details.dateKey || getLocalDateKey(new Date());
  const timeLabel = details.scheduleTime || "--:--";
  const notePrefix = `[Dose note ${timeLabel}] `;
  const existingNoteText = String(app.drafts.note?.noteText || "");
  const nextNoteText = existingNoteText.startsWith(notePrefix) ? existingNoteText : `${notePrefix}${existingNoteText}`;

  app.drafts.note = {
    ...app.drafts.note,
    date: noteDate,
    medicationName: medicationName || app.drafts.note?.medicationName || "",
    noteType: app.drafts.note?.noteType || "side_effect",
    severity: app.drafts.note?.severity || "moderate",
    noteText: nextNoteText
  };
  saveDrafts();
  app.ui.activeSection = "entry";
  app.ui.entryWorkflow = "note";
  setStatus(`Opened note entry for ${medicationName || "selected dose"} (${timeLabel}).`);
  renderAll();
  window.setTimeout(() => {
    document.querySelector("#formNote textarea[name='noteText']")?.focus();
  }, 0);
}

function setPendingDoseAction(occurrenceId, pending) {
  const next = new Set(app.ui.pendingDoseActions);
  if (pending) {
    next.add(occurrenceId);
  } else {
    next.delete(occurrenceId);
  }
  app.ui.pendingDoseActions = next;
}

function clearDoseUndoPrompt() {
  if (app.doseUndoTimeout) {
    window.clearTimeout(app.doseUndoTimeout);
    app.doseUndoTimeout = null;
  }
  app.lastDoseUndo = null;
}

function queueDoseUndo(previousOwnerData, occurrenceId, status) {
  clearDoseUndoPrompt();
  app.lastDoseUndo = {
    previousOwnerData: deepClone(previousOwnerData),
    occurrenceId,
    status: normalizeAdherenceStatus(status),
    expiresAt: Date.now() + 10000
  };
  app.doseUndoTimeout = window.setTimeout(() => {
    app.lastDoseUndo = null;
    app.doseUndoTimeout = null;
    renderAll();
  }, 10000);
}

function handleDoseUndo() {
  if (!app.lastDoseUndo) return;
  app.ownerData = ensureStateShape(app.lastDoseUndo.previousOwnerData);
  saveOwnerData(app.ownerData);
  clearDoseUndoPrompt();
  setStatus("Dose action undone.");
  renderAll();
}

async function handleDoseAction(occurrenceId, status) {
  if (!occurrenceId || !status) {
    setStatus("Dose action is missing required details.", "error");
    return;
  }

  if (app.ui.pendingDoseActions.has(occurrenceId)) {
    return;
  }

  const previousOwnerData = app.ownerData;
  setPendingDoseAction(occurrenceId, true);

  try {
    const nextOwnerDataRaw = applyDoseAction(previousOwnerData, { occurrenceId, status }, new Date());
    const nextOwnerData = {
      ...nextOwnerDataRaw,
      doseSnoozes: (nextOwnerDataRaw.doseSnoozes || []).filter((entry) => entry.occurrenceId !== occurrenceId)
    };
    delete app.reminderLog[occurrenceId];
    saveReminderLog();
    app.ownerData = nextOwnerData;
    renderAll();

    saveOwnerData(nextOwnerData);
    queueDoseUndo(previousOwnerData, occurrenceId, status);
    if (canUseRemoteSync()) {
      void flushRemoteSync();
    }
    setStatus(`Dose marked as ${normalizeAdherenceStatus(status)}.`);
  } catch (error) {
    app.ownerData = previousOwnerData;
    clearDoseUndoPrompt();
    const message = error instanceof Error ? error.message : "Unknown save error";
    setStatus(`Could not save dose action. ${message}`, "error");
  } finally {
    setPendingDoseAction(occurrenceId, false);
    renderAll();
  }
}

function buildAlerts(data) {
  const alerts = [];
  const dashboardConfig = normalizeDashboardConfig(data.dashboardConfig);

  for (const reminder of dashboardConfig.monitoringReminders) {
    alerts.push(reminder);
  }

  const highNotes = data.notes.filter((note) => note.severity === "high").slice(0, 3);
  highNotes.forEach((note) => {
    alerts.push(`High-severity ${note.noteType.replaceAll("_", " ")} note on ${niceDate(note.date)}${note.medicationName ? ` (${note.medicationName})` : ""}.`);
  });

  const recentChanges = data.changes
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2);

  recentChanges.forEach((change) => {
    const monitor = String(change?.interpretation?.monitor || "").trim();
    if (!monitor) return;
    alerts.push(`${change.medicationName}: monitor ${monitor}`);
  });

  const today = getLocalDateKey(new Date());
  const hasTodayCheckin = data.checkins.some((entry) => entry.date === today);
  if (!hasTodayCheckin) {
    alerts.push("Today’s wellbeing check-in is still pending.");
  }

  return alerts.slice(0, 6);
}

function trendArrow(checkins, metric, inverse = false) {
  const sorted = checkins.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 4) {
    return { arrow: "→" };
  }

  const current = average(sorted.slice(-7).map((entry) => toNumber(entry[metric])));
  const previous = average(sorted.slice(-14, -7).map((entry) => toNumber(entry[metric])));

  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return { arrow: "→" };
  }

  const delta = current - previous;
  if (Math.abs(delta) < 0.15) return { arrow: "→" };

  if (inverse) {
    return { arrow: delta < 0 ? "↘" : "↗" };
  }

  return { arrow: delta > 0 ? "↗" : "↘" };
}

function buildSideEffectCounts(data) {
  const map = new Map();

  for (const checkin of data.checkins) {
    const count = (checkin.sideEffectsChecklist || []).length;
    map.set(checkin.date, (map.get(checkin.date) || 0) + count);
  }

  for (const note of data.notes) {
    if (note.noteType === "side_effect") {
      map.set(note.date, (map.get(note.date) || 0) + Math.max(1, (note.checklist || []).length));
    }
  }

  return Array.from(map.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildAdherenceTrend(adherence) {
  const byDate = new Map();
  for (const entry of Array.isArray(adherence) ? adherence : []) {
    if (!entry?.date) continue;
    if (!byDate.has(entry.date)) {
      byDate.set(entry.date, { taken: 0, total: 0 });
    }
    const row = byDate.get(entry.date);
    row.total += 1;
    if (normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.TAKEN) {
      row.taken += 1;
    }
  }

  return Array.from(byDate.entries())
    .map(([date, value]) => ({
      date,
      value: value.total ? roundNumber((value.taken / value.total) * 100, 2) : 0
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildDoseChangeTrend(changes) {
  const byDate = new Map();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!change?.date) continue;
    byDate.set(change.date, (byDate.get(change.date) || 0) + 1);
  }
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeBeforeAfterMetrics(checkins, changeDate) {
  const parsedChange = new Date(`${changeDate}T12:00:00`);

  const beforeStart = new Date(parsedChange);
  beforeStart.setDate(beforeStart.getDate() - 7);

  const afterEnd = new Date(parsedChange);
  afterEnd.setDate(afterEnd.getDate() + 14);

  const beforeRows = checkins.filter((entry) => {
    const date = new Date(`${entry.date}T12:00:00`);
    return date >= beforeStart && date < parsedChange;
  });

  const afterRows = checkins.filter((entry) => {
    const date = new Date(`${entry.date}T12:00:00`);
    return date >= parsedChange && date <= afterEnd;
  });

  const metrics = ["mood", "anxiety", "focus", "sleepHours"];
  const before = {};
  const after = {};

  metrics.forEach((metric) => {
    before[metric] = average(beforeRows.map((entry) => toNumber(entry[metric])));
    after[metric] = average(afterRows.map((entry) => toNumber(entry[metric])));
  });

  return { before, after };
}

function renderLineChart(seriesList, options = {}) {
  const width = 860;
  const height = 210;
  const padding = { top: 18, right: 16, bottom: 26, left: 32 };

  const dateSet = new Set();
  seriesList.forEach((series) => series.points.forEach((point) => dateSet.add(point.date)));
  const dates = Array.from(dateSet).sort();

  if (!dates.length) {
    return `<div class="empty">Not enough data for chart yet.${getActiveContext().readOnly ? "" : ` <button class="btn btn-secondary small" type="button" data-empty-action="checkin">Add check-in</button>`}</div>`;
  }

  const yMin = options.yMin ?? 0;
  const yMax = options.yMax ?? 10;

  const xFor = (date) => {
    const index = dates.indexOf(date);
    const span = Math.max(dates.length - 1, 1);
    return padding.left + (index / span) * (width - padding.left - padding.right);
  };

  const yFor = (value) => {
    const ratio = (value - yMin) / Math.max(yMax - yMin, 1);
    const clamped = Math.min(1, Math.max(0, ratio));
    return height - padding.bottom - clamped * (height - padding.top - padding.bottom);
  };

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padding.top + ratio * (height - padding.top - padding.bottom);
    return `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" stroke="${CHART_COLORS.grid}" stroke-width="1" />`;
  }).join("");

  const markerLines = (options.changeDates || []).map((date) => {
    if (!dates.includes(date)) return "";
    const x = xFor(date);
    return `<line x1="${x}" x2="${x}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="${CHART_COLORS.doseChangeMarker}" stroke-dasharray="4 4" stroke-width="1" />`;
  }).join("");

  const seriesPaths = seriesList.map((series) => {
    const points = series.points
      .filter((point) => Number.isFinite(point.value))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!points.length) return "";

    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.date).toFixed(2)} ${yFor(point.value).toFixed(2)}`)
      .join(" ");

    const circles = points
      .map((point) => {
        const dateLabel = shortDate(point.date);
        return `<circle cx="${xFor(point.date).toFixed(2)}" cy="${yFor(point.value).toFixed(2)}" r="2.2" fill="${series.color}"><title>${escapeHtml(`${series.label} · ${dateLabel}: ${roundNumber(point.value, 2)}`)}</title></circle>`;
      })
      .join("");
    return `<path d="${path}" fill="none" stroke="${series.color}" stroke-width="2.2" />${circles}`;
  }).join("");

  const labels = [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]]
    .filter(Boolean)
    .map((date) => `<text x="${xFor(date)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="${CHART_COLORS.label}">${escapeHtml(shortDate(date))}</text>`)
    .join("");

  const legend = `
    <div class="legend">
      ${seriesList.map((series) => `<span><i style="background:${series.color}"></i>${escapeHtml(series.label)}</span>`).join("")}
      ${(options.changeDates || []).length ? `<span><i style="background:${CHART_COLORS.doseChangeMarker}"></i>Medication change marker</span>` : ""}
    </div>
  `;

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="line chart">
      ${gridLines}
      ${markerLines}
      ${seriesPaths}
      ${labels}
    </svg>
    ${legend}
  `;
}

function renderBarChart(points, changeDates = [], options = {}) {
  const width = 860;
  const height = 210;
  const padding = { top: 18, right: 16, bottom: 26, left: 32 };
  const seriesColor = options.color || CHART_COLORS.sideEffects;
  const seriesLabel = options.label || "Side effect frequency";

  if (!points.length) {
    return `<div class="empty">Not enough trend data for chart yet.${getActiveContext().readOnly ? "" : ` <button class="btn btn-secondary small" type="button" data-empty-action="checkin">Add check-in</button>`}</div>`;
  }

  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const span = Math.max(points.length - 1, 1);

  const xFor = (index) => padding.left + (index / span) * (width - padding.left - padding.right);
  const yFor = (value) => height - padding.bottom - (value / maxValue) * (height - padding.top - padding.bottom);

  const bars = points.map((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    const barWidth = Math.max((width - padding.left - padding.right) / (points.length * 1.6), 6);
    return `<rect x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${height - padding.bottom - y}" fill="${seriesColor}" opacity="0.82"><title>${escapeHtml(`${seriesLabel} · ${shortDate(point.date)}: ${roundNumber(point.value, 2)}`)}</title></rect>`;
  }).join("");

  const markerLines = changeDates
    .filter((date) => points.some((point) => point.date === date))
    .map((date) => {
      const idx = points.findIndex((point) => point.date === date);
      const x = xFor(idx);
      return `<line x1="${x}" x2="${x}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="${CHART_COLORS.doseChangeMarker}" stroke-dasharray="4 4" stroke-width="1" />`;
    })
    .join("");

  const labelIndexes = Array.from(new Set([0, Math.floor(points.length / 2), points.length - 1])).filter((index) => index >= 0);
  const labels = labelIndexes
    .map((index) => `<text x="${xFor(index)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="${CHART_COLORS.label}">${escapeHtml(shortDate(points[index].date))}</text>`)
    .join("");

  const markerLegend = changeDates.length ? `<span><i style="background:${CHART_COLORS.doseChangeMarker}"></i>Medication change marker</span>` : "";

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="bar chart">
      <line x1="${padding.left}" x2="${width - padding.right}" y1="${height - padding.bottom}" y2="${height - padding.bottom}" stroke="${CHART_COLORS.axis}" stroke-width="1" />
      ${markerLines}
      ${bars}
      ${labels}
    </svg>
    <div class="legend"><span><i style="background:${seriesColor}"></i>${escapeHtml(seriesLabel)}</span>${markerLegend}</div>
  `;
}

function encodeSharePayload(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function tokenFromUrl(url) {
  if (!url) return "";
  const marker = "#share=";
  const index = url.indexOf(marker);
  if (index === -1) return "";
  return url.slice(index + marker.length, index + marker.length + 36);
}

function formToObject(form) {
  const data = new FormData(form);
  const obj = {};
  for (const [key, value] of data.entries()) {
    obj[key] = String(value);
  }
  return obj;
}

function checkedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function valueOf(id) {
  const node = document.getElementById(id);
  return node ? String(node.value || "").trim() : "";
}

function pushToast(message, type = "success") {
  if (!dom.toastStack) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : "success"}`;
  toast.textContent = message;
  dom.toastStack.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-8px)";
    window.setTimeout(() => toast.remove(), 260);
  }, 2600);
}

function setStatus(message, type = "ok") {
  clearTimeout(app.statusTimeout);
  if (type !== "error") {
    if (!getActiveContext().blockedReason) {
      dom.globalStatus.classList.add("hidden");
      dom.globalStatus.classList.remove("error", "context-block");
      dom.globalStatus.textContent = "";
    }
    pushToast(message, "success");
    return;
  }

  dom.globalStatus.classList.remove("hidden", "context-block");
  dom.globalStatus.classList.add("error");
  dom.globalStatus.textContent = message;
  pushToast(message, "error");

  app.statusTimeout = setTimeout(() => {
    if (getActiveContext().blockedReason) return;
    dom.globalStatus.classList.add("hidden");
    dom.globalStatus.classList.remove("error", "context-block");
    dom.globalStatus.textContent = "";
  }, 5000);
}

function parseDateTime(date, time) {
  return new Date(`${date}T${time || "00:00"}:00`);
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setDate(date.getDate() + Number(days || 0));
  return getLocalDateKey(date);
}

function formatSchedule(medication) {
  const presetKey = normalizeSchedulePresetValue(medication.schedulePreset);
  const preset = SCHEDULE_PRESETS[presetKey]?.label || "Custom";
  const times = (medication.scheduleTimes || []).join(", ");
  return times ? `${preset} · ${times}` : preset;
}

function shortDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function niceDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function niceDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatClockTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isoDateTime(date) {
  return date.toISOString();
}

function dateDiffDays(left, right) {
  const leftDate = new Date(`${left}T12:00:00`);
  const rightDate = new Date(`${right}T12:00:00`);
  return Math.abs((rightDate.getTime() - leftDate.getTime()) / (1000 * 60 * 60 * 24));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function clampDecimal(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, roundNumber(num, 2)));
}

function roundNumber(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function uid() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 11)}`;
}

function createSecureShareToken() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${uid()}${Math.random().toString(36).slice(2, 14)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function valueOrDefault(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function formatNeedsConfirmationMessage(value) {
  const text = String(value || "").trim();
  const stripped = text.replace(/^Needs confirmation:\s*/i, "").trim();
  return stripped || "Conflicting values require confirmation.";
}

function normalizeTags(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function isTimeValue(value) {
  return /^\d{2}:\d{2}$/.test(String(value || "").trim());
}

function doseLooksValid(value) {
  return /\d/.test(String(value || ""));
}

function extractOldDose(text) {
  const parts = String(text || "").split("->");
  return parts[0]?.trim() || "";
}

function extractNewDose(text) {
  const parts = String(text || "").split("->");
  return parts[1]?.trim() || text || "";
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];

  for (const row of rows) {
    const line = headers
      .map((header) => {
        const cell = String(row[header] ?? "").replaceAll('"', '""');
        return `"${cell}"`;
      })
      .join(",");
    lines.push(line);
  }

  return lines.join("\n");
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}
