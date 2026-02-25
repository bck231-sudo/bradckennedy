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
import { buildDataQualityIndicators, computeBeforeAfterComparison } from "./consult-engine.js";

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
const REMOTE_REQUEST_TIMEOUT_MS = 12000;
const DASHBOARD_DOSE_PAGE_SIZE = 8;
const UTILITY_PANEL_MIN_WIDTH = 1500;
const PRODUCTION_SYNC_ENDPOINT = "https://medication-tracker-api.onrender.com";
const LOCAL_ONLY_MODE = true;
const SUMMARY_RANGE_OPTIONS = ["7", "14", "30"];
const CONSULT_RANGE_OPTIONS = ["7", "14", "30"];
const QUICK_CHECKIN_30S_OPTIONS = Object.freeze({
  mood: [
    { value: "low", label: "Low", score: 3 },
    { value: "okay", label: "Okay", score: 6 },
    { value: "good", label: "Good", score: 8 }
  ],
  anxiety: [
    { value: "low", label: "Low", score: 3 },
    { value: "medium", label: "Medium", score: 6 },
    { value: "high", label: "High", score: 8 }
  ],
  sleep: [
    { value: "poor", label: "Poor", hours: 4.5, quality: 3 },
    { value: "okay", label: "Okay", hours: 6.5, quality: 6 },
    { value: "good", label: "Good", hours: 8, quality: 8 }
  ]
});
const DEFAULT_QUICK_CHECKIN_30S_STATE = Object.freeze({
  mood: "",
  anxiety: "",
  sleep: "",
  date: ""
});
const CONSULT_QUESTION_URGENCY_RANK = Object.freeze({
  high: 0,
  medium: 1,
  low: 2
});
const CONSULT_QUESTION_STATUS_RANK = Object.freeze({
  open: 0,
  carry_forward: 1,
  discussed: 2,
  resolved: 3
});
const CONSULT_QUESTION_STATUS_LABELS = Object.freeze({
  open: "open",
  carry_forward: "carry forward",
  discussed: "discussed",
  resolved: "resolved"
});
const TIMELINE_LAZY_CHART_DEFAULTS = Object.freeze({
  adherence: true,
  symptoms: true,
  sleep: false,
  sideEffects: false,
  doseChanges: false
});
const DATA_CONFIDENCE_MIN_CHECKINS = 4;
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
  my: { label: "My View", shortLabel: "My View" },
  clinician: { label: "Psychiatrist View", shortLabel: "Psychiatrist" },
  family: { label: "Family", shortLabel: "Family" },
  preview_link: { label: "Shared Preview", shortLabel: "Shared Preview" }
};
const VIEWER_MODE_ORDER = ["my", "family", "clinician", "preview_link"];

const VIEWER_BADGES = {
  owner: "My View (Editable)",
  clinician: "Psychiatrist View (Read-only)",
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
    primarySection: "changes",
    fallbackSections: [],
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
    id: "medications",
    label: "Medications",
    icon: "capsule",
    primarySection: "medications",
    fallbackSections: ["dashboard"],
    preferredModes: ["daily", "clinical", "personal"]
  },
  {
    id: "trends",
    label: "Trends",
    icon: "chart",
    primarySection: "timeline",
    fallbackSections: ["changes"],
    preferredModes: ["clinical", "personal"]
  },
  {
    id: "consult",
    label: "Consult",
    icon: "stethoscope",
    primarySection: "consult",
    fallbackSections: ["timeline"],
    preferredModes: ["clinical", "personal"]
  },
  {
    id: "history",
    label: "History",
    icon: "chart",
    primarySection: "changes",
    fallbackSections: ["timeline"],
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
    id: "consult",
    label: "Consult",
    icon: "stethoscope",
    title: "Consult",
    subtitle: "Psychiatrist-focused review summary for appointments and continuity.",
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
  check: `<path d="m5 12 4 4 10-10"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7 3.5v3"/><path d="M17 3.5v3"/><path d="M3.5 9.5h17"/>`,
  pulse: `<path d="M3 12h4l2.3-4 4.2 8 2.2-4H21"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`,
  stethoscope: `<path d="M7 4v4a4 4 0 1 0 8 0V4"/><path d="M9 4v4a2 2 0 1 0 4 0V4"/><path d="M15 12v2a4 4 0 1 0 8 0v-1"/><circle cx="22" cy="12" r="2"/>`
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
  installAppButton: document.getElementById("installAppButton"),
  addToConsultButton: document.getElementById("addToConsultButton"),
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
    consult: document.getElementById("section-consult"),
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
    checkinQuickMode: false,
    comparisonChangeId: "",
    pendingDoseActions: new Set(),
    lastDraftSavedAt: "",
    hasRendered: false,
    dashboardDoseView: "cards",
    dashboardDoseFilter: "all",
    dashboardDosePage: 1,
    dashboardDoseSearch: "",
    medicationsFilterSearch: "",
    medicationsFilterStatus: "all",
    medicationsSortBy: "name",
    medicationsSortDir: "asc",
    changesFilterSearch: "",
    changesFilterMedication: "all",
    changesSortBy: "date_desc",
    dashboardEdits: {
      summary: false,
      alerts: false,
      changes: false,
      medications: false,
      actionPlan: false
    },
    dashboardCollapsedPanels: {
      changes: false,
      medicationDetails: false,
      consultPrep: false,
      alerts: false
    },
    dashboardTrendView: "simple",
    dashboardTrendRangeDays: "7",
    exportSummaryRangeDays: "14",
    timelineLazyCharts: { ...TIMELINE_LAZY_CHART_DEFAULTS },
    timelineFilters: {
      medicationId: "all",
      rangeDays: "14",
      fromDate: "",
      toDate: ""
    },
    consultFilters: {
      range: "since_last_appointment",
      medicationId: "all",
      customRangeDays: "14",
      openQuestionsOnly: true,
      sideEffectsWindow: "all"
    },
    consultActivePane: "current",
    consultEditingExperimentId: "",
    consultEditingQuestionId: "",
    consultEditingDecisionId: "",
    consultEditingAppointmentId: ""
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
  pwa: {
    installPromptEvent: null,
    installed: false
  },
  derivedMemo: {
    currentMedsKey: "",
    currentMedsValue: [],
    riskHistoryKey: "",
    riskHistoryValue: [],
    timelineFilteredKey: "",
    timelineFilteredValue: null
  },
  queueRemoteSync: () => {}
};

if (app.drafts?.ui && typeof app.drafts.ui === "object") {
  if (app.drafts.ui.dashboardCollapsedPanels && typeof app.drafts.ui.dashboardCollapsedPanels === "object") {
    app.ui.dashboardCollapsedPanels = {
      ...app.ui.dashboardCollapsedPanels,
      ...app.drafts.ui.dashboardCollapsedPanels
    };
  }
  if (typeof app.drafts.ui.consultActivePane === "string") {
    app.ui.consultActivePane = app.drafts.ui.consultActivePane;
  }
}

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
applySectionRouteFromHash(window.location.hash);
applyThemePreference(app.ownerData.profile);

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
  const persisted = storage.writeJson(STORAGE_KEY, payload);
  if (!persisted && options.throwOnPersistFailure) {
    throw new Error("Local save failed. Check browser storage availability and retry.");
  }
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
      quietUntilOverdue: true,
      overdueEscalationMinutes: 10,
      riskAlertsEnabled: true,
      riskAlertsMinLevel: "elevated"
    },
    shareLinks: [],
    profile: defaultOwnerProfile(),
    dashboardConfig: defaultDashboardConfig(),
    consultConfig: defaultConsultConfig(),
    medicationChangeExperiments: [],
    consultQuestions: [],
    decisionLog: [],
    sideEffectEvents: [],
    appointmentEvents: [],
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
    gotOutOfBedOnTime: false,
    selfCareCompleted: false,
    keyTaskCompleted: false,
    exerciseOrWalkDone: false,
    avoidedImpulsiveBehaviour: false,
    socialContactLevel: "limited",
    functionScore: null,
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
    consultConfig: normalizeConsultConfig(input.consultConfig),
    medicationChangeExperiments: [],
    consultQuestions: [],
    decisionLog: [],
    sideEffectEvents: [],
    appointmentEvents: [],
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
    const normalizedChange = {
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
    };
    migrated.changes.push(normalizedChange);
    migrated.medicationChangeExperiments.push(normalizeMedicationChangeExperiment(normalizedChange));
  }

  for (const experiment of Array.isArray(input.medicationChangeExperiments) ? input.medicationChangeExperiments : []) {
    migrated.medicationChangeExperiments.push(normalizeMedicationChangeExperiment(experiment));
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

  for (const question of Array.isArray(input.consultQuestions) ? input.consultQuestions : []) {
    migrated.consultQuestions.push(normalizeConsultQuestion(question));
  }

  for (const decision of Array.isArray(input.decisionLog) ? input.decisionLog : []) {
    migrated.decisionLog.push(normalizeDecisionLogEntry(decision));
  }

  for (const event of Array.isArray(input.sideEffectEvents) ? input.sideEffectEvents : []) {
    migrated.sideEffectEvents.push(normalizeSideEffectEvent(event));
  }

  for (const appointment of Array.isArray(input.appointmentEvents) ? input.appointmentEvents : []) {
    migrated.appointmentEvents.push(normalizeAppointmentEvent(appointment));
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
      startSection: ["dashboard", "consult"].includes(String(link.startSection || "").toLowerCase())
        ? String(link.startSection).toLowerCase()
        : "dashboard",
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
    consultConfig: normalizeConsultConfig(input.consultConfig),
    medicationChangeExperiments: [],
    consultQuestions: [],
    decisionLog: [],
    sideEffectEvents: [],
    appointmentEvents: [],
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
    const dateEffective = change.dateEffective || change.date || isoDate(new Date());
    state.changes.push({
      id: change.id || uid(),
      medicationId: change.medicationId || "",
      medicationName: change.medicationName || "",
      date: dateEffective,
      dateEffective,
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

  const rawExperiments = Array.isArray(input.medicationChangeExperiments)
    ? input.medicationChangeExperiments
    : state.changes.map((change) => convertChangeToExperiment(change));
  for (const experiment of rawExperiments) {
    state.medicationChangeExperiments.push(normalizeMedicationChangeExperiment(experiment));
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

  for (const question of Array.isArray(input.consultQuestions) ? input.consultQuestions : []) {
    state.consultQuestions.push(normalizeConsultQuestion(question));
  }

  for (const decision of Array.isArray(input.decisionLog) ? input.decisionLog : []) {
    state.decisionLog.push(normalizeDecisionLogEntry(decision));
  }

  for (const event of Array.isArray(input.sideEffectEvents) ? input.sideEffectEvents : []) {
    state.sideEffectEvents.push(normalizeSideEffectEvent(event));
  }

  for (const appointment of Array.isArray(input.appointmentEvents) ? input.appointmentEvents : []) {
    state.appointmentEvents.push(normalizeAppointmentEvent(appointment));
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
      startSection: ["dashboard", "consult"].includes(String(link.startSection || "").toLowerCase())
        ? String(link.startSection).toLowerCase()
        : "dashboard",
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
  const socialContact = String(input?.socialContactLevel || "limited").toLowerCase();
  const normalizedSocialContact = ["none", "limited", "normal"].includes(socialContact) ? socialContact : "limited";
  return {
    id: input?.id || uid(),
    date: input?.date || isoDate(new Date()),
    mood: clampNumber(input?.mood, 0, 10),
    anxiety: clampNumber(input?.anxiety, 0, 10),
    focus: clampNumber(input?.focus, 0, 10),
    sleepHours: clampDecimal(input?.sleepHours, 0, 24),
    sleepQuality: clampNumber(input?.sleepQuality, 0, 10),
    appetite: clampNumber(input?.appetite, 0, 10),
    energy: clampNumber(input?.energy, 0, 10),
    irritability: clampNumber(input?.irritability, 0, 10),
    cravingsImpulsivity: clampNumber(input?.cravingsImpulsivity, 0, 10),
    sideEffectsChecklist: Array.isArray(input?.sideEffectsChecklist) ? input.sideEffectsChecklist : [],
    sideEffectsText: input?.sideEffectsText || "",
    trainingNotes: input?.trainingNotes || "",
    gotOutOfBedOnTime: Boolean(input?.gotOutOfBedOnTime),
    selfCareCompleted: Boolean(input?.selfCareCompleted),
    keyTaskCompleted: Boolean(input?.keyTaskCompleted),
    exerciseOrWalkDone: Boolean(input?.exerciseOrWalkDone),
    avoidedImpulsiveBehaviour: Boolean(input?.avoidedImpulsiveBehaviour),
    socialContactLevel: normalizedSocialContact,
    functionScore: Number.isFinite(Number(input?.functionScore))
      ? Math.max(0, Math.min(5, Math.round(Number(input.functionScore))))
      : null,
    entryMode: String(input?.entryMode || "full").toLowerCase() === "quick_30s" ? "quick_30s" : "full",
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
  const overdueEscalationMinutes = Number(source.overdueEscalationMinutes);
  const minLevel = String(source.riskAlertsMinLevel || "elevated").toLowerCase();
  return {
    enabled: Boolean(source.enabled),
    leadMinutes: Number.isFinite(leadMinutes) ? Math.min(120, Math.max(0, Math.round(leadMinutes))) : 15,
    desktopNotifications: Boolean(source.desktopNotifications),
    quietUntilOverdue: source.quietUntilOverdue !== false,
    overdueEscalationMinutes: Number.isFinite(overdueEscalationMinutes) ? Math.min(120, Math.max(0, Math.round(overdueEscalationMinutes))) : 10,
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
        startSection: ["dashboard", "consult"].includes(String(payload.startSection || "").toLowerCase())
          ? String(payload.startSection).toLowerCase()
          : "dashboard",
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
        startSection: "dashboard",
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
  app.ui.activeSection = app.shareSession.startSection === "consult" ? "consult" : "dashboard";
}

function loadDrafts() {
  const raw = storage.readText(DRAFT_KEY, "");
  if (!raw) {
    return {
      medication: {},
      change: {},
      note: {},
      checkin: {},
      checkinQuick: { ...DEFAULT_QUICK_CHECKIN_30S_STATE },
      ui: {}
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      medication: parsed.medication || {},
      change: parsed.change || {},
      note: parsed.note || {},
      checkin: parsed.checkin || {},
      checkinQuick: normalizeQuickCheckin30sDraft(parsed.checkinQuick || {}),
      ui: parsed.ui && typeof parsed.ui === "object" ? parsed.ui : {}
    };
  } catch (_error) {
    return {
      medication: {},
      change: {},
      note: {},
      checkin: {},
      checkinQuick: { ...DEFAULT_QUICK_CHECKIN_30S_STATE },
      ui: {}
    };
  }
}

function saveDrafts() {
  storage.writeJson(DRAFT_KEY, app.drafts);
  app.ui.lastDraftSavedAt = isoDateTime(new Date());
}

function persistUiDraftPreferences() {
  app.drafts.ui = {
    ...(app.drafts.ui || {}),
    dashboardCollapsedPanels: { ...(app.ui.dashboardCollapsedPanels || {}) },
    consultActivePane: String(app.ui.consultActivePane || "current")
  };
  saveDrafts();
}

function defaultOwnerProfile() {
  return {
    displayName: "",
    personalizationEnabled: true,
    themePreference: "light"
  };
}

function normalizeOwnerProfile(input) {
  const themePreference = String(input?.themePreference || "light").toLowerCase();
  return {
    displayName: String(input?.displayName || "").trim(),
    personalizationEnabled: input?.personalizationEnabled !== false,
    themePreference: ["light", "dark", "system"].includes(themePreference) ? themePreference : "light"
  };
}

function resolvedThemePreference(themePreference) {
  if (themePreference === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }
  return themePreference === "dark" ? "dark" : "light";
}

function applyThemePreference(profile) {
  const normalized = normalizeOwnerProfile(profile);
  const resolved = resolvedThemePreference(normalized.themePreference);
  document.documentElement.setAttribute("data-theme", resolved);
  document.body.dataset.themePreference = normalized.themePreference;
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

function defaultConsultConfig() {
  return {
    discussToday: "",
    activeFilters: {
      range: "since_last_appointment",
      medicationId: "all",
      customRangeDays: "14",
      openQuestionsOnly: true,
      sideEffectsWindow: "all"
    }
  };
}

function normalizeConsultConfig(input) {
  const defaults = defaultConsultConfig();
  const source = input && typeof input === "object" ? input : {};
  const range = String(source?.activeFilters?.range || defaults.activeFilters.range);
  const customRangeDays = String(source?.activeFilters?.customRangeDays || defaults.activeFilters.customRangeDays);
  return {
    discussToday: String(source.discussToday || "").trim().slice(0, 500),
    activeFilters: {
      range: ["since_last_appointment", "since_last_change", "last_days"].includes(range)
        ? range
        : defaults.activeFilters.range,
      medicationId: String(source?.activeFilters?.medicationId || defaults.activeFilters.medicationId),
      customRangeDays: CONSULT_RANGE_OPTIONS.includes(customRangeDays)
        ? customRangeDays
        : defaults.activeFilters.customRangeDays,
      openQuestionsOnly: source?.activeFilters?.openQuestionsOnly !== false,
      sideEffectsWindow: String(source?.activeFilters?.sideEffectsWindow || defaults.activeFilters.sideEffectsWindow)
    }
  };
}

function normalizeMedicationChangeExperiment(input) {
  const now = isoDateTime(new Date());
  const dateEffective = String(input?.dateEffective || input?.date || isoDate(new Date()));
  const outcomeStatus = String(input?.outcomeStatus || "pending").toLowerCase();
  const confidence = String(input?.confidenceInOutcome || "medium").toLowerCase();
  return {
    id: String(input?.id || uid()),
    medicationId: String(input?.medicationId || ""),
    medicationName: String(input?.medicationName || ""),
    dateEffective,
    oldDose: String(input?.oldDose || ""),
    newDose: String(input?.newDose || ""),
    route: String(input?.route || ""),
    scheduleChange: String(input?.scheduleChange || ""),
    changedBy: String(input?.changedBy || "self"),
    reasonForChange: String(input?.reasonForChange || input?.reason || ""),
    expectedBenefit: String(input?.expectedBenefit || input?.expectedEffects || ""),
    expectedSideEffects: String(input?.expectedSideEffects || ""),
    whatToMonitor: String(input?.whatToMonitor || input?.monitorFor || ""),
    reviewDate: String(input?.reviewDate || ""),
    outcomeStatus: ["better", "worse", "mixed", "unclear", "pending"].includes(outcomeStatus)
      ? outcomeStatus
      : "pending",
    outcomeNotes: String(input?.outcomeNotes || input?.notes || ""),
    confidenceInOutcome: ["low", "medium", "high"].includes(confidence) ? confidence : "medium",
    linkedChangeId: String(input?.linkedChangeId || input?.id || ""),
    createdAt: String(input?.createdAt || now),
    updatedAt: String(input?.updatedAt || input?.createdAt || now)
  };
}

function convertChangeToExperiment(change) {
  return normalizeMedicationChangeExperiment({
    id: change?.id || uid(),
    linkedChangeId: change?.id || "",
    medicationId: change?.medicationId || "",
    medicationName: change?.medicationName || "",
    dateEffective: change?.dateEffective || change?.date || isoDate(new Date()),
    oldDose: change?.oldDose || "",
    newDose: change?.newDose || "",
    route: change?.route || "",
    changedBy: change?.changedBy || "self",
    reasonForChange: change?.reasonForChange || change?.reason || "",
    expectedBenefit: change?.expectedEffects || "",
    whatToMonitor: change?.monitorFor || change?.interpretation?.monitor || "",
    reviewDate: change?.reviewDate || "",
    outcomeNotes: change?.notes || "",
    confidenceInOutcome: "medium",
    createdAt: change?.createdAt || isoDateTime(new Date()),
    updatedAt: change?.createdAt || isoDateTime(new Date())
  });
}

function normalizeConsultQuestion(input) {
  const now = isoDateTime(new Date());
  const urgency = String(input?.urgency || "medium").toLowerCase();
  const status = String(input?.status || "open").toLowerCase();
  return {
    id: String(input?.id || uid()),
    text: String(input?.text || "").trim(),
    category: String(input?.category || "question").toLowerCase(),
    linkedMedication: String(input?.linkedMedication || ""),
    urgency: ["low", "medium", "high"].includes(urgency) ? urgency : "medium",
    status: ["open", "discussed", "resolved", "carry_forward"].includes(status) ? status : "open",
    createdAt: String(input?.createdAt || now),
    discussedAt: String(input?.discussedAt || ""),
    note: String(input?.note || "")
  };
}

function normalizeDecisionLogEntry(input) {
  const now = isoDateTime(new Date());
  const decisions = Array.isArray(input?.decisions)
    ? input.decisions
        .map((item) => ({
          id: String(item?.id || uid()),
          decisionType: String(item?.decisionType || ""),
          medication: String(item?.medication || ""),
          oldValue: String(item?.oldValue || ""),
          newValue: String(item?.newValue || ""),
          effectiveDate: String(item?.effectiveDate || ""),
          instructions: String(item?.instructions || "")
        }))
        .filter((item) => item.decisionType || item.medication || item.instructions)
    : [];

  return {
    id: String(input?.id || uid()),
    appointmentDate: String(input?.appointmentDate || isoDate(new Date())),
    appointmentId: String(input?.appointmentId || ""),
    clinicianName: String(input?.clinicianName || ""),
    decisions,
    rationale: String(input?.rationale || ""),
    successCriteria: String(input?.successCriteria || ""),
    failureCriteria: String(input?.failureCriteria || input?.concerns || ""),
    planUntilNextReview: String(input?.planUntilNextReview || ""),
    followUpDate: String(input?.followUpDate || ""),
    contingencyPlan: String(input?.contingencyPlan || ""),
    notes: String(input?.notes || ""),
    linkedExperimentId: String(input?.linkedExperimentId || ""),
    createdAt: String(input?.createdAt || now),
    updatedAt: String(input?.updatedAt || input?.createdAt || now)
  };
}

function normalizeSideEffectEvent(input) {
  const now = isoDateTime(new Date());
  const severityRaw = Number(input?.severity);
  return {
    id: String(input?.id || uid()),
    date: String(input?.date || input?.createdAt || isoDate(new Date())),
    symptomName: String(input?.symptomName || ""),
    severity: Number.isFinite(severityRaw) ? Math.max(0, Math.min(10, Math.round(severityRaw))) : 0,
    linkedMedication: String(input?.linkedMedication || input?.medicationName || ""),
    linkedDoseLogId: String(input?.linkedDoseLogId || ""),
    onsetAfterDoseMinutes: Number.isFinite(Number(input?.onsetAfterDoseMinutes))
      ? Math.max(0, Math.round(Number(input.onsetAfterDoseMinutes)))
      : null,
    timeOfDay: String(input?.timeOfDay || ""),
    durationMinutes: Number.isFinite(Number(input?.durationMinutes))
      ? Math.max(0, Math.round(Number(input.durationMinutes)))
      : null,
    confidenceRelatedToMed: ["low", "medium", "high"].includes(String(input?.confidenceRelatedToMed || "").toLowerCase())
      ? String(input.confidenceRelatedToMed).toLowerCase()
      : "medium",
    impactOnFunction: ["low", "medium", "high"].includes(String(input?.impactOnFunction || "").toLowerCase())
      ? String(input.impactOnFunction).toLowerCase()
      : "medium",
    note: String(input?.note || ""),
    createdAt: String(input?.createdAt || now)
  };
}

function normalizeAppointmentEvent(input) {
  const now = isoDateTime(new Date());
  const type = String(input?.appointmentType || "psychiatrist").toLowerCase();
  return {
    id: String(input?.id || uid()),
    appointmentDate: String(input?.appointmentDate || isoDate(new Date())),
    appointmentType: ["psychiatrist", "gp", "other"].includes(type) ? type : "other",
    summaryNote: String(input?.summaryNote || ""),
    createdAt: String(input?.createdAt || now)
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
  if (context.type === "owner" && !context.readOnly) {
    return getSourceData();
  }
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

    source.sideEffectEvents = (source.sideEffectEvents || []).map((entry) => ({
      ...entry,
      note: entry.note ? "[Hidden by link settings]" : ""
    }));

    source.consultQuestions = (source.consultQuestions || []).map((entry) => ({
      ...entry,
      note: entry.note ? "[Hidden by link settings]" : ""
    }));

    source.decisionLog = (source.decisionLog || []).map((entry) => ({
      ...entry,
      notes: entry.notes ? "[Hidden by link settings]" : "",
      rationale: entry.rationale ? "[Hidden by link settings]" : "",
      contingencyPlan: entry.contingencyPlan ? "[Hidden by link settings]" : ""
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
  dom.viewerModeSelect?.addEventListener("change", (event) => {
    app.ui.viewerMode = event.target.value;
    if (app.ui.viewerMode !== "preview_link") {
      app.ui.previewLinkId = "";
    }
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.viewModeSelect?.addEventListener("change", (event) => {
    app.ui.activeViewMode = event.target.value;
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.previewLinkSelect?.addEventListener("change", (event) => {
    app.ui.viewerMode = "preview_link";
    app.ui.previewLinkId = event.target.value;
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.quickCheckinButton.addEventListener("click", () => {
    if (getActiveContext().readOnly) return;
    app.ui.activeSection = "entry";
    app.ui.entryWorkflow = "checkin";
    app.ui.checkinQuickMode = false;
    renderAll();
  });

  dom.addToConsultButton?.addEventListener("click", () => {
    const context = getActiveContext();
    if (context.readOnly) return;
    const text = window.prompt("Add a question or concern for your next consult:");
    const trimmed = String(text || "").trim();
    if (!trimmed) return;
    const now = isoDateTime(new Date());
    app.ownerData.consultQuestions.push(normalizeConsultQuestion({
      id: uid(),
      text: trimmed,
      category: "question",
      urgency: "medium",
      status: "open",
      createdAt: now
    }));
    saveOwnerData(app.ownerData);
    app.ui.activeSection = "consult";
    app.ui.consultActivePane = "questions";
    persistUiDraftPreferences();
    setStatus("Added to consult question queue.");
    renderAll();
  });

  dom.installAppButton?.addEventListener("click", () => {
    void promptPwaInstall();
  });

  dom.closeMedicationModal?.addEventListener("click", closeMedicationModal);
  dom.medicationModal?.addEventListener("click", (event) => {
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

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    app.pwa.installPromptEvent = event;
    updateInstallButtonVisibility();
  });

  window.addEventListener("appinstalled", () => {
    app.pwa.installed = true;
    app.pwa.installPromptEvent = null;
    updateInstallButtonVisibility();
    setStatus("App installed.");
  });

  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    const profile = normalizeOwnerProfile(app.ownerData.profile);
    if (profile.themePreference === "system") {
      applyThemePreference(profile);
    }
  });
}

function parseSectionRouteFromHash(hashValue) {
  const normalized = String(hashValue || "").trim().toLowerCase();
  if (!normalized || normalized.includes("=")) return null;
  const route = normalized.replace(/^#/, "");
  if (!route) return null;
  if (route === "dashboard") return { sectionId: "dashboard", preferredModes: ["daily", "clinical", "personal"], fallbackSections: [] };
  if (route === "medications") return { sectionId: "medications", preferredModes: ["daily", "clinical", "personal"], fallbackSections: ["dashboard"] };
  if (route === "trends") return { sectionId: "timeline", preferredModes: ["clinical", "personal"], fallbackSections: ["changes"] };
  if (route === "consult") return { sectionId: "consult", preferredModes: ["clinical", "personal"], fallbackSections: ["timeline"] };
  if (route === "history") return { sectionId: "changes", preferredModes: ["clinical", "personal"], fallbackSections: ["timeline"] };
  if (route === "settings") return { sectionId: "exports", preferredModes: ["personal", "clinical"], fallbackSections: ["sharing"] };
  if (route === "share") return { sectionId: "sharing", preferredModes: ["clinical", "personal"], fallbackSections: ["exports"] };
  return null;
}

function applySectionRouteFromHash(hashValue) {
  if (app.shareSession) return false;
  const route = parseSectionRouteFromHash(hashValue);
  if (!route) return false;
  return navigateToSection(route.sectionId, {
    preferredModes: route.preferredModes,
    fallbackSections: route.fallbackSections
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
      applySectionRouteFromHash(window.location.hash);
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
    const registration = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
    registration.update().catch(() => {});
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          setStatus("Updating app shell… reloading to apply latest design.");
          setTimeout(() => window.location.reload(), 350);
        }
      });
    });
    if (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true) {
      app.pwa.installed = true;
      app.pwa.installPromptEvent = null;
    }
    updateInstallButtonVisibility();
  } catch (error) {
    console.error("Service worker registration failed:", error);
  }
}

function updateInstallButtonVisibility() {
  if (!dom.installAppButton) return;
  const canPromptInstall = Boolean(app.pwa.installPromptEvent) && !app.pwa.installed;
  dom.installAppButton.hidden = !canPromptInstall;
}

async function promptPwaInstall() {
  if (!app.pwa.installPromptEvent) {
    setStatus("Install prompt is not available yet on this device/browser.", "error");
    return;
  }
  const promptEvent = app.pwa.installPromptEvent;
  app.pwa.installPromptEvent = null;
  updateInstallButtonVisibility();
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") {
      app.pwa.installed = true;
      setStatus("Install started.");
    } else {
      setStatus("Install dismissed.");
    }
  } catch (_error) {
    setStatus("Install prompt could not be completed.", "error");
  } finally {
    updateInstallButtonVisibility();
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
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), REMOTE_REQUEST_TIMEOUT_MS)
    : null;
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        ...remoteHeaders(),
        ...(init.headers || {})
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Cloud request timed out after ${Math.round(REMOTE_REQUEST_TIMEOUT_MS / 1000)}s. Cannot reach API at ${base}.`);
    }
    if (error instanceof Error && /failed to fetch|networkerror|load failed|fetch failed/i.test(error.message || "")) {
      throw new Error(`Cannot reach cloud API at ${base}. Check Share -> Settings -> API endpoint and ensure the backend is online.`);
    }
    throw error instanceof Error ? error : new Error("Cloud request failed.");
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
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
  const overdueEscalationMinutes = Number(settings.overdueEscalationMinutes || 0);
  const now = new Date();
  const today = getLocalDateKey(now);
  let reminderLogChanged = false;
  for (const [key, value] of Object.entries(app.reminderLog)) {
    const recordDate = value?.date || value?.quietDate || value?.overdueDate;
    if (!recordDate) continue;
    if (recordDate < shiftDateKey(today, -7)) {
      delete app.reminderLog[key];
      reminderLogChanged = true;
    }
  }
  if (reminderLogChanged) {
    saveReminderLog();
  }
  const activeMeds = resolveCurrentMedications(app.ownerData).filter((med) => med.isCurrent);
  const dueState = getDoseState(activeMeds, app.ownerData.adherence, app.ownerData.doseSnoozes);
  const candidates = [...dueState.dueNow, ...dueState.next];

  for (const item of candidates) {
    const scheduled = parseDateTime(today, item.time);
    const diffMinutes = Math.round((scheduled.getTime() - now.getTime()) / 60000);
    const log = app.reminderLog[item.occurrenceId] || {};

    if (settings.quietUntilOverdue) {
      if (diffMinutes <= leadMinutes && diffMinutes >= 0 && log.quietDate !== today) {
        app.reminderLog[item.occurrenceId] = {
          ...log,
          quietDate: today,
          quietAt: isoDateTime(now),
          scheduledFor: isoDateTime(scheduled)
        };
        saveReminderLog();
      }

      if (diffMinutes < -overdueEscalationMinutes && log.overdueDate !== today) {
        const message = `Overdue dose: ${item.medicationName} was due at ${item.time}`;
        app.reminderLog[item.occurrenceId] = {
          ...log,
          date: today,
          overdueDate: today,
          overdueAt: isoDateTime(now),
          scheduledFor: isoDateTime(scheduled)
        };
        saveReminderLog();
        pushToast(message, "warning");
        if (settings.desktopNotifications && "Notification" in window && Notification.permission === "granted") {
          new Notification("Overdue medication reminder", { body: message });
        }
      }
      continue;
    }

    if (diffMinutes > leadMinutes || log?.date === today) continue;
    const message = diffMinutes <= 0
      ? `Dose due now: ${item.medicationName} at ${item.time}`
      : `Dose due in ${diffMinutes}m: ${item.medicationName} at ${item.time}`;
    app.reminderLog[item.occurrenceId] = {
      ...log,
      date: today,
      firedAt: isoDateTime(now),
      scheduledFor: isoDateTime(scheduled)
    };
    saveReminderLog();
    pushToast(message, diffMinutes <= 0 ? "warning" : "info");
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
  applyThemePreference(app.ownerData.profile);
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
  if (!dom.viewerModeSelect || !dom.viewerModeSegment || !dom.viewModeSelect) {
    return;
  }
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

function renderViewerCapabilitySummary(context) {
  if (!context?.readOnly) return "";
  const allowedModes = (context.allowedModes || [])
    .map((mode) => VIEW_MODE_META[mode]?.label || mode)
    .filter(Boolean);
  const hidden = [];
  if (!context.permissions?.showSensitiveNotes) hidden.push("sensitive notes");
  if (!context.permissions?.showJournalText) hidden.push("journal text");
  if (!context.permissions?.showLibido) hidden.push("libido/sexual side effects");
  if (!context.permissions?.showSubstance) hidden.push("substance-use notes");
  if (!context.permissions?.showFreeText) hidden.push("free-text notes");
  if (!context.permissions?.showSensitiveTags) hidden.push("sensitive tags");

  const viewSummary = allowedModes.length ? allowedModes.join(", ") : "none";
  const hiddenSummary = hidden.length ? hidden.join(", ") : "none";
  return `<div class="subtle" style="margin-top:4px;">Can view: ${escapeHtml(viewSummary)} · Hidden: ${escapeHtml(hiddenSummary)}</div>`;
}

function renderContextElements(context) {
  dom.contextPill.textContent = resolveContextBadge(context);
  // Shared-link preview selection lives in the Share tab to keep top controls focused.
  if (dom.previewLinkControl) dom.previewLinkControl.classList.add("hidden");
  if (dom.previewLinkSelect) dom.previewLinkSelect.innerHTML = "";

  if (context.type === "share") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Read-only access:</strong> Shared for ${escapeHtml(context.label)}.${context.expiresAt ? ` Link expires ${escapeHtml(niceDate(context.expiresAt))}.` : ""}${renderViewerCapabilitySummary(context)}`;
  } else if (context.type === "authenticated_viewer") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Read-only account:</strong> You are signed in with viewer permissions (${escapeHtml(context.label)}).${renderViewerCapabilitySummary(context)}`;
  } else if (context.type === "preview") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Preview mode:</strong> You are previewing ${escapeHtml(context.label)} permissions in read-only mode.${renderViewerCapabilitySummary(context)}`;
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

function hashForSection(sectionId) {
  if (sectionId === "dashboard") return "#dashboard";
  if (sectionId === "medications") return "#medications";
  if (sectionId === "consult") return "#consult";
  if (sectionId === "timeline") return "#trends";
  if (sectionId === "changes") return "#history";
  if (sectionId === "sharing") return "#share";
  if (sectionId === "exports") return "#settings";
  return "";
}

function syncHashWithSection(sectionId) {
  if (typeof window === "undefined" || app.shareSession) return;
  const targetHash = hashForSection(sectionId);
  if (!targetHash) return;
  if (window.location.hash === targetHash) return;
  window.history.replaceState(null, "", targetHash);
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
    syncHashWithSection(candidate);
    return true;
  }

  const currentSections = availableSections(context, app.ui.activeViewMode);
  app.ui.activeSection = currentSections[0]?.id || "dashboard";
  syncHashWithSection(app.ui.activeSection);
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
      syncHashWithSection(app.ui.activeSection);
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
  const utilityVisible = typeof window !== "undefined"
    ? Boolean(window.matchMedia?.(`(min-width: ${UTILITY_PANEL_MIN_WIDTH}px)`)?.matches)
    : false;
  if (!utilityVisible) {
    dom.utilityPanel.innerHTML = "";
    return;
  }
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
      ${context.readOnly ? "" : `<div class="subtle">Reminders: ${app.ownerData.reminderSettings?.enabled ? `On (${app.ownerData.reminderSettings.leadMinutes || 0}m${app.ownerData.reminderSettings?.quietUntilOverdue ? ", quiet until overdue" : ""})` : "Off"}</div>`}
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
        app.ui.checkinQuickMode = false;
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
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.toggle("viewer-mode", Boolean(context.readOnly));
    document.body.classList.toggle("owner-mode", !context.readOnly);
  }
  if (dom.quickCheckinButton) {
    dom.quickCheckinButton.disabled = Boolean(context.readOnly);
    dom.quickCheckinButton.title = context.readOnly ? "Quick check-in is disabled in read-only mode." : "Open quick check-in";
  }
  if (dom.addToConsultButton) {
    dom.addToConsultButton.disabled = Boolean(context.readOnly);
    dom.addToConsultButton.title = context.readOnly ? "Consult queue is read-only in this view." : "Quickly add a consult question";
  }
  updateInstallButtonVisibility();
  if (dom.roleBadge) {
    const roleLabel = context.readOnly
      ? context.type === "share"
        ? "Psychiatrist View (Shared)"
        : context.type === "authenticated_viewer"
          ? `Read-only (${(app.syncConfig.authRole || "viewer").replace(/^./, (ch) => ch.toUpperCase())})`
          : app.ui.viewerMode === "clinician"
            ? "Psychiatrist View"
            : app.ui.viewerMode === "family"
              ? "Viewer (Family)"
              : "Read-only"
      : "My View";
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

  if (app.ui.activeSection === "consult") {
    dom.sections.consult.classList.remove("hidden");
    renderConsult(dom.sections.consult, visibleData, context);
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

function maxDateAcrossRows(rows, fields) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let maxValue = 0;
  for (const row of rows) {
    for (const field of fields) {
      const parsed = parseSortableDate(row?.[field]);
      if (parsed > maxValue) maxValue = parsed;
    }
  }
  return maxValue;
}

function derivedStateMemoKey(data) {
  if (!data || typeof data !== "object") return "empty";
  const medications = Array.isArray(data.medications) ? data.medications : [];
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const experiments = Array.isArray(data.medicationChangeExperiments) ? data.medicationChangeExperiments : [];
  const questions = Array.isArray(data.consultQuestions) ? data.consultQuestions : [];
  const decisions = Array.isArray(data.decisionLog) ? data.decisionLog : [];
  const sideEffectEvents = Array.isArray(data.sideEffectEvents) ? data.sideEffectEvents : [];
  const appointments = Array.isArray(data.appointmentEvents) ? data.appointmentEvents : [];
  const checkins = Array.isArray(data.checkins) ? data.checkins : [];
  const adherence = Array.isArray(data.adherence) ? data.adherence : [];
  const notes = Array.isArray(data.notes) ? data.notes : [];
  return [
    String(data.stateUpdatedAt || ""),
    medications.length,
    changes.length,
    experiments.length,
    questions.length,
    decisions.length,
    sideEffectEvents.length,
    appointments.length,
    checkins.length,
    adherence.length,
    notes.length,
    maxDateAcrossRows(medications, ["updatedAt", "createdAt", "startDate"]),
    maxDateAcrossRows(changes, ["createdAt", "date", "dateEffective"]),
    maxDateAcrossRows(experiments, ["updatedAt", "createdAt", "dateEffective"]),
    maxDateAcrossRows(questions, ["createdAt", "discussedAt"]),
    maxDateAcrossRows(decisions, ["updatedAt", "createdAt", "appointmentDate"]),
    maxDateAcrossRows(sideEffectEvents, ["createdAt", "date"]),
    maxDateAcrossRows(appointments, ["createdAt", "appointmentDate"]),
    maxDateAcrossRows(checkins, ["updatedAt", "createdAt", "date"]),
    maxDateAcrossRows(adherence, ["updatedAt", "createdAt", "actionAt", "date"]),
    maxDateAcrossRows(notes, ["createdAt", "date"])
  ].join("|");
}

function resolveCurrentMedications(data) {
  const memoKey = `${derivedStateMemoKey(data)}|current_meds`;
  if (app.derivedMemo.currentMedsKey === memoKey) {
    return app.derivedMemo.currentMedsValue;
  }

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

  const sortedResolved = resolved.sort((a, b) => {
    if (Number(b.isCurrent) !== Number(a.isCurrent)) return Number(b.isCurrent) - Number(a.isCurrent);
    if (Number(b.isTargetMedication) !== Number(a.isTargetMedication)) return Number(b.isTargetMedication) - Number(a.isTargetMedication);
    return (a.name || "").localeCompare(b.name || "");
  });
  app.derivedMemo.currentMedsKey = memoKey;
  app.derivedMemo.currentMedsValue = sortedResolved;
  return sortedResolved;
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
  const totalDays = Math.max(1, Number(days || 14));
  const referenceKey = getLocalDateKey(referenceDate);
  const memoKey = `${derivedStateMemoKey(data)}|risk_history|${totalDays}|${referenceKey}`;
  if (app.derivedMemo.riskHistoryKey === memoKey) {
    return app.derivedMemo.riskHistoryValue;
  }

  const timeline = [];
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
  app.derivedMemo.riskHistoryKey = memoKey;
  app.derivedMemo.riskHistoryValue = timeline;
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
                  <button class="btn btn-secondary small ${isPending ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.TAKEN}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as taken" title="Taken: confirms this scheduled dose and saves the timestamp." ${isPending ? "disabled" : ""}>${isPending ? "Saving" : "Taken"}</button>
                  <button class="btn btn-secondary small ${isPending ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.SKIPPED}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as skipped" title="Skip: records this scheduled dose as not taken." ${isPending ? "disabled" : ""}>${isPending ? "Saving" : "Skip"}</button>
                  <button class="btn btn-ghost small" type="button" data-dose-snooze="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" aria-label="Snooze ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)}" title="Snooze: delays this reminder by ${DOSE_SNOOZE_MINUTES} minutes." ${isPending ? "disabled" : ""}>Snooze</button>
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

  const windowStart = windowed[0]?.date || getLocalDateKey(new Date());
  const windowEnd = windowed[windowed.length - 1]?.date || windowStart;
  const quality = buildDataQualityIndicators(
    {
      ...data,
      checkins: windowed,
      adherence: (data.adherence || []).filter((entry) => entry.date >= windowStart && entry.date <= windowEnd),
      notes: (data.notes || []).filter((entry) => entry.date >= windowStart && entry.date <= windowEnd),
      sideEffectEvents: (data.sideEffectEvents || []).filter((entry) => {
        const key = String(entry.date || entry.createdAt || "").slice(0, 10);
        return key >= windowStart && key <= windowEnd;
      })
    },
    {
      startDate: windowStart,
      endDate: windowEnd
    }
  );

  if (app.ui.dashboardTrendView === "simple") {
    const moodAvg = average(windowed.map((entry) => toNumber(entry.mood)));
    const anxietyAvg = average(windowed.map((entry) => toNumber(entry.anxiety)));
    const focusAvg = average(windowed.map((entry) => toNumber(entry.focus)));
    const sleepAvg = average(windowed.map((entry) => toNumber(entry.sleepHours)));

    return `
      ${renderDataConfidenceBanner(quality, `${rangeDays}-day trends`)}
      <div class="dashboard-trend-simple">
        <div class="kpi-badge">Mood avg: ${Number.isFinite(moodAvg) ? roundNumber(moodAvg, 1) : "-"}</div>
        <div class="kpi-badge">Anxiety avg: ${Number.isFinite(anxietyAvg) ? roundNumber(anxietyAvg, 1) : "-"}</div>
        <div class="kpi-badge">Focus avg: ${Number.isFinite(focusAvg) ? roundNumber(focusAvg, 1) : "-"}</div>
        <div class="kpi-badge">Sleep avg: ${Number.isFinite(sleepAvg) ? roundNumber(sleepAvg, 1) : "-"}h</div>
      </div>
    `;
  }

  const changeDates = (recentChanges || []).map((change) => change.date).slice(0, 10);
  return `
    ${renderDataConfidenceBanner(quality, `${rangeDays}-day trends`)}
    ${renderLineChart(
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
  )}
  `;
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
  if (!app.ui.dashboardCollapsedPanels || typeof app.ui.dashboardCollapsedPanels !== "object") {
    app.ui.dashboardCollapsedPanels = {
      changes: false,
      medicationDetails: false,
      consultPrep: false,
      alerts: false
    };
  }
  app.ui.dashboardCollapsedPanels = {
    changes: false,
    medicationDetails: false,
    consultPrep: false,
    alerts: false,
    ...(app.ui.dashboardCollapsedPanels || {})
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
  const collapsedPanels = app.ui.dashboardCollapsedPanels;
  const isCollapsed = (panelKey) => Boolean(collapsedPanels?.[panelKey]);
  const collapseLabel = (panelKey) => (isCollapsed(panelKey) ? "Expand" : "Collapse");

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
  const recentExperiments = resolveExperimentRows(data)
    .filter((entry) => dateDiffDays(String(entry.dateEffective || "").slice(0, 10), today) <= 14)
    .sort((a, b) => parseSortableDate(b.dateEffective) - parseSortableDate(a.dateEffective));
  const latestChangeDate = recentChanges[0]?.date || recentExperiments[0]?.dateEffective || "";
  const daysSinceLastChange = latestChangeDate ? Math.max(0, dateDiffDays(latestChangeDate, today)) : null;

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
  const consultQuestions = sortConsultQuestions(data.consultQuestions || []);
  const openConsultQuestions = consultQuestions.filter((entry) => String(entry.status || "").toLowerCase() === "open");
  const consultFocusText = String(normalizeConsultConfig(data.consultConfig).discussToday || "").trim();
  const topConsultQuestions = openConsultQuestions.slice(0, 3);
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
  const showActionPlanCard = ownerEditable || riskLevelRank(riskAssessment.level) >= riskLevelRank("watch");

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
            <div class="summary-strip-label">${renderIcon("check", "mini-icon soft", "Adherence")}<span>Adherence today</span></div>
            <div class="summary-strip-value">${escapeHtml(`${adherencePct}%`)}</div>
            <div
              class="adherence-progress"
              role="progressbar"
              aria-label="Adherence today"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="${adherencePct}"
            >
              <span style="width:${Math.max(0, Math.min(100, adherencePct))}%"></span>
            </div>
            <div class="summary-strip-help">${escapeHtml(`${dueState.counts.taken} taken · ${dueState.counts.remaining} due · ${dueState.counts.missed} missed`)}</div>
          </article>
          <article class="summary-strip-item">
            <div class="summary-strip-label">${renderIcon("clock", "mini-icon soft", "Next dose")}<span>Next dose due</span></div>
            <div class="summary-strip-value">${escapeHtml(nextDose ? `${nextDose.medicationName} ${nextDose.time}` : "None remaining")}</div>
            <div class="summary-strip-help">${escapeHtml(`${overdueCount} overdue`)}</div>
          </article>
          <article class="summary-strip-item">
            <div class="summary-strip-label">${renderIcon("pulse", "mini-icon soft", "Risk status")}<span>Current status</span></div>
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
            <div class="summary-strip-label">${renderIcon("calendar", "mini-icon soft", "Last check-in")}<span>Last check-in</span></div>
            <div class="summary-strip-value">${escapeHtml(latestCheckinLabel)}</div>
            <div class="summary-strip-help">
              ${latestCheckin ? `Mood ${escapeHtml(String(latestCheckin.mood))} · Anxiety ${escapeHtml(String(latestCheckin.anxiety))}` : "Complete quick check-in to update."}
              ${daysSinceLastChange === null ? "" : ` · ${escapeHtml(`${daysSinceLastChange}d since last medication change`)}`}
            </div>
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
        <div class="subtle dose-action-help" style="margin: 8px 0 10px;">Actions update immediately. Taken confirms and timestamps, Skip logs not taken, Snooze delays reminders by ${DOSE_SNOOZE_MINUTES} minutes.</div>
        ${renderDashboardDoseQueue(dueState, context, activeMeds)}
      </article>

      <article class="card card-accent card-accent-teal card-quick-checkin">
        <div class="card-head-row">
          <div>
            <h3>Quick check-in</h3>
            <div class="subtle">${todayCheckin ? `Today’s check-in completed.${todayCheckin.entryMode === "quick_30s" ? " (30-second mode)" : ""}` : "No check-in recorded yet today."}</div>
          </div>
          ${ownerEditable ? `
            <div class="inline-row">
              <button class="btn btn-secondary small" type="button" data-dashboard-checkin="1">${todayCheckin ? "Update" : "Start"}</button>
              <button class="btn btn-ghost small" type="button" data-dashboard-checkin-fast="1">30-second mode</button>
            </div>
          ` : ""}
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
        ` : `<div class="empty">Complete your quick check-in to generate daily trend signals.${ownerEditable ? ` <button class="btn btn-secondary small" type="button" data-dashboard-checkin-fast="1">Use 30-second mode</button>` : ""}</div>`}
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
          <div class="inline-row">
            <button class="btn btn-ghost small" type="button" data-dashboard-collapse="alerts" aria-expanded="${isCollapsed("alerts") ? "false" : "true"}">${collapseLabel("alerts")}</button>
            ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="alerts">${app.ui.dashboardEdits.alerts ? "Editing" : "Edit"}</button>` : ""}
          </div>
        </div>
        ${isCollapsed("alerts")
          ? `<div class="subtle">Collapsed. Expand to review alerts and reminders.</div>`
          : ownerEditable && app.ui.dashboardEdits.alerts ? `
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
          <div class="inline-row">
            <button class="btn btn-ghost small" type="button" data-dashboard-collapse="changes" aria-expanded="${isCollapsed("changes") ? "false" : "true"}">${collapseLabel("changes")}</button>
            ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="changes">${app.ui.dashboardEdits.changes ? "Editing" : "Edit"}</button>` : ""}
          </div>
        </div>
        ${isCollapsed("changes")
          ? `<div class="subtle">Collapsed. Expand to review recent medication changes.</div>`
          : ownerEditable && app.ui.dashboardEdits.changes ? `
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
            <button class="btn btn-ghost small" type="button" data-dashboard-collapse="medicationDetails" aria-expanded="${isCollapsed("medicationDetails") ? "false" : "true"}">${collapseLabel("medicationDetails")}</button>
            ${ownerEditable ? `<button class="btn btn-ghost small" type="button" data-dashboard-edit="medications">${app.ui.dashboardEdits.medications ? "Editing" : "Edit"}</button>` : ""}
            <button class="btn btn-ghost small" type="button" data-dashboard-open-meds="1">Open full medications</button>
          </div>
        </div>
        ${isCollapsed("medicationDetails")
          ? `<div class="subtle">Collapsed. Expand to review current medication details.</div>`
          : activeMeds.length ? (
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

      <article class="card card-accent card-accent-teal card-consult-prep">
        <div class="card-head-row">
          <div>
            <h3>Consult prep / open questions</h3>
            <div class="subtle">Keep appointment priorities concise and review-ready.</div>
          </div>
          <div class="inline-row">
            <button class="btn btn-ghost small" type="button" data-dashboard-collapse="consultPrep" aria-expanded="${isCollapsed("consultPrep") ? "false" : "true"}">${collapseLabel("consultPrep")}</button>
            <span class="kpi-badge">${openConsultQuestions.length} open</span>
            <button class="btn btn-ghost small" type="button" data-dashboard-open-consult="1">Open consult</button>
          </div>
        </div>
        ${isCollapsed("consultPrep")
          ? `<div class="subtle">Collapsed. Expand to view consult questions and focus notes.</div>`
          : topConsultQuestions.length ? `
          <ul class="timeline-list">
            ${topConsultQuestions.map((entry) => `<li><strong>${escapeHtml(entry.text)}</strong><div class="subtle">${escapeHtml(entry.urgency)} urgency${entry.linkedMedication ? ` · ${escapeHtml(entry.linkedMedication)}` : ""}</div></li>`).join("")}
          </ul>
        ` : `<div class="empty">No open consult questions.${ownerEditable ? ` <button class="btn btn-secondary small" type="button" data-dashboard-new-question="1">Add question</button>` : ""}</div>`}
        ${isCollapsed("consultPrep") ? "" : `<div class="subtle" style="margin-top:8px;">${consultFocusText ? `Focus: ${escapeHtml(consultFocusText)}` : "No consult focus text set yet."}</div>`}
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

  root.querySelectorAll("[data-dashboard-collapse]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = String(button.dataset.dashboardCollapse || "").trim();
      if (!["changes", "medicationDetails", "consultPrep", "alerts"].includes(key)) return;
      app.ui.dashboardCollapsedPanels = {
        ...(app.ui.dashboardCollapsedPanels || {}),
        [key]: !Boolean(app.ui.dashboardCollapsedPanels?.[key])
      };
      persistUiDraftPreferences();
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
    app.ownerData.medicationChangeExperiments = (app.ownerData.medicationChangeExperiments || []).map((experiment) => {
      const linkedId = experiment.linkedChangeId || experiment.id;
      const updated = updates.get(linkedId);
      if (!updated) return experiment;
      return normalizeMedicationChangeExperiment({
        ...experiment,
        medicationId: updated.medicationId || experiment.medicationId,
        medicationName: updated.medicationName,
        dateEffective: updated.date,
        oldDose: updated.oldDose,
        newDose: updated.newDose,
        route: updated.route || "",
        changedBy: updated.changedBy || "self",
        reasonForChange: updated.reasonForChange || updated.reason || "",
        expectedBenefit: updated.expectedEffects || "",
        whatToMonitor: updated.monitorFor || "",
        reviewDate: updated.reviewDate || "",
        outcomeNotes: updated.notes || "",
        linkedChangeId: updated.id,
        updatedAt: isoDateTime(new Date())
      });
    });
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
      app.ui.checkinQuickMode = false;
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-checkin-fast]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "entry";
      app.ui.entryWorkflow = "checkin";
      app.ui.checkinQuickMode = true;
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

  root.querySelectorAll("[data-dashboard-open-consult]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToSection("consult", {
        preferredModes: ["clinical", "personal"],
        fallbackSections: ["timeline"]
      });
      renderAll();
    });
  });

  root.querySelectorAll("[data-dashboard-new-question]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      app.ui.activeSection = "consult";
      app.ui.consultActivePane = "questions";
      persistUiDraftPreferences();
      renderAll();
      window.setTimeout(() => {
        dom.sections.consult?.querySelector("#consultQuestionForm input[name='text']")?.focus();
      }, 0);
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
                  <button class="btn btn-secondary small ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.TAKEN}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as taken" title="Taken: confirms this scheduled dose and saves the timestamp." ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "disabled" : ""}>${app.ui.pendingDoseActions.has(item.occurrenceId) ? "Saving" : "Taken"}</button>
                  <button class="btn btn-secondary small ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "is-loading" : ""}" type="button" data-dose-action="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" data-dose-status="${ADHERENCE_STATUS.SKIPPED}" aria-label="Mark ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)} as skipped" title="Skip: records this scheduled dose as not taken." ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "disabled" : ""}>${app.ui.pendingDoseActions.has(item.occurrenceId) ? "Saving" : "Skip"}</button>
                  <details class="dose-actions-more">
                    <summary>More</summary>
                    <div class="inline-row">
                      <button class="btn btn-ghost small" type="button" data-dose-snooze="1" data-dose-occurrence-id="${escapeHtml(item.occurrenceId)}" aria-label="Snooze ${escapeHtml(item.medicationName)} dose at ${escapeHtml(item.time)}" title="Snooze: delays this reminder by ${DOSE_SNOOZE_MINUTES} minutes." ${app.ui.pendingDoseActions.has(item.occurrenceId) ? "disabled" : ""}>Snooze</button>
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
  const search = String(app.ui.medicationsFilterSearch || "").trim().toLowerCase();
  const statusFilter = ["all", "current", "historical"].includes(app.ui.medicationsFilterStatus)
    ? app.ui.medicationsFilterStatus
    : "all";
  const sortBy = ["name", "dose", "schedule", "start", "status"].includes(app.ui.medicationsSortBy)
    ? app.ui.medicationsSortBy
    : "name";
  const sortDir = app.ui.medicationsSortDir === "desc" ? "desc" : "asc";
  const sortFactor = sortDir === "desc" ? -1 : 1;

  const doseSortValue = (dose) => {
    const match = String(dose || "").match(/-?\d+(\.\d+)?/);
    const value = Number(match?.[0] || Number.NaN);
    return Number.isFinite(value) ? value : -Infinity;
  };

  const rows = [...current, ...historical]
    .filter((med) => {
      if (statusFilter === "current" && !med.isCurrent) return false;
      if (statusFilter === "historical" && med.isCurrent) return false;
      if (!search) return true;
      const haystack = [
        med.name,
        med.genericName,
        med.brandName,
        med.currentDose,
        med.route,
        formatSchedule(med),
        med.confirmationNotes
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(search);
    })
    .sort((left, right) => {
      let result = 0;
      if (sortBy === "dose") {
        result = doseSortValue(left.currentDose) - doseSortValue(right.currentDose);
      } else if (sortBy === "schedule") {
        result = formatSchedule(left).localeCompare(formatSchedule(right));
      } else if (sortBy === "start") {
        result = parseSortableDate(left.startDate) - parseSortableDate(right.startDate);
      } else if (sortBy === "status") {
        result = Number(right.isCurrent) - Number(left.isCurrent);
      } else {
        result = String(left.name || "").localeCompare(String(right.name || ""));
      }
      if (result === 0) {
        result = String(left.name || "").localeCompare(String(right.name || ""));
      }
      return result * sortFactor;
    });

  root.innerHTML = resolved.length
    ? `
      <div class="card" style="margin-bottom:12px;">
        <h3>Current medications (resolved from stored data)</h3>
        <div class="subtle">
          If multiple records conflict, this list shows the most recently updated active/current record while preserving all history.
        </div>
        <div class="subtle" style="margin-top:6px;"><strong>Last updated:</strong> ${escapeHtml(niceDate(currentMedsLastUpdated))}</div>
      </div>
      <div class="card table-controls-card" style="margin-bottom:12px;">
        <div class="field-grid table-controls-grid">
          <div>
            <label for="medicationsSearchInput">Search</label>
            <input id="medicationsSearchInput" type="search" value="${escapeHtml(app.ui.medicationsFilterSearch)}" placeholder="Medication, dose, route or note">
          </div>
          <div>
            <label for="medicationsStatusFilter">Status</label>
            <select id="medicationsStatusFilter">
              <option value="all" ${statusFilter === "all" ? "selected" : ""}>All</option>
              <option value="current" ${statusFilter === "current" ? "selected" : ""}>Current</option>
              <option value="historical" ${statusFilter === "historical" ? "selected" : ""}>Historical</option>
            </select>
          </div>
          <div>
            <label for="medicationsSortBy">Sort by</label>
            <select id="medicationsSortBy">
              <option value="name" ${sortBy === "name" ? "selected" : ""}>Name</option>
              <option value="dose" ${sortBy === "dose" ? "selected" : ""}>Dose</option>
              <option value="schedule" ${sortBy === "schedule" ? "selected" : ""}>Schedule</option>
              <option value="start" ${sortBy === "start" ? "selected" : ""}>Start date</option>
              <option value="status" ${sortBy === "status" ? "selected" : ""}>Status</option>
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <button class="btn btn-ghost" type="button" id="medicationsSortDirButton" aria-label="Toggle medication sort direction">${sortDir === "asc" ? "Ascending" : "Descending"}</button>
          </div>
        </div>
        <div class="subtle" style="margin-top:8px;">Showing ${rows.length} of ${resolved.length} medication rows.</div>
      </div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">Medication list with current and historical entries</caption>
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
            ${rows.map((med) => `
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
      ${rows.length ? "" : `<div class="empty" style="margin-top:12px;">No medications match this filter.</div>`}
      <div class="subtle" style="margin-top:8px;">Underlying medication records stored: ${recordCount}. Current list rows: ${current.length}.</div>
    `
    : `<div class="empty">No medications added yet.</div>`;

  root.querySelector("#medicationsSearchInput")?.addEventListener("input", (event) => {
    app.ui.medicationsFilterSearch = String(event.target.value || "");
    renderAll();
  });
  root.querySelector("#medicationsStatusFilter")?.addEventListener("change", (event) => {
    app.ui.medicationsFilterStatus = String(event.target.value || "all");
    renderAll();
  });
  root.querySelector("#medicationsSortBy")?.addEventListener("change", (event) => {
    app.ui.medicationsSortBy = String(event.target.value || "name");
    renderAll();
  });
  root.querySelector("#medicationsSortDirButton")?.addEventListener("click", () => {
    app.ui.medicationsSortDir = app.ui.medicationsSortDir === "asc" ? "desc" : "asc";
    renderAll();
  });

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
  if (dom.closeMedicationModal) {
    dom.closeMedicationModal.hidden = false;
  }

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
  if (!dom.medicationModal) return;
  dom.medicationModal.classList.add("hidden");
  dom.medicationModal.setAttribute("aria-hidden", "true");
  dom.medicationModalBody.innerHTML = "";
  if (dom.closeMedicationModal) {
    dom.closeMedicationModal.hidden = true;
  }
}

function renderChanges(root, data, context) {
  const search = String(app.ui.changesFilterSearch || "").trim().toLowerCase();
  const medicationFilter = String(app.ui.changesFilterMedication || "all");
  const sortBy = ["date_desc", "date_asc", "medication", "reason"].includes(app.ui.changesSortBy)
    ? app.ui.changesSortBy
    : "date_desc";

  const medicationOptions = Array.from(
    new Set(
      (data.changes || [])
        .map((row) => String(row.medicationName || "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  const rows = data.changes
    .slice()
    .filter((row) => {
      if (medicationFilter !== "all" && String(row.medicationName || "") !== medicationFilter) return false;
      if (!search) return true;
      const haystack = [
        row.medicationName,
        row.oldDose,
        row.newDose,
        row.reasonForChange,
        row.reason,
        row.monitorFor,
        row.expectedEffects,
        row.notes
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return haystack.includes(search);
    })
    .sort((left, right) => {
      if (sortBy === "date_asc") return String(left.date || "").localeCompare(String(right.date || ""));
      if (sortBy === "medication") return String(left.medicationName || "").localeCompare(String(right.medicationName || ""));
      if (sortBy === "reason") return String(left.reasonForChange || left.reason || "").localeCompare(String(right.reasonForChange || right.reason || ""));
      return String(right.date || "").localeCompare(String(left.date || ""));
    });

  if (!data.changes.length) {
    root.innerHTML = `<div class="empty">No medication changes logged yet.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <h3>Recent medication changes summary</h3>
      ${renderRecentMedicationSummary()}
    </div>
    <div class="card table-controls-card" style="margin-bottom:12px;">
      <div class="field-grid table-controls-grid">
        <div>
          <label for="changesSearchInput">Search</label>
          <input id="changesSearchInput" type="search" value="${escapeHtml(app.ui.changesFilterSearch)}" placeholder="Medication, dose, reason or notes">
        </div>
        <div>
          <label for="changesMedicationFilter">Medication</label>
          <select id="changesMedicationFilter">
            <option value="all">All medications</option>
            ${medicationOptions.map((name) => `<option value="${escapeHtml(name)}" ${medicationFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label for="changesSortBy">Sort by</label>
          <select id="changesSortBy">
            <option value="date_desc" ${sortBy === "date_desc" ? "selected" : ""}>Newest first</option>
            <option value="date_asc" ${sortBy === "date_asc" ? "selected" : ""}>Oldest first</option>
            <option value="medication" ${sortBy === "medication" ? "selected" : ""}>Medication</option>
            <option value="reason" ${sortBy === "reason" ? "selected" : ""}>Reason</option>
          </select>
        </div>
      </div>
      <div class="subtle" style="margin-top:8px;">Showing ${rows.length} of ${data.changes.length} changes.</div>
    </div>
    ${rows.length ? "" : `<div class="empty" style="margin-bottom:12px;">No medication changes match this filter.</div>`}
    <div class="table-wrap">
      <table>
        <caption class="sr-only">Medication change history</caption>
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

  root.querySelector("#changesSearchInput")?.addEventListener("input", (event) => {
    app.ui.changesFilterSearch = String(event.target.value || "");
    renderAll();
  });
  root.querySelector("#changesMedicationFilter")?.addEventListener("change", (event) => {
    app.ui.changesFilterMedication = String(event.target.value || "all");
    renderAll();
  });
  root.querySelector("#changesSortBy")?.addEventListener("change", (event) => {
    app.ui.changesSortBy = String(event.target.value || "date_desc");
    renderAll();
  });

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
          <span class="kpi-badge">Function ${todayCheckin.functionScore ?? "-"}/5</span>
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
            <th>Function score</th>
            <th>Social contact</th>
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
              <td>${escapeHtml(String(row.functionScore ?? "-"))}</td>
              <td>${escapeHtml(String(row.socialContactLevel || "-"))}</td>
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
      app.ui.checkinQuickMode = false;
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

function resolveExperimentRows(data) {
  const experiments = Array.isArray(data.medicationChangeExperiments) ? data.medicationChangeExperiments : [];
  if (experiments.length) {
    return experiments
      .map((entry) => normalizeMedicationChangeExperiment(entry))
      .sort((a, b) => parseSortableDate(b.dateEffective) - parseSortableDate(a.dateEffective));
  }
  return (data.changes || [])
    .map((change) => convertChangeToExperiment(change))
    .sort((a, b) => parseSortableDate(b.dateEffective) - parseSortableDate(a.dateEffective));
}

function inDateRangeKey(value, startDate, endDate) {
  const key = String(value || "").slice(0, 10);
  if (!key) return false;
  if (startDate && key < startDate) return false;
  if (endDate && key > endDate) return false;
  return true;
}

function resolveConsultWindow(data, filters) {
  const today = getLocalDateKey(new Date());
  const range = String(filters?.range || "since_last_appointment");
  if (range === "since_last_change") {
    const latestChange = resolveExperimentRows(data)[0];
    const startDate = latestChange?.dateEffective?.slice(0, 10) || shiftDateKey(today, -14);
    return {
      startDate,
      endDate: today,
      label: `Since last medication change (${niceDate(startDate)})`
    };
  }

  if (range === "last_days") {
    const days = CONSULT_RANGE_OPTIONS.includes(String(filters?.customRangeDays || "14"))
      ? Number(filters.customRangeDays)
      : 14;
    const startDate = shiftDateKey(today, -(days - 1));
    return {
      startDate,
      endDate: today,
      label: `Last ${days} days`
    };
  }

  const latestAppointment = (data.appointmentEvents || [])
    .slice()
    .sort((a, b) => parseSortableDate(b.appointmentDate) - parseSortableDate(a.appointmentDate))[0];
  const fallbackStart = shiftDateKey(today, -30);
  const startDate = latestAppointment?.appointmentDate?.slice(0, 10) || fallbackStart;
  return {
    startDate,
    endDate: today,
    label: latestAppointment
      ? `Since last appointment (${niceDate(startDate)})`
      : `Since last appointment (none logged, using ${niceDate(startDate)})`
  };
}

function summarizeConsultShift(checkins = []) {
  if (!Array.isArray(checkins) || checkins.length < 4) {
    return {
      summary: "Not enough check-in data yet to identify before/after directional shifts.",
      details: []
    };
  }
  const sorted = checkins.slice().sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const before = sorted.slice(0, mid);
  const after = sorted.slice(mid);
  const compareMetric = (label, key, direction = "higher") => {
    const beforeAvg = average(before.map((row) => toNumber(row[key])));
    const afterAvg = average(after.map((row) => toNumber(row[key])));
    if (!Number.isFinite(beforeAvg) || !Number.isFinite(afterAvg)) return null;
    const delta = roundNumber(afterAvg - beforeAvg, 2);
    if (Math.abs(delta) < 0.2) return `${label} stable`;
    if (direction === "higher") {
      return delta > 0 ? `${label} improved` : `${label} worsened`;
    }
    return delta < 0 ? `${label} improved` : `${label} worsened`;
  };
  const details = [
    compareMetric("Mood", "mood", "higher"),
    compareMetric("Anxiety", "anxiety", "lower"),
    compareMetric("Focus", "focus", "higher"),
    compareMetric("Sleep", "sleepHours", "higher")
  ].filter(Boolean);
  return {
    summary: details.length
      ? `Observed shifts: ${details.join(", ")}.`
      : "Observed shifts: no clear directional trend.",
    details
  };
}

function sideEffectTimingBucket(event) {
  const onset = Number(event?.onsetAfterDoseMinutes);
  if (Number.isFinite(onset) && onset >= 0) {
    if (onset <= 90) return "~1h after dose";
    if (onset <= 240) return "1-4h after dose";
    return "4h+ after dose";
  }
  const timeOfDay = String(event?.timeOfDay || "").toLowerCase();
  if (["morning", "afternoon", "evening", "night"].includes(timeOfDay)) {
    return timeOfDay;
  }
  return "timing not specified";
}

function summarizeSideEffects(events = []) {
  const grouped = new Map();
  for (const event of events) {
    const med = String(event.linkedMedication || "Unlinked").trim() || "Unlinked";
    const bucket = sideEffectTimingBucket(event);
    const key = `${med}||${bucket}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        medication: med,
        timing: bucket,
        count: 0,
        severityTotal: 0,
        symptoms: new Map()
      });
    }
    const row = grouped.get(key);
    row.count += 1;
    row.severityTotal += Number(event.severity || 0);
    const symptom = String(event.symptomName || "unspecified").trim() || "unspecified";
    row.symptoms.set(symptom, (row.symptoms.get(symptom) || 0) + 1);
  }
  return Array.from(grouped.values())
    .map((row) => {
      const topSymptom = Array.from(row.symptoms.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
      return {
        medication: row.medication,
        timing: row.timing,
        count: row.count,
        avgSeverity: row.count ? roundNumber(row.severityTotal / row.count, 1) : 0,
        topSymptom
      };
    })
    .sort((a, b) => b.count - a.count);
}

function questionUrgencyRank(value) {
  const key = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CONSULT_QUESTION_URGENCY_RANK, key)) {
    return CONSULT_QUESTION_URGENCY_RANK[key];
  }
  return CONSULT_QUESTION_URGENCY_RANK.medium;
}

function questionStatusRank(value) {
  const key = String(value || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CONSULT_QUESTION_STATUS_RANK, key)) {
    return CONSULT_QUESTION_STATUS_RANK[key];
  }
  return CONSULT_QUESTION_STATUS_RANK.open;
}

function sortConsultQuestions(rows = []) {
  return rows
    .map((entry) => normalizeConsultQuestion(entry))
    .sort((left, right) => {
      const statusDiff = questionStatusRank(left.status) - questionStatusRank(right.status);
      if (statusDiff !== 0) return statusDiff;
      const urgencyDiff = questionUrgencyRank(left.urgency) - questionUrgencyRank(right.urgency);
      if (urgencyDiff !== 0) return urgencyDiff;
      return parseSortableDate(right.createdAt) - parseSortableDate(left.createdAt);
    });
}

function experimentLabelForSummary(entry) {
  if (!entry) return "";
  const medication = String(entry.medicationName || "Medication").trim();
  const doseShift = `${String(entry.oldDose || "-").trim()} -> ${String(entry.newDose || "-").trim()}`;
  return `${medication} (${doseShift})`;
}

function resolveLinkedExperimentLabel(experimentMap, decisionEntry) {
  const linkedId = String(decisionEntry?.linkedExperimentId || "");
  if (!linkedId) return "";
  const linked = experimentMap.get(linkedId);
  if (!linked) return "Linked change not found";
  return experimentLabelForSummary(linked);
}

function buildConsultClipboardSummary({
  windowLabel,
  meds = [],
  experiments = [],
  sideEffectSummary = [],
  adherencePct = null,
  takenCount = 0,
  skippedCount = 0,
  questions = [],
  decisions = [],
  focusText = ""
}) {
  const lines = [];
  lines.push("Medication Tracker - Consult Summary");
  lines.push(`Window: ${windowLabel}`);
  lines.push("");
  lines.push("Current medications");
  if (meds.length) {
    meds.forEach((med) => {
      lines.push(`- ${med.name}: ${med.currentDose || "-"} (${formatSchedule(med)})`);
    });
  } else {
    lines.push("- None recorded");
  }
  lines.push("");
  lines.push("Changes in selected window");
  if (experiments.length) {
    experiments.slice(0, 10).forEach((entry) => {
      lines.push(`- ${niceDate(entry.dateEffective)}: ${experimentLabelForSummary(entry)} · ${entry.reasonForChange || "-"}`);
    });
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("Adherence");
  lines.push(`- Taken: ${takenCount}`);
  lines.push(`- Skipped: ${skippedCount}`);
  lines.push(`- Logged adherence: ${adherencePct === null ? "-" : `${adherencePct}%`}`);
  lines.push("");
  lines.push("Side effects (top patterns)");
  if (sideEffectSummary.length) {
    sideEffectSummary.slice(0, 6).forEach((row) => {
      lines.push(`- ${row.medication} · ${row.timing}: ${row.count} events, avg severity ${row.avgSeverity}`);
    });
  } else {
    lines.push("- None in selected window");
  }
  lines.push("");
  lines.push("Open consult questions");
  const openQuestions = questions.filter((entry) => String(entry.status || "").toLowerCase() === "open");
  if (openQuestions.length) {
    openQuestions.slice(0, 10).forEach((entry) => {
      lines.push(`- [${entry.urgency}] ${entry.text}`);
    });
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("Latest decision");
  if (decisions.length) {
    const latest = decisions[0];
    lines.push(`- ${niceDate(latest.appointmentDate)}${latest.clinicianName ? ` · ${latest.clinicianName}` : ""}`);
    lines.push(`- ${latest.planUntilNextReview || latest.notes || "-"}`);
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("What I want to discuss today");
  lines.push(focusText || "-");
  return lines.join("\n");
}

function buildAppointmentPackSummary(data) {
  const snapshot = buildRangeSnapshot(data, "14");
  const sideEffectSummary = summarizeSideEffects(snapshot.sideEffectEvents || []);
  const openQuestions = (snapshot.consultQuestions || [])
    .map((entry) => normalizeConsultQuestion(entry))
    .filter((entry) => String(entry.status || "").toLowerCase() === "open")
    .slice(0, 12);
  const riskAssessment = computeRiskAssessment({
    now: new Date(),
    checkins: snapshot.checkins,
    notes: snapshot.notes,
    adherence: snapshot.adherence,
    dueState: null,
    warningSigns: data.warningSigns,
    riskConfig: data.riskConfig
  });

  const meds = resolveCurrentMedications(snapshot).filter((med) => med.isCurrent);
  const experiments = resolveExperimentRows(snapshot).slice(0, 12);
  const takenCount = snapshot.adherence.filter((entry) => normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.TAKEN).length;
  const skippedCount = snapshot.adherence.filter((entry) => normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.SKIPPED).length;
  const adherencePct = takenCount + skippedCount
    ? roundNumber((takenCount / (takenCount + skippedCount)) * 100, 1)
    : null;

  const lines = [];
  lines.push("Appointment Pack (14 days)");
  lines.push(`Window: ${niceDate(snapshot.startDate)} to ${niceDate(snapshot.endDate)}`);
  lines.push(`Risk: ${riskAssessment.label} (${riskAssessment.reasons[0] || "No active triggers."})`);
  lines.push("");
  lines.push("Current medications");
  if (meds.length) {
    meds.forEach((med) => {
      lines.push(`- ${med.name}: ${med.currentDose || "-"} (${formatSchedule(med)})`);
    });
  } else {
    lines.push("- None recorded");
  }
  lines.push("");
  lines.push("Recent medication changes");
  if (experiments.length) {
    experiments.forEach((entry) => {
      lines.push(`- ${niceDate(entry.dateEffective)} · ${experimentLabelForSummary(entry)} · ${entry.reasonForChange || "-"}`);
    });
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("Adherence");
  lines.push(`- Taken: ${takenCount}`);
  lines.push(`- Skipped: ${skippedCount}`);
  lines.push(`- Logged adherence: ${adherencePct === null ? "-" : `${adherencePct}%`}`);
  lines.push("");
  lines.push("Open questions for consult");
  if (openQuestions.length) {
    openQuestions.forEach((entry) => {
      lines.push(`- [${entry.urgency}] ${entry.text}`);
    });
  } else {
    lines.push("- None");
  }
  lines.push("");
  lines.push("Side effects (top patterns)");
  if (sideEffectSummary.length) {
    sideEffectSummary.slice(0, 6).forEach((row) => {
      lines.push(`- ${row.medication} · ${row.timing}: ${row.count} events, avg severity ${row.avgSeverity}`);
    });
  } else {
    lines.push("- None in selected window");
  }
  lines.push("");
  lines.push("Discuss with prescriber: this summary highlights observed patterns, not causality.");
  return lines.join("\n");
}

function renderConsult(root, data, context) {
  const ownerEditable = context.type === "owner" && !context.readOnly;
  const meds = resolveCurrentMedications(data).filter((med) => med.isCurrent);
  const medicationOptions = meds.map((med) => ({ id: med.id, name: med.name }));
  const allExperiments = resolveExperimentRows(data);
  const allExperimentsById = new Map(allExperiments.map((entry) => [entry.id, entry]));
  const consultConfig = normalizeConsultConfig(context.readOnly ? data.consultConfig : app.ownerData.consultConfig);
  const filters = {
    ...consultConfig.activeFilters,
    ...(app.ui.consultFilters || {})
  };
  app.ui.consultFilters = filters;
  const consultPaneOptions = ["current", "changes", "trends", "effects", "questions", "plan"];
  if (!consultPaneOptions.includes(app.ui.consultActivePane)) {
    app.ui.consultActivePane = "current";
  }
  const activeConsultPane = app.ui.consultActivePane;
  const paneClass = (paneId) => (activeConsultPane === paneId ? "" : "consult-pane-hidden");
  const windowRange = resolveConsultWindow(data, filters);
  const experiments = allExperiments.filter((entry) => {
    if (!inDateRangeKey(entry.dateEffective, windowRange.startDate, windowRange.endDate)) return false;
    if (filters.medicationId && filters.medicationId !== "all") {
      if (entry.medicationId === filters.medicationId) return true;
      const med = data.medications.find((item) => item.id === filters.medicationId);
      return normalizeMedicationKey(entry.medicationName) === normalizeMedicationKey(med?.name || "");
    }
    return true;
  });
  const experimentComparisons = new Map(
    experiments.map((entry) => [
      entry.id,
      computeBeforeAfterComparison(data, entry.dateEffective, { beforeDays: 7, afterDays: 7 })
    ])
  );

  const checkins = (data.checkins || []).filter((row) => inDateRangeKey(row.date, windowRange.startDate, windowRange.endDate));
  const notes = (data.notes || []).filter((row) => inDateRangeKey(row.date, windowRange.startDate, windowRange.endDate));
  const sideEffectEvents = (data.sideEffectEvents || []).filter((row) => inDateRangeKey(row.date || row.createdAt, windowRange.startDate, windowRange.endDate));
  const adherence = (data.adherence || []).filter((row) => inDateRangeKey(row.date, windowRange.startDate, windowRange.endDate));
  const appointments = (data.appointmentEvents || [])
    .map((entry) => normalizeAppointmentEvent(entry))
    .slice()
    .sort((a, b) => parseSortableDate(b.appointmentDate) - parseSortableDate(a.appointmentDate));
  const decisions = (data.decisionLog || [])
    .map((entry) => normalizeDecisionLogEntry(entry))
    .slice()
    .sort((a, b) => parseSortableDate(b.appointmentDate) - parseSortableDate(a.appointmentDate))
    .filter((entry) => inDateRangeKey(entry.appointmentDate, windowRange.startDate, windowRange.endDate));
  const questions = sortConsultQuestions(data.consultQuestions || [])
    .filter((entry) => (filters.openQuestionsOnly ? String(entry.status || "").toLowerCase() === "open" : true));

  const takenCount = adherence.filter((entry) => normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.TAKEN).length;
  const skippedCount = adherence.filter((entry) => normalizeAdherenceStatus(entry.status) === ADHERENCE_STATUS.SKIPPED).length;
  const adherencePct = takenCount + skippedCount
    ? roundNumber((takenCount / (takenCount + skippedCount)) * 100, 1)
    : null;

  const sideEffectSummary = summarizeSideEffects(sideEffectEvents);
  const shiftSummary = summarizeConsultShift(checkins);
  const checkinsSorted = checkins.slice().sort((left, right) => left.date.localeCompare(right.date));
  const consultTrendChart = checkinsSorted.length >= 2
    ? renderLineChart(
        [
          {
            label: "Mood",
            color: CHART_COLORS.mood,
            points: checkinsSorted.map((entry) => ({ date: entry.date, value: toNumber(entry.mood) }))
          },
          {
            label: "Anxiety",
            color: CHART_COLORS.anxiety,
            points: checkinsSorted.map((entry) => ({ date: entry.date, value: toNumber(entry.anxiety) }))
          },
          {
            label: "Focus",
            color: CHART_COLORS.focus,
            points: checkinsSorted.map((entry) => ({ date: entry.date, value: toNumber(entry.focus) }))
          },
          {
            label: "Sleep",
            color: CHART_COLORS.sleep,
            points: checkinsSorted.map((entry) => ({ date: entry.date, value: toNumber(entry.sleepHours) }))
          }
        ],
        {
          yMin: 0,
          yMax: 10,
          changeDates: experiments.map((entry) => String(entry.dateEffective || "").slice(0, 10))
        }
      )
    : "";
  const quality = buildDataQualityIndicators(
    {
      ...data,
      medicationChangeExperiments: experiments,
      sideEffectEvents
    },
    {
      startDate: windowRange.startDate,
      endDate: windowRange.endDate
    }
  );
  const confidenceBanner = renderDataConfidenceBanner(quality, "consult window");

  const focusText = String(consultConfig.discussToday || "").trim();
  const latestDecision = decisions[0] || null;
  const editingExperiment = ownerEditable
    ? (app.ownerData.medicationChangeExperiments || []).find((entry) => entry.id === app.ui.consultEditingExperimentId) || null
    : null;
  const editingQuestion = ownerEditable
    ? (app.ownerData.consultQuestions || []).find((entry) => entry.id === app.ui.consultEditingQuestionId) || null
    : null;
  const editingDecision = ownerEditable
    ? (app.ownerData.decisionLog || []).find((entry) => entry.id === app.ui.consultEditingDecisionId) || null
    : null;
  const editingAppointment = ownerEditable
    ? (app.ownerData.appointmentEvents || []).find((entry) => entry.id === app.ui.consultEditingAppointmentId) || null
    : null;
  const clipboardSummary = buildConsultClipboardSummary({
    windowLabel: windowRange.label,
    meds,
    experiments,
    sideEffectSummary,
    adherencePct,
    takenCount,
    skippedCount,
    questions,
    decisions,
    focusText
  });
  const appointmentPackSummary = buildAppointmentPackSummary(data);

  root.innerHTML = `
    <article class="card consult-toolbar">
      <div class="card-head-row">
        <div>
          <h3>Consult Summary</h3>
          <div class="subtle">${escapeHtml(windowRange.label)} · Appointment-ready, print-friendly review.</div>
        </div>
        <div class="inline-row">
          <button class="btn btn-primary small" type="button" data-consult-pack="1">Appointment Pack (14d)</button>
          <button class="btn btn-secondary small" type="button" data-consult-copy="1">Copy summary</button>
          <button class="btn btn-secondary small" type="button" data-consult-print="1">Print / Save PDF</button>
        </div>
      </div>
      <div class="field-grid consult-filter-grid">
        <div>
          <label for="consultRangeFilter">Range</label>
          <select id="consultRangeFilter">
            <option value="since_last_appointment" ${filters.range === "since_last_appointment" ? "selected" : ""}>Since last appointment</option>
            <option value="since_last_change" ${filters.range === "since_last_change" ? "selected" : ""}>Since last medication change</option>
            <option value="last_days" ${filters.range === "last_days" ? "selected" : ""}>Last N days</option>
          </select>
        </div>
        <div>
          <label for="consultRangeDays">N days</label>
          <select id="consultRangeDays" ${filters.range === "last_days" ? "" : "disabled"}>
            ${CONSULT_RANGE_OPTIONS.map((days) => `<option value="${days}" ${String(filters.customRangeDays) === days ? "selected" : ""}>${days} days</option>`).join("")}
          </select>
        </div>
        <div>
          <label for="consultMedicationFilter">Medication</label>
          <select id="consultMedicationFilter">
            <option value="all">All medications</option>
            ${medicationOptions.map((med) => `<option value="${med.id}" ${filters.medicationId === med.id ? "selected" : ""}>${escapeHtml(med.name)}</option>`).join("")}
          </select>
        </div>
        <div class="consult-open-only-toggle">
          <label class="check-item">
            <input id="consultOpenOnly" type="checkbox" ${filters.openQuestionsOnly ? "checked" : ""}>
            <span>Open questions only</span>
          </label>
        </div>
      </div>
    </article>

    <article class="card consult-quicknav">
      <div class="inline-row">
        <button class="chip ${activeConsultPane === "current" ? "active" : ""}" type="button" data-consult-pane="current">Current meds</button>
        <button class="chip ${activeConsultPane === "changes" ? "active" : ""}" type="button" data-consult-pane="changes">Changes</button>
        <button class="chip ${activeConsultPane === "trends" ? "active" : ""}" type="button" data-consult-pane="trends">Trends</button>
        <button class="chip ${activeConsultPane === "effects" ? "active" : ""}" type="button" data-consult-pane="effects">Side effects</button>
        <button class="chip ${activeConsultPane === "questions" ? "active" : ""}" type="button" data-consult-pane="questions">Questions</button>
        <button class="chip ${activeConsultPane === "plan" ? "active" : ""}" type="button" data-consult-pane="plan">Plan</button>
      </div>
    </article>

    <div class="consult-grid">
      ${confidenceBanner}
      <article class="card consult-section consult-kpi-overview consult-section-full" id="consult-snapshot">
        <h3>Consult snapshot</h3>
        <div class="summary-strip-grid consult-summary-strip">
          <div class="summary-strip-item">
            <div class="summary-strip-label">Current medications</div>
            <div class="summary-strip-value">${meds.length}</div>
          </div>
          <div class="summary-strip-item">
            <div class="summary-strip-label">Changes in range</div>
            <div class="summary-strip-value">${experiments.length}</div>
          </div>
          <div class="summary-strip-item">
            <div class="summary-strip-label">Open questions</div>
            <div class="summary-strip-value">${questions.filter((entry) => String(entry.status || "").toLowerCase() === "open").length}</div>
          </div>
          <div class="summary-strip-item">
            <div class="summary-strip-label">Logged adherence</div>
            <div class="summary-strip-value">${adherencePct === null ? "-" : `${adherencePct}%`}</div>
          </div>
        </div>
      </article>
      <article class="card consult-section consult-section-main consult-pane ${paneClass("current")}" id="consult-current">
        <h3>Current medications</h3>
        ${meds.length ? `
          <div class="consult-table-only table-wrap">
            <table>
              <caption class="sr-only">Current medication list</caption>
              <thead>
                <tr>
                  <th>Medication</th>
                  <th>Dose</th>
                  <th>Schedule</th>
                  <th>Route</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${meds.map((med) => `
                  <tr>
                    <td><span class="table-wrap-text">${escapeHtml(med.name)}</span></td>
                    <td><span class="table-wrap-text">${escapeHtml(med.currentDose || "-")}</span></td>
                    <td><span class="table-wrap-text">${escapeHtml(formatSchedule(med))}</span></td>
                    <td><span class="table-wrap-text">${escapeHtml(med.route || "-")}</span></td>
                    <td><span class="pill-badge ${med.active ? "status-open" : "status-discussed"}">${escapeHtml(med.active ? "Active" : "Inactive")}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <ul class="timeline-list consult-list consult-med-list consult-cards-only">
            ${meds.map((med) => `
              <li>
                <div class="inline-row consult-med-head">
                  <strong>${escapeHtml(med.name)}</strong>
                  <span class="pill-badge ${med.active ? "status-open" : "status-discussed"}">${escapeHtml(med.active ? "Active" : "Inactive")}</span>
                </div>
                <div class="subtle">Dose: ${escapeHtml(med.currentDose || "-")}</div>
                <div class="subtle">Schedule: ${escapeHtml(formatSchedule(med))}</div>
                <div class="subtle">Route: ${escapeHtml(med.route || "-")}</div>
              </li>
            `).join("")}
          </ul>
        ` : `<div class="empty">No active medications recorded.</div>`}
      </article>

      <article class="card consult-section consult-section-main consult-pane ${paneClass("changes")}" id="consult-changes">
        <h3>Medication changes</h3>
        ${experiments.length ? `
          <div class="consult-table-only table-wrap">
            <table>
              <caption class="sr-only">Medication changes in selected consult window</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Medication</th>
                  <th>Old -> New</th>
                  <th>Reason</th>
                  <th>Observed pattern</th>
                </tr>
              </thead>
              <tbody>
                ${experiments.map((entry) => {
                  const comparison = experimentComparisons.get(entry.id);
                  return `
                    <tr>
                      <td><span class="table-wrap-text">${escapeHtml(niceDate(entry.dateEffective))}</span></td>
                      <td><span class="table-wrap-text">${escapeHtml(entry.medicationName || "Medication")}</span></td>
                      <td><span class="table-wrap-text">${escapeHtml(entry.oldDose || "-")} -> ${escapeHtml(entry.newDose || "-")}</span></td>
                      <td><span class="table-wrap-text">${escapeHtml(entry.reasonForChange || "-")}</span></td>
                      <td><span class="table-wrap-text">${escapeHtml(comparison?.summary || "Observed pattern not available.")}</span></td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
          <ul class="timeline-list consult-list consult-entry-list consult-cards-only">
            ${experiments.map((entry) => {
              const comparison = experimentComparisons.get(entry.id);
              return `
                <li class="consult-entry">
                  <div class="consult-entry-head">
                    <strong>${escapeHtml(entry.medicationName || "Medication")}</strong>
                    <span class="pill-badge status-open">${escapeHtml(entry.oldDose || "-")} -> ${escapeHtml(entry.newDose || "-")}</span>
                  </div>
                  <div class="consult-entry-meta">
                    <span>${escapeHtml(niceDate(entry.dateEffective))}</span>
                    <span>Changed by ${escapeHtml(entry.changedBy || "self")}</span>
                    ${entry.reviewDate ? `<span>Review ${escapeHtml(niceDate(entry.reviewDate))}</span>` : ""}
                  </div>
                  <div class="subtle"><strong>Reason:</strong> ${escapeHtml(entry.reasonForChange || "-")}</div>
                  <div class="subtle"><strong>Observed:</strong> ${escapeHtml(comparison?.summary || "Observed pattern not available.")}</div>
                  ${comparison?.dataQuality?.note ? `<div class="subtle">Data quality: ${escapeHtml(comparison.dataQuality.note)}</div>` : ""}
                  ${ownerEditable ? `
                    <div class="inline-row" style="margin-top:6px;">
                      <button class="btn btn-ghost small" type="button" data-edit-experiment="${entry.id}">Edit</button>
                      <button class="btn btn-ghost small" type="button" data-delete-experiment="${entry.id}">Delete</button>
                    </div>
                  ` : ""}
                </li>
              `;
            }).join("")}
          </ul>
        ` : `<div class="empty">No medication changes in this window.</div>`}
      </article>

      <article class="card consult-section consult-section-main consult-pane ${paneClass("trends")}" id="consult-trends">
        <h3>What improved / worsened</h3>
        ${renderDataConfidenceBanner(quality, "trend interpretation")}
        <div class="subtle">${escapeHtml(shiftSummary.summary)}</div>
        <div class="inline-row" style="margin-top:10px;">
          <span class="kpi-badge">Check-ins: ${checkins.length}</span>
          <span class="kpi-badge">Notes: ${notes.length}</span>
          <span class="kpi-badge">Side-effect events: ${sideEffectEvents.length}</span>
        </div>
        <div class="consult-trend-chart">
          ${consultTrendChart || `<div class="empty">Not enough check-in data yet for trend graphing in this window.</div>`}
        </div>
      </article>

      <article class="card consult-section consult-section-main consult-pane ${paneClass("effects")}" id="consult-effects">
        <h3>Side effects summary</h3>
        ${sideEffectSummary.length ? `
          <ul class="timeline-list consult-list consult-effects-list">
            ${sideEffectSummary.map((row) => `
              <li>
                <div class="inline-row consult-med-head">
                  <strong>${escapeHtml(row.medication)}</strong>
                  <span class="pill-badge urgency-medium">${escapeHtml(row.timing)}</span>
                </div>
                <div class="inline-row">
                  <span class="kpi-badge">Frequency: ${escapeHtml(String(row.count))}</span>
                  <span class="kpi-badge">Avg severity: ${escapeHtml(String(row.avgSeverity))}</span>
                </div>
                <div class="subtle">Top symptom: ${escapeHtml(row.topSymptom)}</div>
              </li>
            `).join("")}
          </ul>
        ` : `<div class="empty">No side-effect timing events in this window.</div>`}
      </article>

      <article class="card consult-section consult-section-main consult-pane ${paneClass("trends")}" id="consult-adherence">
        <h3>Adherence summary</h3>
        <div class="summary-strip-grid consult-summary-strip">
          <div class="summary-strip-item"><div class="summary-strip-label">Taken</div><div class="summary-strip-value">${takenCount}</div></div>
          <div class="summary-strip-item"><div class="summary-strip-label">Skipped</div><div class="summary-strip-value">${skippedCount}</div></div>
          <div class="summary-strip-item"><div class="summary-strip-label">Logged adherence</div><div class="summary-strip-value">${adherencePct === null ? "-" : `${adherencePct}%`}</div></div>
          <div class="summary-strip-item"><div class="summary-strip-label">Window</div><div class="summary-strip-value">${escapeHtml(`${niceDate(windowRange.startDate)} → ${niceDate(windowRange.endDate)}`)}</div></div>
        </div>
      </article>

      <article class="card consult-section consult-section-side consult-pane ${paneClass("questions")}" id="consult-questions">
        <div class="card-head-row">
          <div>
            <h3>Question queue</h3>
            <div class="subtle">Open topics for psychiatrist review during consult.</div>
          </div>
          ${ownerEditable ? `<button class="btn btn-secondary small" type="button" data-consult-focus-questions="1">Add question</button>` : ""}
        </div>
        ${questions.length ? `
          <ul class="timeline-list consult-list">
            ${questions.map((entry) => {
              const urgency = String(entry.urgency || "medium").toLowerCase();
              const status = String(entry.status || "open").toLowerCase();
              const urgencyLabel = urgency === "high" ? "high urgency" : urgency === "low" ? "low urgency" : "medium urgency";
              const urgencyClass = urgency === "high" ? "urgency-high" : urgency === "low" ? "urgency-low" : "urgency-medium";
              const statusLabel = CONSULT_QUESTION_STATUS_LABELS[status] || status;
              const statusClass = status === "resolved"
                ? "status-resolved"
                : status === "discussed"
                  ? "status-discussed"
                  : status === "carry_forward"
                    ? "status-carry-forward"
                    : "status-open";
              return `
              <li class="consult-question-row consult-entry">
                <div class="consult-entry-head">
                  <strong>${escapeHtml(entry.text)}</strong>
                  <span class="pill-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="inline-row consult-question-meta consult-entry-meta">
                  <span class="pill-badge ${urgencyClass}">${escapeHtml(urgencyLabel)}</span>
                  <span>Created ${escapeHtml(niceDateTime(entry.createdAt))}</span>
                  ${entry.linkedMedication ? `<span>Linked: ${escapeHtml(entry.linkedMedication)}</span>` : ""}
                  <span>${escapeHtml(entry.category)}</span>
                </div>
                ${entry.note ? `<div class="subtle">${escapeHtml(entry.note)}</div>` : ""}
                ${ownerEditable ? `
                  <div class="inline-row" style="margin-top:6px;">
                    <button class="btn btn-ghost small" type="button" data-edit-question="${entry.id}">Edit</button>
                    <button class="btn btn-ghost small" type="button" data-delete-question="${entry.id}">Delete</button>
                    <button class="btn btn-ghost small" type="button" data-question-status="${entry.id}" data-next-status="discussed">Discussed</button>
                    <button class="btn btn-ghost small" type="button" data-question-status="${entry.id}" data-next-status="resolved">Resolved</button>
                    <button class="btn btn-ghost small" type="button" data-question-status="${entry.id}" data-next-status="carry_forward">Carry forward</button>
                    <button class="btn btn-ghost small" type="button" data-question-status="${entry.id}" data-next-status="open">Re-open</button>
                  </div>
                ` : ""}
              </li>
            `;
            }).join("")}
          </ul>
        ` : `<div class="empty">No open consult questions.${ownerEditable ? " Add one to prep for the next appointment." : ""}</div>`}
        ${ownerEditable ? `
          <details class="consult-editor" id="consultQuestionEditor" ${editingQuestion ? "open" : ""}>
            <summary>${editingQuestion ? "Edit question" : "Add question"}</summary>
          <form id="consultQuestionForm" class="edit-inline-form consult-form consult-form-noborder">
            <input type="hidden" name="editingId" value="${escapeHtml(editingQuestion?.id || "")}">
            <div class="field-grid">
              <div style="grid-column: 1 / -1;"><label>Question / concern</label><input name="text" required placeholder="What do I want to ask?" value="${escapeHtml(editingQuestion?.text || "")}"></div>
              <div><label>Category</label><select name="category">${["question", "concern", "request", "observation"].map((value) => `<option value="${value}" ${String(editingQuestion?.category || "question") === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
              <div><label>Urgency</label><select name="urgency">${["low", "medium", "high"].map((value) => `<option value="${value}" ${String(editingQuestion?.urgency || "medium") === value ? "selected" : ""}>${value}</option>`).join("")}</select></div>
              <div><label>Status</label><select name="status">${["open", "discussed", "resolved", "carry_forward"].map((value) => `<option value="${value}" ${String(editingQuestion?.status || "open") === value ? "selected" : ""}>${value.replace("_", " ")}</option>`).join("")}</select></div>
              <div><label>Linked medication</label><input name="linkedMedication" list="commonMedicationNames" placeholder="optional" value="${escapeHtml(editingQuestion?.linkedMedication || "")}"></div>
              <div style="grid-column: 1 / -1;"><label>Note (optional)</label><textarea name="note">${escapeHtml(editingQuestion?.note || "")}</textarea></div>
            </div>
            <div class="inline-row">
              <button class="btn btn-primary small" type="submit">${editingQuestion ? "Update question" : "Save question"}</button>
              <button class="btn btn-ghost small" type="button" data-cancel-question-edit="1">Cancel</button>
            </div>
          </form>
          </details>
        ` : ""}
      </article>

      <article class="card consult-section consult-section-side consult-pane ${paneClass("plan")}" id="consult-plan">
        <h3>Decision log and current plan</h3>
        ${latestDecision ? `
          <div class="consult-plan-highlight">
            <div><strong>Last decision:</strong> ${escapeHtml(niceDate(latestDecision.appointmentDate))}${latestDecision.clinicianName ? ` · ${escapeHtml(latestDecision.clinicianName)}` : ""}</div>
            <div class="subtle">${escapeHtml(latestDecision.planUntilNextReview || latestDecision.notes || "No plan text recorded.")}</div>
          </div>
        ` : `<div class="empty">No decision log entries yet.</div>`}
        ${decisions.length ? `
          <ul class="timeline-list consult-list">
            ${decisions.map((entry) => {
              const linkedExperimentLabel = resolveLinkedExperimentLabel(allExperimentsById, entry);
              return `<li>
                <strong>${escapeHtml(niceDate(entry.appointmentDate))}</strong>${entry.clinicianName ? ` · ${escapeHtml(entry.clinicianName)}` : ""}
                <div class="subtle">${escapeHtml(entry.planUntilNextReview || entry.notes || "-")}</div>
                ${entry.followUpDate ? `<div class="subtle">Follow-up: ${escapeHtml(niceDate(entry.followUpDate))}</div>` : ""}
                ${linkedExperimentLabel ? `<div class="subtle">Linked change: ${escapeHtml(linkedExperimentLabel)}</div>` : ""}
                ${ownerEditable ? `
                  <div class="inline-row" style="margin-top:6px;">
                    <button class="btn btn-ghost small" type="button" data-edit-decision="${entry.id}">Edit</button>
                    <button class="btn btn-ghost small" type="button" data-delete-decision="${entry.id}">Delete</button>
                  </div>
                ` : ""}
              </li>`;
            }).join("")}
          </ul>
        ` : ""}
        ${ownerEditable ? `
          <details class="consult-editor" id="consultDecisionEditor" ${editingDecision ? "open" : ""}>
            <summary>${editingDecision ? "Edit decision log entry" : "Add decision log entry"}</summary>
          <form id="consultDecisionForm" class="edit-inline-form consult-form consult-form-noborder">
            <input type="hidden" name="editingId" value="${escapeHtml(editingDecision?.id || "")}">
            <div class="field-grid">
              <div><label>Appointment date</label><input name="appointmentDate" type="date" value="${escapeHtml(editingDecision?.appointmentDate || isoDate(new Date()))}" required></div>
              <div><label>Clinician name (optional)</label><input name="clinicianName" placeholder="e.g. Theo" value="${escapeHtml(editingDecision?.clinicianName || "")}"></div>
              <div><label>Linked appointment marker</label><select name="appointmentId"><option value="">None</option>${appointments.map((entry) => `<option value="${entry.id}" ${String(editingDecision?.appointmentId || "") === entry.id ? "selected" : ""}>${escapeHtml(`${niceDate(entry.appointmentDate)} · ${entry.appointmentType}`)}</option>`).join("")}</select></div>
              <div><label>Linked med change</label><select name="linkedExperimentId"><option value="">None</option>${allExperiments.map((entry) => `<option value="${entry.id}" ${String(editingDecision?.linkedExperimentId || "") === entry.id ? "selected" : ""}>${escapeHtml(`${niceDate(entry.dateEffective)} · ${experimentLabelForSummary(entry)}`)}</option>`).join("")}</select></div>
              <div style="grid-column: 1 / -1;"><label>Decision summary</label><textarea name="notes" required placeholder="What was decided?">${escapeHtml(editingDecision?.notes || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>Rationale</label><textarea name="rationale">${escapeHtml(editingDecision?.rationale || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>Success criteria</label><textarea name="successCriteria">${escapeHtml(editingDecision?.successCriteria || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>Failure criteria / concerns</label><textarea name="failureCriteria">${escapeHtml(editingDecision?.failureCriteria || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>Plan until next review</label><textarea name="planUntilNextReview">${escapeHtml(editingDecision?.planUntilNextReview || "")}</textarea></div>
              <div><label>Follow-up date</label><input name="followUpDate" type="date" value="${escapeHtml(editingDecision?.followUpDate || "")}"></div>
              <div><label>Contingency plan</label><input name="contingencyPlan" placeholder="optional" value="${escapeHtml(editingDecision?.contingencyPlan || "")}"></div>
            </div>
            <div class="inline-row">
              <button class="btn btn-primary small" type="submit">${editingDecision ? "Update decision" : "Save decision"}</button>
              <button class="btn btn-ghost small" type="button" data-cancel-decision-edit="1">Cancel</button>
            </div>
          </form>
          </details>
        ` : ""}
      </article>

      <article class="card consult-section consult-section-side consult-pane ${paneClass("plan")}" id="consult-focus">
        <div class="card-head-row">
          <div>
            <h3>What I want to discuss today</h3>
            <div class="subtle">Owner editable consult agenda for appointment focus.</div>
          </div>
        </div>
        ${ownerEditable ? `
          <details class="consult-editor" id="consultFocusEditor" ${focusText ? "" : "open"}>
            <summary>${focusText ? "Edit consult focus" : "Add consult focus"}</summary>
          <form id="consultFocusForm" class="edit-inline-form consult-form consult-form-noborder">
            <label for="consultDiscussToday">Consult focus text</label>
            <textarea id="consultDiscussToday" name="discussToday" maxlength="500" placeholder="Key goals, concerns, and decision points for this appointment.">${escapeHtml(focusText)}</textarea>
            <div class="inline-row"><button class="btn btn-primary small" type="submit">Save</button><button class="btn btn-ghost small" type="reset">Cancel</button></div>
          </form>
          </details>
        ` : `<div class="subtle">${focusText ? escapeHtml(focusText) : "No consult focus text provided."}</div>`}
      </article>

      <article class="card consult-section consult-section-side consult-section-collapsible consult-pane ${paneClass("plan")}" id="consult-quality">
        <h3>Data quality</h3>
        <ul class="timeline-list consult-list">
          <li>Days without check-in: <strong>${quality.daysWithoutCheckin}</strong></li>
          <li>Missing dose logs (estimated): <strong>${quality.missingDoseLogs}</strong></li>
          <li>Incomplete change experiments: <strong>${quality.incompleteExperiments}</strong></li>
          <li>Low-confidence entries: <strong>${quality.lowConfidenceEntries}</strong></li>
        </ul>
        <div class="subtle">Use this context to avoid over-interpreting sparse data.</div>
      </article>

      <article class="card consult-section consult-section-side consult-section-collapsible consult-pane ${paneClass("plan")}" id="consult-appointments">
        <h3>Appointment markers</h3>
        ${appointments.length ? `
          <ul class="timeline-list consult-list">
            ${appointments.map((entry) => `<li><strong>${escapeHtml(niceDate(entry.appointmentDate))}</strong> · ${escapeHtml(entry.appointmentType)}${entry.summaryNote ? `<div class="subtle">${escapeHtml(entry.summaryNote)}</div>` : ""}${ownerEditable ? `<div class="inline-row" style="margin-top:6px;"><button class="btn btn-ghost small" type="button" data-edit-appointment="${entry.id}">Edit</button><button class="btn btn-ghost small" type="button" data-delete-appointment="${entry.id}">Delete</button></div>` : ""}</li>`).join("")}
          </ul>
        ` : `<div class="empty">No appointments logged yet.</div>`}
        ${ownerEditable ? `
          <details class="consult-editor" id="consultAppointmentEditor" ${editingAppointment ? "open" : ""}>
            <summary>${editingAppointment ? "Edit appointment marker" : "Add appointment marker"}</summary>
          <form id="consultAppointmentForm" class="edit-inline-form consult-form consult-form-noborder">
            <input type="hidden" name="editingId" value="${escapeHtml(editingAppointment?.id || "")}">
            <div class="field-grid">
              <div><label>Date</label><input name="appointmentDate" type="date" value="${escapeHtml(editingAppointment?.appointmentDate || isoDate(new Date()))}" required></div>
              <div><label>Type</label><select name="appointmentType">${["psychiatrist", "gp", "other"].map((entry) => `<option value="${entry}" ${String(editingAppointment?.appointmentType || "psychiatrist") === entry ? "selected" : ""}>${entry}</option>`).join("")}</select></div>
              <div style="grid-column: 1 / -1;"><label>Summary note (optional)</label><textarea name="summaryNote">${escapeHtml(editingAppointment?.summaryNote || "")}</textarea></div>
            </div>
            <div class="inline-row">
              <button class="btn btn-primary small" type="submit">${editingAppointment ? "Update appointment marker" : "Save appointment marker"}</button>
              <button class="btn btn-ghost small" type="button" data-cancel-appointment-edit="1">Cancel</button>
            </div>
          </form>
          </details>
        ` : ""}
      </article>

      <article class="card consult-section consult-section-side consult-section-collapsible consult-pane ${paneClass("changes")}" id="consult-experiments">
        <h3>Medication change experiment log</h3>
        ${ownerEditable ? `
          <details class="consult-editor" id="consultExperimentEditor" ${editingExperiment ? "open" : ""}>
            <summary>${editingExperiment ? "Edit experiment entry" : "Add experiment entry"}</summary>
          <form id="consultExperimentForm" class="edit-inline-form consult-form consult-form-noborder">
            <input type="hidden" name="editingId" value="${escapeHtml(editingExperiment?.id || "")}">
            <div class="field-grid">
              <div><label>Date effective</label><input name="dateEffective" type="date" value="${escapeHtml(editingExperiment?.dateEffective || isoDate(new Date()))}" required></div>
              <div><label>Medication</label><input name="medicationName" list="commonMedicationNames" value="${escapeHtml(editingExperiment?.medicationName || "")}" required></div>
              <div><label>Old dose</label><input name="oldDose" value="${escapeHtml(editingExperiment?.oldDose || "")}" required></div>
              <div><label>New dose</label><input name="newDose" value="${escapeHtml(editingExperiment?.newDose || "")}" required></div>
              <div><label>Changed by</label><select name="changedBy">${["self", "psychiatrist", "gp", "other"].map((role) => `<option value="${role}" ${String(editingExperiment?.changedBy || "self") === role ? "selected" : ""}>${role}</option>`).join("")}</select></div>
              <div><label>Route (optional)</label><input name="route" value="${escapeHtml(editingExperiment?.route || "")}"></div>
              <div><label>Schedule change (optional)</label><input name="scheduleChange" value="${escapeHtml(editingExperiment?.scheduleChange || "")}" placeholder="e.g. moved PM dose to 14:00"></div>
              <div style="grid-column: 1 / -1;"><label>Reason for change</label><textarea name="reasonForChange" required>${escapeHtml(editingExperiment?.reasonForChange || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>Expected benefit</label><textarea name="expectedBenefit">${escapeHtml(editingExperiment?.expectedBenefit || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>Expected side effects</label><textarea name="expectedSideEffects">${escapeHtml(editingExperiment?.expectedSideEffects || "")}</textarea></div>
              <div style="grid-column: 1 / -1;"><label>What to monitor</label><textarea name="whatToMonitor">${escapeHtml(editingExperiment?.whatToMonitor || "")}</textarea></div>
              <div><label>Review date</label><input name="reviewDate" type="date" value="${escapeHtml(editingExperiment?.reviewDate || "")}"></div>
              <div><label>Outcome status</label><select name="outcomeStatus">${["pending", "better", "worse", "mixed", "unclear"].map((state) => `<option value="${state}" ${String(editingExperiment?.outcomeStatus || "pending") === state ? "selected" : ""}>${state}</option>`).join("")}</select></div>
              <div><label>Outcome confidence</label><select name="confidenceInOutcome">${["low", "medium", "high"].map((level) => `<option value="${level}" ${String(editingExperiment?.confidenceInOutcome || "medium") === level ? "selected" : ""}>${level}</option>`).join("")}</select></div>
              <div style="grid-column: 1 / -1;"><label>Outcome notes</label><textarea name="outcomeNotes">${escapeHtml(editingExperiment?.outcomeNotes || "")}</textarea></div>
            </div>
            <div class="inline-row">
              <button class="btn btn-primary small" type="submit">${editingExperiment ? "Update experiment" : "Save experiment"}</button>
              <button class="btn btn-ghost small" type="button" data-cancel-experiment-edit="1">Cancel</button>
            </div>
          </form>
          </details>
        ` : `<div class="subtle">Experiment log is editable in owner mode only.</div>`}
      </article>
    </div>
  `;

  root.querySelector("#consultRangeFilter")?.addEventListener("change", (event) => {
    app.ui.consultFilters = { ...app.ui.consultFilters, range: String(event.target.value || "since_last_appointment") };
    if (ownerEditable) {
      app.ownerData.consultConfig = normalizeConsultConfig({
        ...(app.ownerData.consultConfig || {}),
        activeFilters: app.ui.consultFilters
      });
      saveOwnerData(app.ownerData);
    }
    renderAll();
  });
  root.querySelector("#consultRangeDays")?.addEventListener("change", (event) => {
    app.ui.consultFilters = { ...app.ui.consultFilters, customRangeDays: String(event.target.value || "14") };
    if (ownerEditable) {
      app.ownerData.consultConfig = normalizeConsultConfig({
        ...(app.ownerData.consultConfig || {}),
        activeFilters: app.ui.consultFilters
      });
      saveOwnerData(app.ownerData);
    }
    renderAll();
  });
  root.querySelector("#consultMedicationFilter")?.addEventListener("change", (event) => {
    app.ui.consultFilters = { ...app.ui.consultFilters, medicationId: String(event.target.value || "all") };
    if (ownerEditable) {
      app.ownerData.consultConfig = normalizeConsultConfig({
        ...(app.ownerData.consultConfig || {}),
        activeFilters: app.ui.consultFilters
      });
      saveOwnerData(app.ownerData);
    }
    renderAll();
  });
  root.querySelector("#consultOpenOnly")?.addEventListener("change", (event) => {
    app.ui.consultFilters = { ...app.ui.consultFilters, openQuestionsOnly: Boolean(event.target.checked) };
    if (ownerEditable) {
      app.ownerData.consultConfig = normalizeConsultConfig({
        ...(app.ownerData.consultConfig || {}),
        activeFilters: app.ui.consultFilters
      });
      saveOwnerData(app.ownerData);
    }
    renderAll();
  });
  root.querySelector("[data-consult-copy]")?.addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardSummary);
      } else {
        const temp = document.createElement("textarea");
        temp.value = clipboardSummary;
        temp.setAttribute("readonly", "true");
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();
      }
      setStatus("Consult summary copied to clipboard.");
    } catch (error) {
      console.error("Failed to copy consult summary", error);
      setStatus("Could not copy consult summary. Try Print / Save PDF instead.", "error");
    }
  });
  root.querySelector("[data-consult-pack]")?.addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(appointmentPackSummary);
      }
      const html = buildClinicianSummaryHtml(data, "14");
      const popup = window.open("", "_blank", "noopener,noreferrer,width=1024,height=900");
      if (!popup) {
        setStatus("Popup blocked. Allow popups to open the Appointment Pack preview.", "error");
        return;
      }
      popup.document.write(html);
      popup.document.close();
      popup.focus();
      setStatus("Appointment Pack ready: 14-day summary copied and print view opened.");
    } catch (error) {
      console.error("Failed to generate appointment pack", error);
      setStatus("Could not generate Appointment Pack. Try again or use Print / Save PDF.", "error");
    }
  });
  root.querySelector("[data-consult-print]")?.addEventListener("click", () => window.print());
  root.querySelector("[data-consult-focus-questions]")?.addEventListener("click", () => {
    const editor = root.querySelector("#consultQuestionEditor");
    if (editor) editor.open = true;
    root.querySelector("#consultQuestionForm input[name='text']")?.focus();
  });
  root.querySelectorAll("[data-consult-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetPane = String(button.dataset.consultPane || "").trim();
      if (!consultPaneOptions.includes(targetPane)) return;
      app.ui.consultActivePane = targetPane;
      persistUiDraftPreferences();
      renderAll();
    });
  });

  if (!ownerEditable) return;

  root.querySelector("#consultFocusForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const discussToday = String(form.elements.discussToday?.value || "").trim();
    app.ownerData.consultConfig = normalizeConsultConfig({
      ...(app.ownerData.consultConfig || {}),
      discussToday,
      activeFilters: app.ui.consultFilters
    });
    saveOwnerData(app.ownerData);
    setStatus("Consult focus updated.");
    renderAll();
  });

  root.querySelector("#consultQuestionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = formToObject(form);
    if (!values.text) {
      setStatus("Question text is required.", "error");
      return;
    }
    const nowIso = isoDateTime(new Date());
    const editingId = String(values.editingId || "");
    if (editingId) {
      app.ownerData.consultQuestions = (app.ownerData.consultQuestions || []).map((entry) => (
        entry.id === editingId
          ? normalizeConsultQuestion({
              ...entry,
              ...values,
              id: editingId,
              discussedAt: values.status === "open" ? "" : (entry.discussedAt || nowIso)
            })
          : entry
      ));
      app.ui.consultEditingQuestionId = "";
      setStatus("Consult question updated.");
    } else {
      app.ownerData.consultQuestions.push(normalizeConsultQuestion({
        ...values,
        id: uid(),
        status: values.status || "open",
        createdAt: nowIso
      }));
      setStatus("Consult question added.");
    }
    saveOwnerData(app.ownerData);
    form.reset();
    renderAll();
  });

  root.querySelectorAll("[data-edit-question]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.consultEditingQuestionId = String(button.dataset.editQuestion || "");
      renderAll();
    });
  });

  root.querySelectorAll("[data-delete-question]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.deleteQuestion || "");
      if (!id) return;
      app.ownerData.consultQuestions = (app.ownerData.consultQuestions || []).filter((entry) => entry.id !== id);
      if (app.ui.consultEditingQuestionId === id) {
        app.ui.consultEditingQuestionId = "";
      }
      saveOwnerData(app.ownerData);
      setStatus("Consult question deleted.");
      renderAll();
    });
  });

  root.querySelectorAll("[data-edit-experiment]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.consultEditingExperimentId = String(button.dataset.editExperiment || "");
      renderAll();
    });
  });

  root.querySelectorAll("[data-delete-experiment]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.deleteExperiment || "");
      if (!id) return;
      app.ownerData.medicationChangeExperiments = (app.ownerData.medicationChangeExperiments || []).filter((entry) => entry.id !== id);
      app.ownerData.decisionLog = (app.ownerData.decisionLog || []).map((entry) => (
        String(entry.linkedExperimentId || "") === id
          ? normalizeDecisionLogEntry({ ...entry, linkedExperimentId: "" })
          : entry
      ));
      if (app.ui.consultEditingExperimentId === id) {
        app.ui.consultEditingExperimentId = "";
      }
      saveOwnerData(app.ownerData);
      setStatus("Experiment entry deleted.");
      renderAll();
    });
  });

  root.querySelectorAll("[data-question-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.questionStatus || "");
      const nextStatus = String(button.dataset.nextStatus || "open");
      const target = app.ownerData.consultQuestions.find((entry) => entry.id === id);
      if (!target) return;
      target.status = nextStatus;
      target.discussedAt = nextStatus === "open" ? "" : isoDateTime(new Date());
      saveOwnerData(app.ownerData);
      setStatus(`Question marked ${nextStatus.replace("_", " ")}.`);
      renderAll();
    });
  });

  root.querySelector("[data-cancel-question-edit]")?.addEventListener("click", () => {
    app.ui.consultEditingQuestionId = "";
    renderAll();
  });

  root.querySelectorAll("[data-edit-decision]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.consultEditingDecisionId = String(button.dataset.editDecision || "");
      renderAll();
    });
  });

  root.querySelectorAll("[data-delete-decision]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.deleteDecision || "");
      if (!id) return;
      app.ownerData.decisionLog = (app.ownerData.decisionLog || []).filter((entry) => entry.id !== id);
      if (app.ui.consultEditingDecisionId === id) {
        app.ui.consultEditingDecisionId = "";
      }
      saveOwnerData(app.ownerData);
      setStatus("Decision entry deleted.");
      renderAll();
    });
  });

  root.querySelector("#consultDecisionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formToObject(event.currentTarget);
    if (!values.appointmentDate || !values.notes) {
      setStatus("Decision log needs appointment date and summary.", "error");
      return;
    }
    const nowIso = isoDateTime(new Date());
    const editingId = String(values.editingId || "");
    if (editingId) {
      app.ownerData.decisionLog = (app.ownerData.decisionLog || []).map((entry) => (
        entry.id === editingId
          ? normalizeDecisionLogEntry({
              ...entry,
              ...values,
              id: editingId,
              updatedAt: nowIso
            })
          : entry
      ));
      app.ui.consultEditingDecisionId = "";
      setStatus("Decision log entry updated.");
    } else {
      app.ownerData.decisionLog.push(normalizeDecisionLogEntry({
        ...values,
        id: uid(),
        createdAt: nowIso,
        updatedAt: nowIso
      }));
      setStatus("Decision log entry saved.");
    }
    saveOwnerData(app.ownerData);
    event.currentTarget.reset();
    renderAll();
  });

  root.querySelector("[data-cancel-decision-edit]")?.addEventListener("click", () => {
    app.ui.consultEditingDecisionId = "";
    renderAll();
  });

  root.querySelectorAll("[data-edit-appointment]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.consultEditingAppointmentId = String(button.dataset.editAppointment || "");
      renderAll();
    });
  });

  root.querySelectorAll("[data-delete-appointment]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = String(button.dataset.deleteAppointment || "");
      if (!id) return;
      app.ownerData.appointmentEvents = (app.ownerData.appointmentEvents || []).filter((entry) => entry.id !== id);
      app.ownerData.decisionLog = (app.ownerData.decisionLog || []).map((entry) => (
        String(entry.appointmentId || "") === id
          ? normalizeDecisionLogEntry({ ...entry, appointmentId: "" })
          : entry
      ));
      if (app.ui.consultEditingAppointmentId === id) {
        app.ui.consultEditingAppointmentId = "";
      }
      saveOwnerData(app.ownerData);
      setStatus("Appointment marker deleted.");
      renderAll();
    });
  });

  root.querySelector("#consultAppointmentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formToObject(event.currentTarget);
    if (!values.appointmentDate) {
      setStatus("Appointment date is required.", "error");
      return;
    }
    const nowIso = isoDateTime(new Date());
    const editingId = String(values.editingId || "");
    if (editingId) {
      app.ownerData.appointmentEvents = (app.ownerData.appointmentEvents || []).map((entry) => (
        entry.id === editingId
          ? normalizeAppointmentEvent({
              ...entry,
              ...values,
              id: editingId,
              createdAt: entry.createdAt || nowIso
            })
          : entry
      ));
      app.ui.consultEditingAppointmentId = "";
      setStatus("Appointment marker updated.");
    } else {
      app.ownerData.appointmentEvents.push(normalizeAppointmentEvent({
        ...values,
        id: uid(),
        createdAt: nowIso
      }));
      setStatus("Appointment marker saved.");
    }
    saveOwnerData(app.ownerData);
    event.currentTarget.reset();
    renderAll();
  });

  root.querySelector("[data-cancel-appointment-edit]")?.addEventListener("click", () => {
    app.ui.consultEditingAppointmentId = "";
    renderAll();
  });

  root.querySelector("#consultExperimentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = formToObject(event.currentTarget);
    if (!values.dateEffective || !values.medicationName || !values.oldDose || !values.newDose || !values.reasonForChange) {
      setStatus("Experiment log entry needs date, medication, dose change, and reason.", "error");
      return;
    }
    if (!doseLooksValid(values.oldDose) || !doseLooksValid(values.newDose)) {
      setStatus("Dose format is invalid. Use value + unit (e.g. 40 mg).", "error");
      return;
    }
    const nowIso = isoDateTime(new Date());
    const editingId = String(values.editingId || "");
    if (editingId) {
      app.ownerData.medicationChangeExperiments = (app.ownerData.medicationChangeExperiments || []).map((entry) => (
        entry.id === editingId
          ? normalizeMedicationChangeExperiment({
              ...entry,
              ...values,
              id: editingId,
              updatedAt: nowIso
            })
          : entry
      ));
      app.ui.consultEditingExperimentId = "";
      setStatus("Medication change experiment updated.");
    } else {
      app.ownerData.medicationChangeExperiments.push(normalizeMedicationChangeExperiment({
        ...values,
        id: uid(),
        createdAt: nowIso,
        updatedAt: nowIso
      }));
      setStatus("Medication change experiment saved.");
    }
    saveOwnerData(app.ownerData);
    event.currentTarget.reset();
    renderAll();
  });

  root.querySelector("[data-cancel-experiment-edit]")?.addEventListener("click", () => {
    app.ui.consultEditingExperimentId = "";
    renderAll();
  });
}

function renderDeferredTimelineChart(chartKey, title, description, renderChart) {
  const enabled = Boolean(app.ui.timelineLazyCharts?.[chartKey]);
  return `
    <article class="chart-box">
      <h4>${escapeHtml(title)}</h4>
      ${description ? `<p class="subtle">${escapeHtml(description)}</p>` : ""}
      ${enabled
        ? renderChart()
        : `<div class="empty">Chart deferred until requested to keep this view fast. <button class="btn btn-secondary small" type="button" data-load-timeline-chart="${escapeHtml(chartKey)}">Load chart</button></div>`}
    </article>
  `;
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
  const timelineWindow = resolveTimelineDateWindow();
  const inferredWindow = inferDateBoundsFromTimelineData(filtered);
  const quality = buildDataQualityIndicators(filtered, {
    startDate: timelineWindow.startDate || inferredWindow.startDate,
    endDate: timelineWindow.endDate || inferredWindow.endDate
  });
  app.ui.timelineLazyCharts = {
    ...TIMELINE_LAZY_CHART_DEFAULTS,
    ...(app.ui.timelineLazyCharts || {})
  };
  const checkins = filtered.checkins.slice().sort((a, b) => a.date.localeCompare(b.date));
  const changeDates = filtered.changes.map((entry) => entry.date);

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
        <div class="inline-row" style="margin-top:8px;">
          <button class="btn btn-ghost small" type="button" data-load-all-timeline-charts="1">Load all charts</button>
          <button class="btn btn-ghost small" type="button" data-reset-timeline-charts="1">Keep essential charts only</button>
        </div>
      </article>

      ${renderDataConfidenceBanner(quality, "timeline trends")}

      ${renderDeferredTimelineChart(
        "adherence",
        "Adherence % over time",
        "",
        () => {
          const adherenceTrend = buildAdherenceTrend(filtered.adherence);
          return renderLineChart([{ label: "Adherence %", color: CHART_COLORS.adherence, points: adherenceTrend }], { yMin: 0, yMax: 100, changeDates });
        }
      )}

      ${renderDeferredTimelineChart(
        "symptoms",
        "Symptom trends: mood / anxiety / focus",
        "",
        () => {
          const moodSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.mood) }));
          const anxietySeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.anxiety) }));
          const focusSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.focus) }));
          return renderLineChart(
            [
              { label: "Mood", color: CHART_COLORS.mood, points: moodSeries },
              { label: "Anxiety", color: CHART_COLORS.anxiety, points: anxietySeries },
              { label: "Focus", color: CHART_COLORS.focus, points: focusSeries }
            ],
            { yMin: 0, yMax: 10, changeDates }
          );
        }
      )}

      ${renderDeferredTimelineChart(
        "sleep",
        "Sleep hours over time",
        "",
        () => {
          const sleepSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.sleepHours) }));
          return renderLineChart([{ label: "Sleep hours", color: CHART_COLORS.sleep, points: sleepSeries }], { yMin: 0, yMax: 12, changeDates });
        }
      )}

      ${renderDeferredTimelineChart(
        "sideEffects",
        "Side-effect intensity trend",
        "",
        () => renderBarChart(buildSideEffectCounts(filtered), changeDates)
      )}

      ${showAdvancedTimeline
        ? renderDeferredTimelineChart(
            "doseChanges",
            "Dose changes timeline",
            "",
            () => renderBarChart(buildDoseChangeTrend(filtered.changes), [], { label: "Dose changes", color: CHART_COLORS.doseChangeMarker })
          )
        : ""}

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

  root.querySelectorAll("[data-load-timeline-chart]").forEach((button) => {
    button.addEventListener("click", () => {
      const chartKey = String(button.dataset.loadTimelineChart || "").trim();
      if (!chartKey) return;
      app.ui.timelineLazyCharts = {
        ...TIMELINE_LAZY_CHART_DEFAULTS,
        ...(app.ui.timelineLazyCharts || {}),
        [chartKey]: true
      };
      renderAll();
    });
  });

  root.querySelector("[data-load-all-timeline-charts]")?.addEventListener("click", () => {
    app.ui.timelineLazyCharts = {
      adherence: true,
      symptoms: true,
      sleep: true,
      sideEffects: true,
      doseChanges: true
    };
    renderAll();
  });

  root.querySelector("[data-reset-timeline-charts]")?.addEventListener("click", () => {
    app.ui.timelineLazyCharts = { ...TIMELINE_LAZY_CHART_DEFAULTS };
    renderAll();
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
        app.ui.checkinQuickMode = false;
      } else if (action === "change") {
        app.ui.activeSection = "entry";
        app.ui.entryWorkflow = "change";
      }
      renderAll();
    });
  });
}

function resolveTimelineDateWindow() {
  let fromDate = String(app.ui.timelineFilters.fromDate || "");
  let toDate = String(app.ui.timelineFilters.toDate || "");
  const rangeDays = Number(app.ui.timelineFilters.rangeDays || 0);
  if (!fromDate && !toDate && Number.isFinite(rangeDays) && rangeDays > 0) {
    toDate = getLocalDateKey(new Date());
    fromDate = shiftDateKey(toDate, -(rangeDays - 1));
  }
  if (fromDate && !toDate) toDate = getLocalDateKey(new Date());
  if (!fromDate && toDate) fromDate = shiftDateKey(toDate, -13);
  return {
    startDate: fromDate || "",
    endDate: toDate || ""
  };
}

function inferDateBoundsFromTimelineData(data) {
  const keys = [];
  for (const row of data.checkins || []) keys.push(String(row.date || "").slice(0, 10));
  for (const row of data.adherence || []) keys.push(String(row.date || "").slice(0, 10));
  for (const row of data.changes || []) keys.push(String(row.date || "").slice(0, 10));
  for (const row of data.notes || []) keys.push(String(row.date || "").slice(0, 10));
  for (const row of data.sideEffectEvents || []) keys.push(String(row.date || row.createdAt || "").slice(0, 10));
  const normalized = keys.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  if (!normalized.length) {
    const today = getLocalDateKey(new Date());
    return { startDate: today, endDate: today };
  }
  return {
    startDate: normalized[0],
    endDate: normalized[normalized.length - 1]
  };
}

function applyTimelineFilters(data) {
  const medicationId = app.ui.timelineFilters.medicationId || "all";
  const selectedMedication = (data.medications || []).find((med) => med.id === medicationId);
  const selectedKey = selectedMedication ? normalizeMedicationKey(selectedMedication.name) : "";
  const timelineWindow = resolveTimelineDateWindow();
  let fromDate = timelineWindow.startDate;
  let toDate = timelineWindow.endDate;
  const rangeDays = Number(app.ui.timelineFilters.rangeDays || 0);

  const memoKey = [
    derivedStateMemoKey(data),
    medicationId,
    selectedKey,
    fromDate,
    toDate,
    rangeDays
  ].join("|");
  if (app.derivedMemo.timelineFilteredKey === memoKey && app.derivedMemo.timelineFilteredValue) {
    return app.derivedMemo.timelineFilteredValue;
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
  const sideEffectEvents = (data.sideEffectEvents || []).filter((entry) => {
    const date = String(entry.date || entry.createdAt || "").slice(0, 10);
    if (!inDateWindow(date)) return false;
    if (medicationId === "all") return true;
    if (entry.linkedMedication && normalizeMedicationKey(entry.linkedMedication) === selectedKey) return true;
    return false;
  });
  const medicationChangeExperiments = resolveExperimentRows(data).filter((entry) => {
    if (!inDateWindow(String(entry.dateEffective || "").slice(0, 10))) return false;
    if (medicationId === "all") return true;
    if (entry.medicationId && entry.medicationId === medicationId) return true;
    if (entry.medicationName && normalizeMedicationKey(entry.medicationName) === selectedKey) return true;
    return false;
  });
  const filtered = {
    ...data,
    changes,
    notes,
    checkins,
    adherence,
    sideEffectEvents,
    medicationChangeExperiments
  };
  app.derivedMemo.timelineFilteredKey = memoKey;
  app.derivedMemo.timelineFilteredValue = filtered;
  return filtered;
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

  for (const decision of Array.isArray(data.decisionLog) ? data.decisionLog : []) {
    events.push({
      date: decision.appointmentDate,
      type: "Decision log",
      detail: `${decision.clinicianName ? `${decision.clinicianName} · ` : ""}${decision.planUntilNextReview || decision.notes || "Decision recorded"}`
    });
  }

  for (const appointment of Array.isArray(data.appointmentEvents) ? data.appointmentEvents : []) {
    events.push({
      date: appointment.appointmentDate,
      type: `Appointment (${appointment.appointmentType})`,
      detail: appointment.summaryNote || "Appointment marker"
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
  const comparison7 = computeBeforeAfterComparison(data, selectedChange.date, { beforeDays: 7, afterDays: 7 });
  const comparison14 = computeBeforeAfterComparison(data, selectedChange.date, { beforeDays: 14, afterDays: 14 });
  const rows = comparison7.metrics
    .filter((metric) => ["adherencePct", "moodAvg", "anxietyAvg", "focusAvg", "sleepHoursAvg", "sideEffectCount"].includes(metric.key));
  const comparisonConfidence = buildDataQualityIndicators(data, {
    startDate: comparison7.windows?.before?.startDate || selectedChange.date,
    endDate: comparison7.windows?.after?.endDate || selectedChange.date
  });

  return `
    <div class="field-grid">
      <div>
        <label for="comparisonChangeSelect">Select change</label>
        <select id="comparisonChangeSelect">
          ${sortedChanges.map((change) => `<option value="${change.id}" ${change.id === selectedId ? "selected" : ""}>${escapeHtml(niceDate(change.date))} · ${escapeHtml(change.medicationName || "Medication")} (${escapeHtml(change.oldDose || "-")} → ${escapeHtml(change.newDose || "-")})</option>`).join("")}
        </select>
      </div>
    </div>

    ${renderDataConfidenceBanner(comparisonConfidence, "before/after comparison")}

    <div class="table-wrap" style="margin-top:10px;">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>7 days before</th>
            <th>7 days after</th>
            <th>Delta</th>
            <th>Direction</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((metric) => {
            const before = metric.before;
            const after = metric.after;
            const delta = metric.delta;
            const direction = metric.changeType === "insufficient"
              ? "insufficient"
              : metric.changeType === "stable"
                ? "stable"
                : metric.changeType === "improved"
                  ? "improved"
                  : "worsened";
            return `<tr><td>${escapeHtml(metric.label)}</td><td>${before ?? "-"}</td><td>${after ?? "-"}</td><td>${delta === null || delta === undefined ? "-" : `${Number(delta) >= 0 ? "+" : ""}${escapeHtml(String(delta))}`}</td><td>${escapeHtml(direction)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <p class="subtle">${escapeHtml(comparison7.summary)} ${escapeHtml(comparison7.dataQuality?.note || "")}</p>
    <p class="subtle">14-day window check: ${escapeHtml(comparison14.dataQuality?.note || "Coverage assessed.")}</p>
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
      if (app.ui.entryWorkflow !== "checkin") {
        app.ui.checkinQuickMode = false;
      }
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

function buildCheckinDraftDefaults(data, draftInput = {}) {
  const draft = draftInput && typeof draftInput === "object" ? draftInput : {};
  const latest = (data.checkins || [])
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];

  const base = latest
    ? {
        mood: latest.mood,
        anxiety: latest.anxiety,
        focus: latest.focus,
        sleepHours: latest.sleepHours,
        sleepQuality: latest.sleepQuality,
        appetite: latest.appetite,
        energy: latest.energy,
        irritability: latest.irritability,
        cravingsImpulsivity: latest.cravingsImpulsivity,
        sideEffectsChecklist: latest.sideEffectsChecklist || [],
        sideEffectsText: latest.sideEffectsText || "",
        trainingNotes: latest.trainingNotes || "",
        gotOutOfBedOnTime: latest.gotOutOfBedOnTime || false,
        selfCareCompleted: latest.selfCareCompleted || false,
        keyTaskCompleted: latest.keyTaskCompleted || false,
        exerciseOrWalkDone: latest.exerciseOrWalkDone || false,
        avoidedImpulsiveBehaviour: latest.avoidedImpulsiveBehaviour || false,
        socialContactLevel: latest.socialContactLevel || "limited",
        onsetAfterDoseMinutes: "",
        sideEffectMedication: "",
        timeOfDay: "",
        confidenceRelatedToMed: "medium",
        impactOnFunction: "medium",
        weight: latest.vitals?.weight || "",
        bpSystolic: latest.vitals?.bpSystolic || "",
        bpDiastolic: latest.vitals?.bpDiastolic || "",
        hr: latest.vitals?.hr || ""
      }
    : {
        mood: 6,
        anxiety: 5,
        focus: 6,
        sleepHours: 7,
        sleepQuality: 6,
        appetite: 5,
        energy: 6,
        irritability: 4,
        cravingsImpulsivity: 4,
        socialContactLevel: "limited",
        gotOutOfBedOnTime: false,
        selfCareCompleted: false,
        keyTaskCompleted: false,
        exerciseOrWalkDone: false,
        avoidedImpulsiveBehaviour: false,
        onsetAfterDoseMinutes: "",
        sideEffectMedication: "",
        timeOfDay: "",
        confidenceRelatedToMed: "medium",
        impactOnFunction: "medium",
        sideEffectsChecklist: [],
        sideEffectsText: "",
        trainingNotes: "",
        gotOutOfBedOnTime: false,
        selfCareCompleted: false,
        keyTaskCompleted: false,
        exerciseOrWalkDone: false,
        avoidedImpulsiveBehaviour: false,
        socialContactLevel: "limited",
        onsetAfterDoseMinutes: "",
        sideEffectMedication: "",
        timeOfDay: "",
        confidenceRelatedToMed: "medium",
        impactOnFunction: "medium",
        weight: "",
        bpSystolic: "",
        bpDiastolic: "",
        hr: ""
      };

  return {
    ...base,
    ...draft,
    date: String(draft.date || isoDate(new Date())),
    sideEffectsChecklist: Array.isArray(draft.sideEffectsChecklist)
      ? draft.sideEffectsChecklist
      : base.sideEffectsChecklist
  };
}

function normalizeQuickCheckin30sDraft(input) {
  const draft = input && typeof input === "object" ? input : {};
  return {
    mood: String(draft.mood || ""),
    anxiety: String(draft.anxiety || ""),
    sleep: String(draft.sleep || ""),
    date: String(draft.date || isoDate(new Date()))
  };
}

function quickCheckin30sOption(field, value) {
  const options = QUICK_CHECKIN_30S_OPTIONS[field] || [];
  return options.find((entry) => String(entry.value || "") === String(value || "")) || null;
}

function buildQuickCheckin30sPayload(draftInput) {
  const draft = normalizeQuickCheckin30sDraft(draftInput);
  const mood = quickCheckin30sOption("mood", draft.mood);
  const anxiety = quickCheckin30sOption("anxiety", draft.anxiety);
  const sleep = quickCheckin30sOption("sleep", draft.sleep);
  if (!mood || !anxiety || !sleep) return null;

  const energy = mood.score >= 8 ? 7 : mood.score >= 6 ? 6 : 4;
  const irritability = anxiety.score >= 8 ? 7 : anxiety.score >= 6 ? 5 : 3;
  const cravings = anxiety.score >= 8 ? 6 : anxiety.score >= 6 ? 4 : 3;
  const socialContactLevel = mood.score <= 4 ? "limited" : "normal";

  return {
    date: draft.date || isoDate(new Date()),
    mood: mood.score,
    anxiety: anxiety.score,
    focus: mood.score >= 8 ? 7 : mood.score >= 6 ? 6 : 4,
    sleepHours: sleep.hours,
    sleepQuality: sleep.quality,
    appetite: 5,
    energy,
    irritability,
    cravingsImpulsivity: cravings,
    sideEffectsChecklist: [],
    sideEffectsText: "",
    trainingNotes: "",
    gotOutOfBedOnTime: mood.score >= 6,
    selfCareCompleted: mood.score >= 6,
    keyTaskCompleted: mood.score >= 6,
    exerciseOrWalkDone: false,
    avoidedImpulsiveBehaviour: anxiety.score <= 6,
    socialContactLevel,
    functionScore: mood.score >= 8 ? 4 : mood.score >= 6 ? 3 : 2,
    vitals: {
      weight: "",
      bpSystolic: "",
      bpDiastolic: "",
      hr: ""
    },
    entryMode: "quick_30s"
  };
}

function upsertDailyCheckin(payloadInput) {
  const payloadSource = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
  const duplicate = app.ownerData.checkins.find((entry) => entry.date === payloadSource.date);
  const nowIso = isoDateTime(new Date());
  const payload = normalizeCheckin({
    ...payloadSource,
    id: duplicate?.id || payloadSource.id || uid(),
    createdAt: duplicate?.createdAt || payloadSource.createdAt || nowIso,
    updatedAt: nowIso
  });
  if (duplicate) {
    app.ownerData.checkins = app.ownerData.checkins.map((entry) => (entry.id === duplicate.id ? payload : entry));
  } else {
    app.ownerData.checkins.push(payload);
  }
  return { duplicate, payload };
}

function resolveDataConfidence(quality) {
  const indicators = quality || {};
  const checkinDays = Number(indicators.checkinDays || 0);
  const missingDoseLogs = Number(indicators.missingDoseLogs || 0);
  const incomplete = Number(indicators.incompleteExperiments || 0);
  const lowConfidence = Number(indicators.lowConfidenceEntries || 0);

  if (checkinDays < DATA_CONFIDENCE_MIN_CHECKINS || missingDoseLogs > 8 || incomplete > 0 || lowConfidence > 2) {
    return {
      level: "low",
      label: "Low confidence",
      summary: "Sparse coverage detected. Treat trend direction as provisional."
    };
  }

  if (checkinDays < 7 || missingDoseLogs > 3 || lowConfidence > 0) {
    return {
      level: "medium",
      label: "Moderate confidence",
      summary: "Useful directional signal, but some gaps remain."
    };
  }

  return {
    level: "high",
    label: "High confidence",
    summary: "Coverage is stable enough for directional review."
  };
}

function renderDataConfidenceBanner(quality, contextLabel = "selected window") {
  const confidence = resolveDataConfidence(quality);
  return `
    <div class="confidence-banner confidence-${escapeHtml(confidence.level)}" role="status" aria-live="polite">
      <strong>Data confidence (${escapeHtml(contextLabel)}): ${escapeHtml(confidence.label)}.</strong>
      <span>${escapeHtml(confidence.summary)}</span>
      <span>Check-ins ${escapeHtml(String(quality?.checkinDays ?? 0))}, missing dose logs ${escapeHtml(String(quality?.missingDoseLogs ?? 0))}, low-confidence entries ${escapeHtml(String(quality?.lowConfidenceEntries ?? 0))}.</span>
    </div>
  `;
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
          <div><label>Onset after dose (minutes)</label><input name="onsetAfterDoseMinutes" type="number" min="0" value="${escapeHtml(draft.onsetAfterDoseMinutes || "")}"></div>
          <div>
            <label>Time of day</label>
            <select name="timeOfDay">
              ${["", "morning", "afternoon", "evening", "night"].map((value) => `<option value="${value}" ${String(draft.timeOfDay || "") === value ? "selected" : ""}>${escapeHtml(value || "unspecified")}</option>`).join("")}
            </select>
          </div>
          <div><label>Duration (minutes, optional)</label><input name="durationMinutes" type="number" min="0" value="${escapeHtml(draft.durationMinutes || "")}"></div>
          <div>
            <label>Medication-link confidence</label>
            <select name="confidenceRelatedToMed">
              ${["low", "medium", "high"].map((level) => `<option value="${level}" ${String(draft.confidenceRelatedToMed || "medium") === level ? "selected" : ""}>${escapeHtml(level)}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>Impact on function</label>
            <select name="impactOnFunction">
              ${["low", "medium", "high"].map((level) => `<option value="${level}" ${String(draft.impactOnFunction || "medium") === level ? "selected" : ""}>${escapeHtml(level)}</option>`).join("")}
            </select>
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

  if (app.ui.checkinQuickMode) {
    return renderQuickCheckin30sForm();
  }

  const draft = buildCheckinDraftDefaults(data, app.drafts.checkin || {});
  return `
    <form id="formCheckin" class="card">
      <h3>Daily Wellbeing Check-in</h3>
      <div class="checkin-mode-switch">
        <button class="btn btn-primary small" type="button" data-checkin-mode="full">Full check-in</button>
        <button class="btn btn-ghost small" type="button" data-checkin-mode="quick">30-second mode</button>
      </div>
      <div class="inline-row">
        <button class="btn btn-ghost small" type="button" id="applyLastCheckinDefaults">Use last check-in values</button>
        <button class="btn btn-ghost small" type="button" id="resetCheckinDefaults">Reset to neutral</button>
      </div>
      <div class="field-grid">
        <div><label>Date</label><input name="date" type="date" value="${escapeHtml(draft.date || isoDate(new Date()))}" required></div>
        <div><label>Mood (0-10)</label><input name="mood" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.mood, 6))}" required></div>
        <div><label>Anxiety (0-10)</label><input name="anxiety" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.anxiety, 5))}" required></div>
        <div><label>Focus (0-10)</label><input name="focus" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.focus, 6))}" required></div>
        <div><label>Sleep hours</label><input name="sleepHours" type="number" step="0.1" min="0" max="24" value="${escapeHtml(valueOrDefault(draft.sleepHours, 7))}" required></div>
        <div><label>Sleep quality (0-10)</label><input name="sleepQuality" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.sleepQuality, 6))}" required></div>
        <div><label>Appetite (0-10)</label><input name="appetite" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.appetite, 5))}" required></div>
        <div><label>Energy (0-10)</label><input name="energy" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.energy, 6))}" required></div>
        <div><label>Irritability (0-10)</label><input name="irritability" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.irritability, 4))}" required></div>
        <div><label>Cravings / impulsivity (0-10)</label><input name="cravingsImpulsivity" type="number" min="0" max="10" value="${escapeHtml(valueOrDefault(draft.cravingsImpulsivity, 4))}" required></div>
        <div>
          <label>Social contact</label>
          <select name="socialContactLevel">
            ${["none", "limited", "normal"].map((level) => `<option value="${level}" ${String(draft.socialContactLevel || "limited") === level ? "selected" : ""}>${escapeHtml(level)}</option>`).join("")}
          </select>
        </div>
      </div>

      <label style="margin-top:10px;">Daily function (quick taps)</label>
      <div class="checklist">
        <label class="check-item">
          <input type="checkbox" name="gotOutOfBedOnTime" ${draft.gotOutOfBedOnTime ? "checked" : ""}>
          <span>Got out of bed on time</span>
        </label>
        <label class="check-item">
          <input type="checkbox" name="selfCareCompleted" ${draft.selfCareCompleted ? "checked" : ""}>
          <span>Self-care completed</span>
        </label>
        <label class="check-item">
          <input type="checkbox" name="keyTaskCompleted" ${draft.keyTaskCompleted ? "checked" : ""}>
          <span>Key task completed</span>
        </label>
        <label class="check-item">
          <input type="checkbox" name="exerciseOrWalkDone" ${draft.exerciseOrWalkDone ? "checked" : ""}>
          <span>Exercise or walk completed</span>
        </label>
        <label class="check-item">
          <input type="checkbox" name="avoidedImpulsiveBehaviour" ${draft.avoidedImpulsiveBehaviour ? "checked" : ""}>
          <span>Avoided impulsive behaviour</span>
        </label>
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
        <div><label>Linked medication (optional)</label><input name="sideEffectMedication" list="commonMedicationNames" value="${escapeHtml(valueOrDefault(draft.sideEffectMedication, ""))}" placeholder="Optional medication link"></div>
        <div><label>Side effect onset after dose (minutes)</label><input name="onsetAfterDoseMinutes" type="number" min="0" value="${escapeHtml(valueOrDefault(draft.onsetAfterDoseMinutes, ""))}"></div>
        <div>
          <label>Side effect time of day</label>
          <select name="timeOfDay">
            ${["", "morning", "afternoon", "evening", "night"].map((value) => `<option value="${value}" ${String(draft.timeOfDay || "") === value ? "selected" : ""}>${escapeHtml(value || "unspecified")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Medication-link confidence</label>
          <select name="confidenceRelatedToMed">
            ${["low", "medium", "high"].map((value) => `<option value="${value}" ${String(draft.confidenceRelatedToMed || "medium") === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Functional impact</label>
          <select name="impactOnFunction">
            ${["low", "medium", "high"].map((value) => `<option value="${value}" ${String(draft.impactOnFunction || "medium") === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
          </select>
        </div>
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

function renderQuickCheckin30sForm() {
  const draft = normalizeQuickCheckin30sDraft(app.drafts.checkinQuick || DEFAULT_QUICK_CHECKIN_30S_STATE);
  const selectionsDone = Number(Boolean(draft.mood)) + Number(Boolean(draft.anxiety)) + Number(Boolean(draft.sleep));
  const isComplete = selectionsDone === 3;
  const renderQuickGroup = (field, label, options) => `
    <div class="quick30-group">
      <div class="quick30-label">${escapeHtml(label)}</div>
      <div class="chip-group">
        ${options.map((option) => `
          <button
            class="chip ${String(draft[field] || "") === option.value ? "active" : ""}"
            type="button"
            data-quick-checkin-field="${escapeHtml(field)}"
            data-quick-checkin-value="${escapeHtml(option.value)}"
          >
            ${escapeHtml(option.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;

  return `
    <form id="formCheckinQuick" class="card quick30-card">
      <h3>Daily Wellbeing Check-in (30-second mode)</h3>
      <p class="helper-text">Three taps only: mood, anxiety, sleep. The check-in saves automatically when all three are selected.</p>
      <div class="checkin-mode-switch">
        <button class="btn btn-ghost small" type="button" data-checkin-mode="full">Full check-in</button>
        <button class="btn btn-primary small" type="button" data-checkin-mode="quick">30-second mode</button>
      </div>
      <div class="field-grid">
        <div>
          <label for="quickCheckinDate">Date</label>
          <input id="quickCheckinDate" name="date" type="date" value="${escapeHtml(draft.date || isoDate(new Date()))}" required>
        </div>
      </div>
      ${renderQuickGroup("mood", "Mood", QUICK_CHECKIN_30S_OPTIONS.mood)}
      ${renderQuickGroup("anxiety", "Anxiety", QUICK_CHECKIN_30S_OPTIONS.anxiety)}
      ${renderQuickGroup("sleep", "Sleep", QUICK_CHECKIN_30S_OPTIONS.sleep)}
      <div class="quick30-progress">
        <span>${selectionsDone}/3 selected</span>
        <span>${isComplete ? "Saving now..." : "Select all three to save."}</span>
      </div>
      <div class="inline-row">
        <button class="btn btn-secondary small" type="button" data-quick-checkin-clear="1">Clear 30-second draft</button>
      </div>
    </form>
  `;
}

function bindWorkflowFormHandlers(root, data) {
  root.querySelectorAll("[data-checkin-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = String(button.dataset.checkinMode || "full");
      app.ui.checkinQuickMode = mode === "quick";
      if (!app.ui.checkinQuickMode) {
        app.drafts.checkinQuick = { ...DEFAULT_QUICK_CHECKIN_30S_STATE };
        saveDrafts();
      }
      renderAll();
    });
  });

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
        dateEffective: values.date,
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

      app.ownerData.medicationChangeExperiments.push(normalizeMedicationChangeExperiment({
        id: uid(),
        medicationId: medication?.id || "",
        medicationName: values.medicationName,
        dateEffective: values.date,
        oldDose: values.oldDose,
        newDose: values.newDose,
        route: values.route || "",
        changedBy: values.changedBy || "self",
        reasonForChange: values.reason,
        expectedBenefit: values.expectedEffects || "",
        expectedSideEffects: "",
        whatToMonitor: values.monitorFor || values.monitor || "",
        reviewDate: values.reviewDate || "",
        outcomeStatus: "pending",
        outcomeNotes: values.notes || "",
        confidenceInOutcome: "medium",
        linkedChangeId: app.ownerData.changes[app.ownerData.changes.length - 1]?.id || "",
        createdAt: isoDateTime(new Date()),
        updatedAt: isoDateTime(new Date())
      }));

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

      if (values.noteType === "side_effect") {
        const onset = Number(values.onsetAfterDoseMinutes);
        const duration = Number(values.durationMinutes);
        const symptomNames = checklist.length ? checklist : ["general side effect note"];
        symptomNames.forEach((symptom) => {
          app.ownerData.sideEffectEvents.push(normalizeSideEffectEvent({
            id: uid(),
            date: values.date,
            symptomName: symptom,
            severity: values.severity === "high" ? 8 : values.severity === "moderate" ? 5 : 3,
            linkedMedication: values.medicationName || "",
            onsetAfterDoseMinutes: Number.isFinite(onset) ? onset : null,
            timeOfDay: values.timeOfDay || "",
            durationMinutes: Number.isFinite(duration) ? duration : null,
            confidenceRelatedToMed: values.confidenceRelatedToMed || "medium",
            impactOnFunction: values.impactOnFunction || "medium",
            note: values.noteText || "",
            createdAt: isoDateTime(new Date())
          }));
        });
      }

      saveOwnerData(app.ownerData);
      app.drafts.note = {};
      saveDrafts();
      setStatus("Effects note logged.");
      renderAll();
    });
  }

  const quickCheckinForm = root.querySelector("#formCheckinQuick");
  if (quickCheckinForm) {
    const writeQuickDraft = (nextDraft) => {
      app.drafts.checkinQuick = normalizeQuickCheckin30sDraft(nextDraft);
      saveDrafts();
    };

    const tryAutoSaveQuickCheckin = () => {
      const draft = normalizeQuickCheckin30sDraft(app.drafts.checkinQuick || {});
      const payload = buildQuickCheckin30sPayload(draft);
      if (!payload) {
        renderAll();
        return;
      }

      upsertDailyCheckin(payload);
      saveOwnerData(app.ownerData);
      app.drafts.checkinQuick = { ...DEFAULT_QUICK_CHECKIN_30S_STATE, date: draft.date || isoDate(new Date()) };
      app.ui.checkinQuickMode = false;
      saveDrafts();
      setStatus("30-second check-in saved.");
      app.ui.activeSection = "dashboard";
      renderAll();
    };

    quickCheckinForm.querySelector("#quickCheckinDate")?.addEventListener("change", (event) => {
      writeQuickDraft({
        ...(app.drafts.checkinQuick || {}),
        date: String(event.target.value || isoDate(new Date()))
      });
    });

    quickCheckinForm.querySelectorAll("[data-quick-checkin-field]").forEach((button) => {
      button.addEventListener("click", () => {
        const field = String(button.dataset.quickCheckinField || "");
        const value = String(button.dataset.quickCheckinValue || "");
        if (!["mood", "anxiety", "sleep"].includes(field)) return;
        writeQuickDraft({
          ...(app.drafts.checkinQuick || {}),
          date: String(quickCheckinForm.elements.date?.value || isoDate(new Date())),
          [field]: value
        });
        tryAutoSaveQuickCheckin();
      });
    });

    quickCheckinForm.querySelectorAll("[data-quick-checkin-clear]").forEach((button) => {
      button.addEventListener("click", () => {
        app.drafts.checkinQuick = { ...DEFAULT_QUICK_CHECKIN_30S_STATE, date: isoDate(new Date()) };
        saveDrafts();
        setStatus("30-second draft cleared.");
        renderAll();
      });
    });
  }

  const checkinForm = root.querySelector("#formCheckin");
  if (checkinForm) {
    const writeCheckinDraftFromForm = () => {
      app.drafts.checkin = formToObject(checkinForm);
      app.drafts.checkin.sideEffectsChecklist = checkedValues(checkinForm, "sideEffectsChecklist");
      app.drafts.checkin.gotOutOfBedOnTime = Boolean(checkinForm.elements.gotOutOfBedOnTime?.checked);
      app.drafts.checkin.selfCareCompleted = Boolean(checkinForm.elements.selfCareCompleted?.checked);
      app.drafts.checkin.keyTaskCompleted = Boolean(checkinForm.elements.keyTaskCompleted?.checked);
      app.drafts.checkin.exerciseOrWalkDone = Boolean(checkinForm.elements.exerciseOrWalkDone?.checked);
      app.drafts.checkin.avoidedImpulsiveBehaviour = Boolean(checkinForm.elements.avoidedImpulsiveBehaviour?.checked);
      saveDrafts();
    };

    const applyCheckinPreset = (preset) => {
      const entries = Object.entries(preset || {});
      for (const [key, value] of entries) {
        if (key === "sideEffectsChecklist") continue;
        if (!checkinForm.elements[key]) continue;
        const control = checkinForm.elements[key];
        if (control.type === "checkbox") {
          control.checked = Boolean(value);
        } else {
          control.value = value;
        }
      }
      if (Array.isArray(preset?.sideEffectsChecklist)) {
        const selected = new Set(preset.sideEffectsChecklist.map((item) => String(item)));
        checkinForm.querySelectorAll('input[name="sideEffectsChecklist"]').forEach((input) => {
          input.checked = selected.has(String(input.value));
        });
      }
      writeCheckinDraftFromForm();
    };

    root.querySelector("#applyLastCheckinDefaults")?.addEventListener("click", () => {
      const latest = buildCheckinDraftDefaults(data, {});
      applyCheckinPreset(latest);
      setStatus("Applied last check-in values.");
    });

    root.querySelector("#resetCheckinDefaults")?.addEventListener("click", () => {
      applyCheckinPreset({
        date: isoDate(new Date()),
        mood: 6,
        anxiety: 5,
        focus: 6,
        sleepHours: 7,
        sleepQuality: 6,
        appetite: 5,
        energy: 6,
        irritability: 4,
        cravingsImpulsivity: 4,
        sideEffectsChecklist: [],
        sideEffectsText: "",
        trainingNotes: "",
        weight: "",
        bpSystolic: "",
        bpDiastolic: "",
        hr: ""
      });
      setStatus("Check-in fields reset to neutral defaults.");
    });

    checkinForm.addEventListener("input", () => {
      writeCheckinDraftFromForm();
    });

    checkinForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = formToObject(checkinForm);
      const checklist = checkedValues(checkinForm, "sideEffectsChecklist");

      const rangeValid = ["mood", "anxiety", "focus", "sleepQuality", "appetite", "energy", "irritability", "cravingsImpulsivity"].every((field) => {
        const value = Number(values[field]);
        return Number.isFinite(value) && value >= 0 && value <= 10;
      });

      if (!rangeValid) {
        return setStatus("Validation failed: 0-10 fields must be within range.", "error");
      }

      const nowIso = isoDateTime(new Date());
      const functionChecks = [
        Boolean(checkinForm.elements.gotOutOfBedOnTime?.checked),
        Boolean(checkinForm.elements.selfCareCompleted?.checked),
        Boolean(checkinForm.elements.keyTaskCompleted?.checked),
        Boolean(checkinForm.elements.exerciseOrWalkDone?.checked),
        Boolean(checkinForm.elements.avoidedImpulsiveBehaviour?.checked)
      ];
      const derivedFunctionScore = functionChecks.reduce((sum, value) => sum + Number(value), 0);
      const { duplicate } = upsertDailyCheckin({
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
        gotOutOfBedOnTime: Boolean(checkinForm.elements.gotOutOfBedOnTime?.checked),
        selfCareCompleted: Boolean(checkinForm.elements.selfCareCompleted?.checked),
        keyTaskCompleted: Boolean(checkinForm.elements.keyTaskCompleted?.checked),
        exerciseOrWalkDone: Boolean(checkinForm.elements.exerciseOrWalkDone?.checked),
        avoidedImpulsiveBehaviour: Boolean(checkinForm.elements.avoidedImpulsiveBehaviour?.checked),
        socialContactLevel: values.socialContactLevel || "limited",
        functionScore: derivedFunctionScore,
        entryMode: "full",
        vitals: {
          weight: values.weight || "",
          bpSystolic: values.bpSystolic || "",
          bpDiastolic: values.bpDiastolic || "",
          hr: values.hr || ""
        }
      });

      const sideEffectText = String(values.sideEffectsText || "").trim();
      if (checklist.length || sideEffectText) {
        const medicationName = String(values.sideEffectMedication || "").trim();
        const onset = Number(values.onsetAfterDoseMinutes);
        const commonMeta = {
          date: values.date,
          linkedMedication: medicationName,
          onsetAfterDoseMinutes: Number.isFinite(onset) ? onset : null,
          timeOfDay: values.timeOfDay || "",
          confidenceRelatedToMed: values.confidenceRelatedToMed || "medium",
          impactOnFunction: values.impactOnFunction || "medium",
          createdAt: nowIso
        };
        if (checklist.length) {
          checklist.forEach((symptom) => {
            app.ownerData.sideEffectEvents.push(normalizeSideEffectEvent({
              id: uid(),
              symptomName: symptom,
              severity: 5,
              note: sideEffectText,
              ...commonMeta
            }));
          });
        } else {
          app.ownerData.sideEffectEvents.push(normalizeSideEffectEvent({
            id: uid(),
            symptomName: "general side effect note",
            severity: 5,
            note: sideEffectText,
            ...commonMeta
          }));
        }
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
  const robotsMeta = String(document.querySelector("meta[name='robots']")?.getAttribute("content") || "index, follow").toLowerCase();
  const siteVisibilityLabel = robotsMeta.includes("noindex") ? "Private (search engines blocked)" : "Public (indexable)";
  const warningSigns = normalizeWarningSigns(app.ownerData.warningSigns);
  const riskConfig = normalizeRiskConfig(app.ownerData.riskConfig);
  const shareLinksForPreview = app.ownerData.shareLinks.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    <div id="cloudAccountCard" class="card">
      <h3>Cloud account and invites</h3>
      ${LOCAL_ONLY_MODE
        ? `<div class="context-block">
            Local-only mode is active in this build, so cloud registration, sign-in, and invites are disabled here.
            To enable cloud account + invites, set <code>LOCAL_ONLY_MODE = false</code> in <code>app.js</code> and connect the API endpoint.
          </div>`
        : ""}
      <div class="${LOCAL_ONLY_MODE ? "hidden" : ""}">
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
    </div>

    <div class="card">
      <h3>Preview shared link</h3>
      <p class="subtle">Open a recipient-safe read-only preview from here.</p>
      ${shareLinksForPreview.length ? `
        <div class="field-grid">
          <div>
            <label for="sharePreviewSelect">Select recipient link</label>
            <select id="sharePreviewSelect">
              ${shareLinksForPreview.map((link) => {
                const expired = link.expiresAt && new Date(link.expiresAt).getTime() < Date.now();
                const status = link.revoked ? "revoked" : expired ? "expired" : "active";
                return `<option value="${link.id}">${escapeHtml(link.name)} (${escapeHtml(status)})</option>`;
              }).join("")}
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <button class="btn btn-secondary" type="button" id="openSharePreviewButton">Preview as recipient</button>
          </div>
        </div>
      ` : `<div class="empty">No share links yet. Create one below, then preview it here.</div>`}
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
        <div>
          <label for="themePreference">Theme</label>
          <select id="themePreference">
            <option value="light" ${ownerProfile.themePreference === "light" ? "selected" : ""}>Light</option>
            <option value="dark" ${ownerProfile.themePreference === "dark" ? "selected" : ""}>Dark</option>
            <option value="system" ${ownerProfile.themePreference === "system" ? "selected" : ""}>System</option>
          </select>
          <p class="helper-text">Applies instantly and stays saved on this device.</p>
        </div>
      </div>
      <div class="inline-row" style="margin-top:10px;">
        <button class="btn btn-secondary" type="button" id="saveProfileSettingsButton">Save personalization</button>
      </div>
      <p class="helper-text" style="margin-top:8px;">Search visibility: ${escapeHtml(siteVisibilityLabel)}</p>
      ${LOCAL_ONLY_MODE
        ? `<p class="helper-text" style="margin-top:10px;">Local-only mode is active. No login or cloud account setup is required.</p>`
        : ""}

      <div id="syncSettingsBlock" class="${LOCAL_ONLY_MODE ? "hidden" : ""}">
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
            <input type="checkbox" id="quietUntilOverdueEnabled" ${reminderSettings.quietUntilOverdue ? "checked" : ""}>
            <span>Quiet reminders until overdue</span>
          </label>
        </div>
        <div>
          <label for="overdueEscalationMinutes">Escalate when overdue by</label>
          <select id="overdueEscalationMinutes">
            ${[0, 5, 10, 15, 30, 45, 60].map((mins) => `<option value="${mins}" ${Number(reminderSettings.overdueEscalationMinutes) === mins ? "selected" : ""}>${mins === 0 ? "Immediately at due time" : `${mins} minutes`}</option>`).join("")}
          </select>
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
          <div>
            <label>Landing section</label>
            <select name="startSection">
              <option value="dashboard" ${String(draftShare.startSection || "dashboard") === "dashboard" ? "selected" : ""}>Dashboard</option>
              <option value="consult" ${String(draftShare.startSection || "") === "consult" ? "selected" : ""}>Consult</option>
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
  const sharePreviewSelect = root.querySelector("#sharePreviewSelect");
  const openSharePreviewButton = root.querySelector("#openSharePreviewButton");
  const presetSelect = root.querySelector("#sharePresetSelect");
  const syncEnabled = root.querySelector("#syncEnabled");
  const syncEndpoint = root.querySelector("#syncEndpoint");
  const syncAccountId = root.querySelector("#syncAccountId");
  const syncOwnerKey = root.querySelector("#syncOwnerKey");
  const ownerDisplayName = root.querySelector("#ownerDisplayName");
  const personalizationEnabled = root.querySelector("#personalizationEnabled");
  const themePreference = root.querySelector("#themePreference");
  const remindersEnabled = root.querySelector("#remindersEnabled");
  const reminderLeadMinutes = root.querySelector("#reminderLeadMinutes");
  const desktopNotificationsEnabled = root.querySelector("#desktopNotificationsEnabled");
  const quietUntilOverdueEnabled = root.querySelector("#quietUntilOverdueEnabled");
  const overdueEscalationMinutes = root.querySelector("#overdueEscalationMinutes");
  const riskAlertsEnabled = root.querySelector("#riskAlertsEnabled");
  const riskAlertsMinLevel = root.querySelector("#riskAlertsMinLevel");
  const syncReminderModeControls = () => {
    if (!overdueEscalationMinutes) return;
    overdueEscalationMinutes.disabled = !quietUntilOverdueEnabled?.checked;
  };
  syncReminderModeControls();
  quietUntilOverdueEnabled?.addEventListener("change", syncReminderModeControls);
  const requireCloudEndpoint = () => {
    if (normalizedApiBase()) return true;
    setStatus("Set your API endpoint first: Share -> Settings, then save sync settings.", "error");
    return false;
  };

  openSharePreviewButton?.addEventListener("click", () => {
    const id = String(sharePreviewSelect?.value || "");
    const link = app.ownerData.shareLinks.find((entry) => entry.id === id);
    if (!link) {
      setStatus("Select a valid shared link to preview.", "error");
      return;
    }
    app.ui.viewerMode = "preview_link";
    app.ui.previewLinkId = link.id;
    app.ui.activeSection = link.startSection === "consult" ? "consult" : "dashboard";
    ensureSectionForCurrentMode();
    setStatus(`Previewing as ${link.name}.`);
    renderAll();
  });

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
    if (!requireCloudEndpoint()) return;
    const values = formToObject(cloudRegisterForm);
    void (async () => {
      setFormBusy(cloudRegisterForm, true, "Registering...");
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
      } finally {
        setFormBusy(cloudRegisterForm, false);
      }
    })();
  });

  cloudLoginForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled in this build.", "error");
      return;
    }
    if (!requireCloudEndpoint()) return;
    const values = formToObject(cloudLoginForm);
    void (async () => {
      setFormBusy(cloudLoginForm, true, "Signing in...");
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
      } finally {
        setFormBusy(cloudLoginForm, false);
      }
    })();
  });

  cloudAcceptInviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (LOCAL_ONLY_MODE) {
      setStatus("Cloud sync is disabled in this build.", "error");
      return;
    }
    if (!requireCloudEndpoint()) return;
    const values = formToObject(cloudAcceptInviteForm);
    void (async () => {
      setFormBusy(cloudAcceptInviteForm, true, "Accepting...");
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
      } finally {
        setFormBusy(cloudAcceptInviteForm, false);
      }
    })();
  });

  cloudCreateInviteForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireCloudEndpoint()) return;
    const values = formToObject(cloudCreateInviteForm);
    void (async () => {
      setFormBusy(cloudCreateInviteForm, true, "Creating...");
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
      } finally {
        setFormBusy(cloudCreateInviteForm, false);
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
      personalizationEnabled: Boolean(personalizationEnabled?.checked),
      themePreference: String(themePreference?.value || "light")
    });
    saveOwnerData(app.ownerData);
    setStatus("Personalization settings saved.");
    renderAll();
  });

  themePreference?.addEventListener("change", () => {
    applyThemePreference({
      ...ownerProfile,
      themePreference: String(themePreference.value || "light")
    });
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
      quietUntilOverdue: quietUntilOverdueEnabled?.checked,
      overdueEscalationMinutes: Number(overdueEscalationMinutes?.value || 10),
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
    const preferredSection = presetSelect.value === "clinician" ? "consult" : "dashboard";
    app.drafts.sharePermissions = normalizePermissions(preset.permissions);
    app.drafts.share = {
      ...formToObject(shareForm),
      allowedModes: preset.defaultModes,
      startSection: preferredSection
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
      startSection: String(values.startSection || "dashboard") === "consult" ? "consult" : "dashboard",
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
      startSection: String(values.startSection || "dashboard") === "consult" ? "consult" : "dashboard",
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
      app.ui.activeSection = link.startSection === "consult" ? "consult" : "dashboard";
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
          <div class="subtle">Landing: ${escapeHtml(link.startSection === "consult" ? "Consult summary" : "Dashboard")}</div>
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
    experiments: resolveExperimentRows(data).filter((entry) => inRange(entry.dateEffective || entry.date)).sort((a, b) => b.dateEffective.localeCompare(a.dateEffective)),
    checkins: (data.checkins || []).filter((entry) => inRange(entry.date)).sort((a, b) => b.date.localeCompare(a.date)),
    notes: (data.notes || []).filter((entry) => inRange(entry.date)).sort((a, b) => b.date.localeCompare(a.date)),
    adherence: (data.adherence || []).filter((entry) => inRange(entry.date)),
    sideEffectEvents: (data.sideEffectEvents || []).filter((entry) => inRange(String(entry.date || entry.createdAt || "").slice(0, 10))),
    consultQuestions: (data.consultQuestions || []).filter((entry) => inRange(String(entry.createdAt || "").slice(0, 10))),
    decisionLog: (data.decisionLog || []).filter((entry) => inRange(entry.appointmentDate)).sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate))
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

function renderExports(root, data, context) {
  const allowedModes = (context?.allowedModes || ["daily", "clinical", "personal"])
    .filter((mode) => VIEW_MODE_META[mode]);
  root.innerHTML = `
    <div class="card">
      <h3>Display preferences</h3>
      <div class="field-grid">
        <div>
          <label for="settingsDataViewSelect">Data View</label>
          <select id="settingsDataViewSelect">
            ${allowedModes.map((mode) => `<option value="${mode}" ${app.ui.activeViewMode === mode ? "selected" : ""}>${escapeHtml(VIEW_MODE_META[mode].label)}</option>`).join("")}
          </select>
          <p class="helper-text">Move between Daily, Clinical, and Personal detail depth from Settings.</p>
        </div>
      </div>
    </div>

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

  root.querySelector("#settingsDataViewSelect")?.addEventListener("change", (event) => {
    const next = String(event.target.value || "daily");
    if (!allowedModes.includes(next)) return;
    app.ui.activeViewMode = next;
    ensureSectionForCurrentMode();
    setStatus(`Data view set to ${VIEW_MODE_META[next].label}.`);
    renderAll();
  });

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
      function_score: entry.functionScore ?? "",
      social_contact_level: entry.socialContactLevel || "",
      entry_mode: entry.entryMode || "full",
      got_out_of_bed_on_time: entry.gotOutOfBedOnTime ? "yes" : "no",
      self_care_completed: entry.selfCareCompleted ? "yes" : "no",
      key_task_completed: entry.keyTaskCompleted ? "yes" : "no",
      exercise_or_walk_done: entry.exerciseOrWalkDone ? "yes" : "no",
      avoided_impulsive_behaviour: entry.avoidedImpulsiveBehaviour ? "yes" : "no",
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
  const experimentRows = snapshot.experiments.slice(0, 24);
  const recentCheckins = snapshot.checkins.slice(0, 30);
  const notes = snapshot.notes.slice(0, 20);
  const sideEffectRows = summarizeSideEffects(snapshot.sideEffectEvents || []).slice(0, 20);
  const openQuestions = (snapshot.consultQuestions || [])
    .filter((entry) => String(entry.status || "").toLowerCase() === "open")
    .slice(0, 24);
  const decisionRows = (snapshot.decisionLog || []).slice(0, 20);
  const consultConfig = normalizeConsultConfig(data.consultConfig);
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

        <h2>Medication Change Experiments</h2>
        <table>
          <thead><tr><th>Date</th><th>Medication</th><th>Change</th><th>Expected benefit</th><th>Expected side effects</th><th>Outcome</th><th>Confidence</th></tr></thead>
          <tbody>
            ${(experimentRows.length ? experimentRows : []).map((row) => `<tr><td>${escapeHtml(niceDate(row.dateEffective))}</td><td>${escapeHtml(row.medicationName || "-")}</td><td>${escapeHtml(row.oldDose || "-")} → ${escapeHtml(row.newDose || "-")}</td><td>${escapeHtml(row.expectedBenefit || "-")}</td><td>${escapeHtml(row.expectedSideEffects || "-")}</td><td>${escapeHtml(row.outcomeStatus || "pending")}</td><td>${escapeHtml(row.confidenceInOutcome || "-")}</td></tr>`).join("") || `<tr><td colspan="7">No experiment entries in this range.</td></tr>`}
          </tbody>
        </table>

        <h2>Side Effect Timing Summary</h2>
        <table>
          <thead><tr><th>Medication</th><th>Timing</th><th>Frequency</th><th>Avg severity</th><th>Top symptom</th></tr></thead>
          <tbody>
            ${(sideEffectRows.length ? sideEffectRows : []).map((row) => `<tr><td>${escapeHtml(row.medication)}</td><td>${escapeHtml(row.timing)}</td><td>${row.count}</td><td>${escapeHtml(String(row.avgSeverity))}</td><td>${escapeHtml(row.topSymptom)}</td></tr>`).join("") || `<tr><td colspan="5">No side-effect timing events in this range.</td></tr>`}
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

        <h2>Question Queue (Open)</h2>
        <table>
          <thead><tr><th>Created</th><th>Question</th><th>Category</th><th>Urgency</th><th>Medication</th><th>Note</th></tr></thead>
          <tbody>
            ${(openQuestions.length ? openQuestions : []).map((row) => `<tr><td>${escapeHtml(niceDateTime(row.createdAt || ""))}</td><td>${escapeHtml(row.text || "-")}</td><td>${escapeHtml(row.category || "-")}</td><td>${escapeHtml(row.urgency || "-")}</td><td>${escapeHtml(row.linkedMedication || "-")}</td><td>${escapeHtml(row.note || "-")}</td></tr>`).join("") || `<tr><td colspan="6">No open questions.</td></tr>`}
          </tbody>
        </table>

        <h2>Decision Log</h2>
        <table>
          <thead><tr><th>Appointment</th><th>Clinician</th><th>Decision summary</th><th>Plan</th><th>Follow-up</th></tr></thead>
          <tbody>
            ${(decisionRows.length ? decisionRows : []).map((row) => `<tr><td>${escapeHtml(niceDate(row.appointmentDate))}</td><td>${escapeHtml(row.clinicianName || "-")}</td><td>${escapeHtml(row.notes || "-")}</td><td>${escapeHtml(row.planUntilNextReview || "-")}</td><td>${escapeHtml(row.followUpDate ? niceDate(row.followUpDate) : "-")}</td></tr>`).join("") || `<tr><td colspan="5">No decision entries in this range.</td></tr>`}
          </tbody>
        </table>

        <h2>What I want to discuss today</h2>
        <p>${escapeHtml(consultConfig.discussToday || "No consult focus text set.")}</p>

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
    clone.sideEffectEvents = (clone.sideEffectEvents || []).map((entry) => ({
      ...entry,
      note: entry.note ? "[Hidden by link settings]" : ""
    }));
    clone.consultQuestions = (clone.consultQuestions || []).map((entry) => ({
      ...entry,
      note: entry.note ? "[Hidden by link settings]" : ""
    }));
    clone.decisionLog = (clone.decisionLog || []).map((entry) => ({
      ...entry,
      notes: entry.notes ? "[Hidden by link settings]" : "",
      rationale: entry.rationale ? "[Hidden by link settings]" : "",
      contingencyPlan: entry.contingencyPlan ? "[Hidden by link settings]" : ""
    }));
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

    saveOwnerData(nextOwnerData, { throwOnPersistFailure: true });
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

  for (const event of Array.isArray(data.sideEffectEvents) ? data.sideEffectEvents : []) {
    const dateKey = String(event?.date || event?.createdAt || "").slice(0, 10);
    if (!dateKey) continue;
    map.set(dateKey, (map.get(dateKey) || 0) + 1);
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

function setFormBusy(form, busy, busyLabel) {
  if (!form) return;
  const controls = form.querySelectorAll("input, select, textarea, button");
  controls.forEach((control) => {
    if (busy) {
      control.dataset.wasDisabled = control.disabled ? "1" : "0";
      control.disabled = true;
    } else {
      control.disabled = control.dataset.wasDisabled === "1";
      delete control.dataset.wasDisabled;
    }
  });

  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    if (busy) {
      submitButton.dataset.originalLabel = submitButton.textContent || "";
      submitButton.textContent = busyLabel || "Saving...";
    } else if (submitButton.dataset.originalLabel) {
      submitButton.textContent = submitButton.dataset.originalLabel;
      delete submitButton.dataset.originalLabel;
    }
  }

  form.setAttribute("aria-busy", busy ? "true" : "false");
}

function pushToast(message, type = "success") {
  if (!dom.toastStack) return;
  const toast = document.createElement("div");
  const normalizedType = ["success", "error", "info", "warning"].includes(type) ? type : "success";
  toast.className = `toast ${normalizedType}`;
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
