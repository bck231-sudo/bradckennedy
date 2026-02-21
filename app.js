const STORAGE_KEY = "medication_tracker_data_v1";
const DRAFT_KEY = "medication_tracker_drafts_v2";
const ACCESS_LOG_KEY = "medication_tracker_access_logs_v1";
const APP_VERSION = 2;

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
  once_morning: { label: "Once daily (morning)", times: ["08:00"] },
  once_evening: { label: "Once daily (evening)", times: ["20:00"] },
  twice_daily: { label: "Twice daily", times: ["08:00", "20:00"] },
  prn: { label: "PRN / as needed", times: [] },
  custom: { label: "Custom", times: [] }
};

const PRESETS = {
  family: {
    label: "Family View",
    defaultModes: ["daily"],
    permissions: {
      showSensitiveNotes: false,
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
      showJournalText: true,
      showLibido: true,
      showSubstance: true,
      showFreeText: true
    }
  }
};

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
    title: "Dashboard",
    subtitle: "Today’s priorities, changes, trends, and sharing status.",
    viewModes: ["daily", "clinical", "personal"]
  },
  {
    id: "medications",
    label: "Current Medications",
    title: "Current Medications",
    subtitle: "Medication list with dose, schedule, and detail pages.",
    viewModes: ["daily", "clinical", "personal"]
  },
  {
    id: "changes",
    label: "Medication Changes",
    title: "Medication Change Log",
    subtitle: "What changed, why, and interpretation cards.",
    viewModes: ["clinical", "personal"]
  },
  {
    id: "checkins",
    label: "Wellbeing Check-ins",
    title: "Daily Wellbeing Check-ins",
    subtitle: "Structured daily symptom and wellbeing tracking.",
    viewModes: ["daily", "clinical", "personal"]
  },
  {
    id: "notes",
    label: "Effects Notes",
    title: "Effects and Side Effects Notes",
    subtitle: "Detailed notes across effects, side effects, and personal observations.",
    viewModes: ["clinical", "personal"]
  },
  {
    id: "timeline",
    label: "Charts & Timeline",
    title: "Charts and Timeline",
    subtitle: "Trends over time with medication change markers.",
    viewModes: ["clinical", "personal"]
  },
  {
    id: "entry",
    label: "Add Entries",
    title: "Add Entry Workflows",
    subtitle: "Separate structured workflows for clean data capture.",
    viewModes: ["daily", "clinical", "personal"],
    ownerOnly: true
  },
  {
    id: "sharing",
    label: "Sharing",
    title: "Sharing and Permissions",
    subtitle: "Create and manage read-only links with role presets.",
    viewModes: ["clinical", "personal"],
    ownerOnly: true
  },
  {
    id: "exports",
    label: "Exports",
    title: "Exports",
    subtitle: "Clinician summary and backup exports.",
    viewModes: ["clinical", "personal"]
  }
];

const dom = {
  viewModeSelect: document.getElementById("viewModeSelect"),
  previewSelect: document.getElementById("previewSelect"),
  ownerPreviewControl: document.getElementById("ownerPreviewControl"),
  sectionNav: document.getElementById("sectionNav"),
  contextPill: document.getElementById("contextPill"),
  sectionTitle: document.getElementById("sectionTitle"),
  sectionSubtitle: document.getElementById("sectionSubtitle"),
  quickCheckinButton: document.getElementById("quickCheckinButton"),
  readOnlyBanner: document.getElementById("readOnlyBanner"),
  globalStatus: document.getElementById("globalStatus"),
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
  ui: {
    activeViewMode: "daily",
    activeSection: "dashboard",
    entryWorkflow: "medication",
    previewPreset: "owner",
    comparisonChangeId: ""
  },
  statusTimeout: null
};

if (app.shareSession) {
  handleShareSessionInit();
}

hydrateMedicationNameOptions();
bindGlobalHandlers();
bindShareHashListener();
renderAll();

function loadOwnerData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = buildSeedState();
    saveOwnerData(seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    const migrated = migrateToV2(parsed);
    saveOwnerData(migrated);
    return migrated;
  } catch (_error) {
    const fallback = buildSeedState();
    saveOwnerData(fallback);
    return fallback;
  }
}

function saveOwnerData(nextData) {
  const payload = ensureStateShape(nextData);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function buildSeedState() {
  const now = new Date();
  const today = isoDate(now);
  const daysAgo = (n) => {
    const date = new Date(now);
    date.setDate(date.getDate() - n);
    return isoDate(date);
  };

  const meds = [
    {
      id: uid(),
      name: "Vyvanse",
      genericName: "Lisdexamfetamine",
      route: "oral",
      currentDose: "40 mg",
      schedulePreset: "once_morning",
      scheduleTimes: ["08:00"],
      startDate: daysAgo(70),
      indication: "Attention and daytime focus support",
      moaSimple: [
        "May raise dopamine and norepinephrine levels during the day.",
        "Can improve sustained attention and task initiation in some people."
      ],
      moaTechnical: "Prodrug converted to dextroamphetamine; often increases synaptic catecholamines via transporter-mediated release and reuptake effects. Onset and offset may vary with metabolism and sleep.",
      adjustmentAcute: "Dose increases may quickly feel more activating and may increase appetite suppression or tension in the first days.",
      adjustmentChronic: "Over weeks, focus patterns may stabilize while tolerance and sleep effects can change.",
      commonSideEffects: "Lower appetite, dry mouth, increased heart rate, delayed sleep.",
      monitor: "Sleep duration, appetite, anxiety, heart rate, rebound fatigue.",
      questions: "Is current morning timing still best for afternoon productivity?",
      active: true,
      createdAt: isoDateTime(now),
      updatedAt: isoDateTime(now)
    },
    {
      id: uid(),
      name: "Clonidine",
      genericName: "Clonidine",
      route: "oral",
      currentDose: "150 mcg",
      schedulePreset: "once_evening",
      scheduleTimes: ["21:00"],
      startDate: daysAgo(95),
      indication: "Evening calming and sleep transition support",
      moaSimple: [
        "May reduce arousal and internal restlessness at night.",
        "Can support sleep onset in some situations."
      ],
      moaTechnical: "Alpha-2 adrenergic agonism may reduce central sympathetic signaling, sometimes lowering autonomic arousal and blood pressure.",
      adjustmentAcute: "Dose increases may cause more sedation, dizziness, or dry mouth in the first week.",
      adjustmentChronic: "Sleep-related benefit may become steadier; blood pressure effects may remain relevant.",
      commonSideEffects: "Sedation, dry mouth, dizziness, low blood pressure.",
      monitor: "Morning grogginess, standing dizziness, BP trends.",
      questions: "Could timing be moved slightly earlier to reduce morning grogginess?",
      active: true,
      createdAt: isoDateTime(now),
      updatedAt: isoDateTime(now)
    },
    {
      id: uid(),
      name: "Quetiapine",
      genericName: "Quetiapine",
      route: "oral",
      currentDose: "25 mg PRN",
      schedulePreset: "prn",
      scheduleTimes: [],
      startDate: daysAgo(40),
      indication: "PRN nighttime sedation support",
      moaSimple: [
        "May reduce nighttime agitation and support sleep when needed.",
        "Can be sedating even at lower doses."
      ],
      moaTechnical: "At low doses, antihistaminergic and adrenergic effects may dominate sedation profile; receptor occupancy profile changes with dose.",
      adjustmentAcute: "PRN use can cause next-day sedation or sluggishness in some people.",
      adjustmentChronic: "Regular frequent use patterns may affect daytime energy and appetite over time.",
      commonSideEffects: "Sedation, dry mouth, next-day drowsiness.",
      monitor: "Morning alertness, appetite changes, frequency of PRN use.",
      questions: "When should PRN threshold be reconsidered?",
      active: true,
      createdAt: isoDateTime(now),
      updatedAt: isoDateTime(now)
    }
  ];

  const [vyvanse, clonidine, quetiapine] = meds;

  const changes = [
    createSeedChange(vyvanse, daysAgo(35), "30 mg", "40 mg", "Afternoon focus dropped too early"),
    createSeedChange(vyvanse, daysAgo(14), "40 mg", "40 mg + timing review", "Trying earlier start for smoother afternoon window"),
    createSeedChange(clonidine, daysAgo(21), "100 mcg", "150 mcg", "Night arousal remained high"),
    createSeedChange(quetiapine, daysAgo(9), "12.5 mg PRN", "25 mg PRN", "Low PRN dose had limited effect")
  ];

  const notes = [
    {
      id: uid(),
      date: daysAgo(6),
      medicationId: vyvanse.id,
      medicationName: vyvanse.name,
      noteType: "effect",
      severity: "moderate",
      checklist: ["focus improved"],
      noteText: "Morning initiation felt easier and fewer stalled tasks before lunch.",
      trainingNotes: "Gym session felt easier to start.",
      isSensitive: false,
      createdAt: isoDateTime(now)
    },
    {
      id: uid(),
      date: daysAgo(4),
      medicationId: clonidine.id,
      medicationName: clonidine.name,
      noteType: "side_effect",
      severity: "mild",
      checklist: ["dizziness"],
      noteText: "Mild dizziness on standing after late dose.",
      trainingNotes: "No training that day.",
      isSensitive: false,
      createdAt: isoDateTime(now)
    },
    {
      id: uid(),
      date: daysAgo(2),
      medicationId: "",
      medicationName: "",
      noteType: "journal",
      severity: "moderate",
      checklist: [],
      noteText: "Motivation improved when evening routine started earlier.",
      trainingNotes: "",
      isSensitive: true,
      createdAt: isoDateTime(now)
    }
  ];

  const checkins = [
    createSeedCheckin(daysAgo(6), { mood: 6, anxiety: 5, focus: 6, sleepHours: 7.1, sleepQuality: 6, appetite: 5, energy: 6, irritability: 4, cravingsImpulsivity: 4 }),
    createSeedCheckin(daysAgo(5), { mood: 6, anxiety: 4, focus: 7, sleepHours: 7.4, sleepQuality: 6, appetite: 5, energy: 6, irritability: 3, cravingsImpulsivity: 3 }),
    createSeedCheckin(daysAgo(4), { mood: 5, anxiety: 6, focus: 5, sleepHours: 6.3, sleepQuality: 5, appetite: 4, energy: 5, irritability: 5, cravingsImpulsivity: 5 }),
    createSeedCheckin(daysAgo(3), { mood: 7, anxiety: 4, focus: 7, sleepHours: 7.8, sleepQuality: 7, appetite: 5, energy: 7, irritability: 3, cravingsImpulsivity: 3 }),
    createSeedCheckin(daysAgo(2), { mood: 6, anxiety: 5, focus: 6, sleepHours: 7.2, sleepQuality: 6, appetite: 5, energy: 6, irritability: 4, cravingsImpulsivity: 4 }),
    createSeedCheckin(daysAgo(1), { mood: 7, anxiety: 4, focus: 7, sleepHours: 7.5, sleepQuality: 7, appetite: 6, energy: 7, irritability: 3, cravingsImpulsivity: 3 }),
    createSeedCheckin(today, { mood: 6, anxiety: 4, focus: 6, sleepHours: 7.0, sleepQuality: 6, appetite: 5, energy: 6, irritability: 3, cravingsImpulsivity: 3 })
  ];

  return ensureStateShape({
    version: APP_VERSION,
    medications: meds,
    changes,
    notes,
    checkins,
    adherence: [],
    shareLinks: []
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

  const migrated = {
    version: APP_VERSION,
    medications: [],
    changes: [],
    notes: [],
    checkins: [],
    adherence: [],
    shareLinks: []
  };

  const now = isoDateTime(new Date());

  // Compatibility layer for older versions where dose/time lived directly on medication rows.
  for (const med of Array.isArray(input.medications) ? input.medications : []) {
    migrated.medications.push({
      id: med.id || uid(),
      name: med.name || "Unnamed medication",
      genericName: med.genericName || "",
      route: med.route || "oral",
      currentDose: med.currentDose || med.dose || "",
      schedulePreset: med.schedulePreset || "custom",
      scheduleTimes: normalizeTimes(med.scheduleTimes || (med.time ? [med.time] : [])),
      startDate: med.startDate || isoDate(new Date()),
      indication: med.indication || med.notes || "",
      moaSimple: Array.isArray(med.moaSimple) ? med.moaSimple : [],
      moaTechnical: med.moaTechnical || "",
      adjustmentAcute: med.adjustmentAcute || "",
      adjustmentChronic: med.adjustmentChronic || "",
      commonSideEffects: med.commonSideEffects || "",
      monitor: med.monitor || "",
      questions: med.questions || "",
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

  if (!migrated.medications.length) {
    return buildSeedState();
  }

  return ensureStateShape(migrated);
}

function ensureStateShape(input) {
  const state = {
    version: APP_VERSION,
    medications: [],
    changes: [],
    notes: [],
    checkins: [],
    adherence: [],
    shareLinks: []
  };

  for (const med of Array.isArray(input.medications) ? input.medications : []) {
    state.medications.push({
      id: med.id || uid(),
      name: med.name || "Unnamed medication",
      genericName: med.genericName || "",
      route: med.route || "oral",
      currentDose: med.currentDose || "",
      schedulePreset: med.schedulePreset || "custom",
      scheduleTimes: normalizeTimes(med.scheduleTimes || []),
      startDate: med.startDate || isoDate(new Date()),
      indication: med.indication || "",
      moaSimple: Array.isArray(med.moaSimple) ? med.moaSimple.filter(Boolean) : [],
      moaTechnical: med.moaTechnical || "",
      adjustmentAcute: med.adjustmentAcute || "",
      adjustmentChronic: med.adjustmentChronic || "",
      commonSideEffects: med.commonSideEffects || "",
      monitor: med.monitor || "",
      questions: med.questions || "",
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
    createdAt: input?.createdAt || isoDateTime(new Date())
  };
}

function normalizeAdherence(input) {
  return {
    id: input?.id || uid(),
    date: input?.date || isoDate(new Date()),
    medicationId: input?.medicationId || "",
    medicationName: input?.medicationName || "",
    scheduleTime: input?.scheduleTime || "",
    status: input?.status || "taken",
    createdAt: input?.createdAt || isoDateTime(new Date())
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
  return {
    showSensitiveNotes: Boolean(input.showSensitiveNotes),
    showJournalText: Boolean(input.showJournalText),
    showLibido: Boolean(input.showLibido),
    showSubstance: Boolean(input.showSubstance),
    showFreeText: Boolean(input.showFreeText)
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

  app.ui.activeViewMode = app.shareSession.allowedModes[0] || "daily";
  app.ui.activeSection = "dashboard";
}

function loadDrafts() {
  const raw = localStorage.getItem(DRAFT_KEY);
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
  localStorage.setItem(DRAFT_KEY, JSON.stringify(app.drafts));
}

function loadAccessLogs() {
  const raw = localStorage.getItem(ACCESS_LOG_KEY);
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
  localStorage.setItem(ACCESS_LOG_KEY, JSON.stringify(app.accessLogs));
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

  if (app.ui.previewPreset !== "owner") {
    const preset = PRESETS[app.ui.previewPreset] || PRESETS.full;
    return {
      type: "preview",
      label: `${preset.label} preview`,
      readOnly: true,
      permissions: normalizePermissions(preset.permissions),
      allowedModes: normalizeAllowedModes(preset.defaultModes),
      blockedReason: "",
      expiresAt: "",
      preset: app.ui.previewPreset
    };
  }

  return {
    type: "owner",
    label: "Owner mode",
    readOnly: false,
    permissions: normalizePermissions({
      showSensitiveNotes: true,
      showJournalText: true,
      showLibido: true,
      showSubstance: true,
      showFreeText: true
    }),
    allowedModes: ["daily", "clinical", "personal"],
    blockedReason: "",
    expiresAt: "",
    preset: "owner"
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
  dom.viewModeSelect.addEventListener("change", (event) => {
    app.ui.activeViewMode = event.target.value;
    ensureSectionForCurrentMode();
    renderAll();
  });

  dom.previewSelect.addEventListener("change", (event) => {
    app.ui.previewPreset = event.target.value;
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
}

function bindShareHashListener() {
  window.addEventListener("hashchange", () => {
    app.shareSession = parseSharePayload();
    if (app.shareSession) {
      handleShareSessionInit();
    } else {
      app.ui.previewPreset = "owner";
    }
    ensureSectionForCurrentMode();
    renderAll();
  });
}

function renderAll() {
  const context = getActiveContext();

  if (!context.allowedModes.includes(app.ui.activeViewMode)) {
    app.ui.activeViewMode = context.allowedModes[0] || "daily";
  }

  renderViewModeSelector(context);
  renderContextElements(context);
  renderNavigation(context);
  renderSectionMeta(context);
  renderSections(context);
}

function renderViewModeSelector(context) {
  const options = context.allowedModes.map((mode) => {
    const meta = VIEW_MODE_META[mode];
    return `<option value="${mode}">${meta.label}</option>`;
  });

  dom.viewModeSelect.innerHTML = options.join("");
  dom.viewModeSelect.value = app.ui.activeViewMode;
}

function renderContextElements(context) {
  dom.contextPill.textContent = context.type === "share" ? "Read-only shared view" : context.label;

  if (context.type === "owner") {
    dom.ownerPreviewControl.classList.remove("hidden");
  } else {
    dom.ownerPreviewControl.classList.add("hidden");
  }

  if (context.type === "share") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Read-only access:</strong> Shared for ${escapeHtml(context.label)}.${context.expiresAt ? ` Link expires ${escapeHtml(niceDate(context.expiresAt))}.` : ""}`;
  } else if (context.type === "preview") {
    dom.readOnlyBanner.classList.remove("hidden");
    dom.readOnlyBanner.innerHTML = `<strong>Preview mode:</strong> You are previewing ${escapeHtml(context.label)} permissions.`;
  } else {
    dom.readOnlyBanner.classList.add("hidden");
    dom.readOnlyBanner.innerHTML = "";
  }

  if (context.blockedReason) {
    dom.globalStatus.classList.remove("hidden");
    dom.globalStatus.classList.add("error");
    dom.globalStatus.textContent = context.blockedReason;
  }
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

function renderNavigation(context) {
  const sections = availableSections(context, app.ui.activeViewMode);
  if (!sections.find((section) => section.id === app.ui.activeSection)) {
    app.ui.activeSection = sections[0]?.id || "dashboard";
  }

  dom.sectionNav.innerHTML = sections
    .map((section) => {
      const activeClass = section.id === app.ui.activeSection ? "active" : "";
      return `<button type="button" class="${activeClass}" data-section="${section.id}">${escapeHtml(section.label)}</button>`;
    })
    .join("");

  dom.sectionNav.querySelectorAll("button[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      app.ui.activeSection = button.dataset.section;
      renderAll();
    });
  });
}

function renderSectionMeta() {
  const meta = SECTION_META.find((section) => section.id === app.ui.activeSection) || SECTION_META[0];
  dom.sectionTitle.textContent = meta.title;
  dom.sectionSubtitle.textContent = meta.subtitle;
}

function renderSections(context) {
  const visibleData = getVisibleData();

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

function renderDashboard(root, data, context) {
  const activeMeds = data.medications.filter((med) => med.active);
  const today = isoDate(new Date());
  const todayCheckin = data.checkins.find((entry) => entry.date === today);
  const recentChanges = data.changes
    .filter((entry) => dateDiffDays(entry.date, today) <= 7)
    .sort((a, b) => b.date.localeCompare(a.date));

  const trendMood = trendArrow(data.checkins, "mood");
  const trendAnxiety = trendArrow(data.checkins, "anxiety", true);
  const trendFocus = trendArrow(data.checkins, "focus");

  const dueState = getDoseState(activeMeds, data.adherence);
  const alerts = buildAlerts(data);

  root.innerHTML = `
    <div class="grid cards">
      <article class="card">
        <div class="label">Active meds</div>
        <strong class="value">${activeMeds.length}</strong>
        <div class="meta">${dueState.dueNow.length} due now · ${dueState.next.length} next</div>
      </article>
      <article class="card">
        <div class="label">Today check-in</div>
        <strong class="value">${todayCheckin ? "Done" : "Pending"}</strong>
        <div class="meta">${todayCheckin ? `Mood ${todayCheckin.mood}/10, Anxiety ${todayCheckin.anxiety}/10` : "Use Quick check-in to add"}</div>
      </article>
      <article class="card">
        <div class="label">7-day changes</div>
        <strong class="value">${recentChanges.length}</strong>
        <div class="meta">Recent adjustment activity</div>
      </article>
      <article class="card">
        <div class="label">Weekly trend</div>
        <strong class="value">Mood ${trendMood.arrow} · Anxiety ${trendAnxiety.arrow}</strong>
        <div class="meta">Focus ${trendFocus.arrow}</div>
      </article>
    </div>

    <div class="grid" style="grid-template-columns: 1.2fr 1fr;">
      <article class="card">
        <h3>Today’s doses</h3>
        ${renderDoseTable(dueState, context)}
      </article>

      <article class="card">
        <h3>Recent medication changes (7 days)</h3>
        ${recentChanges.length ? `
          <ul class="timeline-list">
            ${recentChanges.map((entry) => `<li><strong>${escapeHtml(niceDate(entry.date))}</strong> · ${escapeHtml(entry.medicationName || "Medication")}: ${escapeHtml(entry.oldDose || "-")} → ${escapeHtml(entry.newDose || "-")}</li>`).join("")}
          </ul>
        ` : `<div class="empty">No medication changes recorded in the last 7 days.</div>`}
      </article>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr; margin-top: 12px;">
      <article class="card">
        <h3>Alerts / monitoring reminders</h3>
        ${alerts.length ? `<ul class="timeline-list">${alerts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<div class="empty">No active reminders.</div>`}
      </article>

      <article class="card">
        <h3>Shared links panel</h3>
        ${renderSharePanelPreview(context)}
      </article>
    </div>
  `;

  root.querySelectorAll("[data-mark-dose]").forEach((button) => {
    button.addEventListener("click", () => {
      if (context.readOnly) return;
      const [medId, time, status] = button.dataset.markDose.split("|");
      upsertAdherence(medId, time, status);
      setStatus(`Dose marked as ${status}.`);
      renderAll();
    });
  });
}

function renderDoseTable(dueState, context) {
  const items = [...dueState.dueNow, ...dueState.next, ...dueState.taken];
  if (!items.length) {
    return `<div class="empty">No scheduled doses configured for active medications.</div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Medication</th>
            <th>Time</th>
            <th>Status</th>
            ${context.readOnly ? "" : "<th>Action</th>"}
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td>${escapeHtml(item.medicationName)}</td>
              <td>${escapeHtml(item.time)}</td>
              <td>${escapeHtml(item.statusLabel)}</td>
              ${context.readOnly ? "" : `<td>
                <button class="btn btn-secondary small" type="button" data-mark-dose="${item.medicationId}|${item.time}|taken">Taken</button>
                <button class="btn btn-secondary small" type="button" data-mark-dose="${item.medicationId}|${item.time}|skipped">Skipped</button>
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
  const meds = data.medications.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  root.innerHTML = meds.length
    ? `
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
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            ${meds.map((med) => `
              <tr>
                <td>
                  <strong>${escapeHtml(med.name)}</strong>
                  ${med.genericName ? `<div class="subtle">${escapeHtml(med.genericName)}</div>` : ""}
                </td>
                <td>${escapeHtml(med.currentDose || "-")}</td>
                <td>${escapeHtml(formatSchedule(med))}</td>
                <td>${escapeHtml(med.route || "-")}</td>
                <td>${escapeHtml(niceDate(med.startDate))}</td>
                <td>${med.active ? "Active" : "Inactive"}</td>
                <td>
                  <button type="button" class="btn btn-secondary small" data-open-medication="${med.id}">Open details</button>
                  ${context.readOnly ? "" : `<button type="button" class="btn btn-secondary small" data-toggle-med="${med.id}">${med.active ? "Set inactive" : "Set active"}</button>`}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
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
      <div class="row" style="margin-top: 12px;">
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
      target.currentDose = valueOf("modalMedDose");
      target.route = valueOf("modalMedRoute");
      target.startDate = valueOf("modalMedStart") || target.startDate;
      target.scheduleTimes = normalizeTimes(valueOf("modalMedTimes").split(",").map((item) => item.trim()));
      target.indication = valueOf("modalMedIndication");
      target.moaSimple = valueOf("modalMedMoaSimple").split("\n").map((line) => line.trim()).filter(Boolean);
      target.moaTechnical = valueOf("modalMedMoaTechnical");
      target.adjustmentAcute = valueOf("modalMedAdjustAcute");
      target.adjustmentChronic = valueOf("modalMedAdjustChronic");
      target.commonSideEffects = valueOf("modalMedSideEffects");
      target.monitor = valueOf("modalMedMonitor");
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
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Medication</th>
            <th>Change</th>
            <th>Reason</th>
            <th>Interpretation</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(niceDate(row.date))}</td>
              <td>${escapeHtml(row.medicationName || "-")}</td>
              <td>${escapeHtml(row.oldDose || "-")} → ${escapeHtml(row.newDose || "-")}</td>
              <td>${escapeHtml(row.reason || "-")}</td>
              <td>
                <details>
                  <summary>Open interpretation card</summary>
                  <div class="interpret-card">
                    ${renderInterpretationCard(row.interpretation)}
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

function renderInterpretationCard(interpretation) {
  const i = normalizeInterpretation(interpretation);
  return `
    <div class="interpret-grid">
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
  const today = isoDate(new Date());
  const todayCheckin = data.checkins.find((entry) => entry.date === today);
  const sorted = data.checkins.slice().sort((a, b) => b.date.localeCompare(a.date));

  root.innerHTML = `
    <div class="card">
      <h3>Today’s check-in summary</h3>
      ${todayCheckin ? `
        <div class="row">
          <span class="kpi-badge">Mood ${todayCheckin.mood}/10</span>
          <span class="kpi-badge">Anxiety ${todayCheckin.anxiety}/10</span>
          <span class="kpi-badge">Focus ${todayCheckin.focus}/10</span>
          <span class="kpi-badge">Sleep ${todayCheckin.sleepHours}h</span>
          <span class="kpi-badge">Energy ${todayCheckin.energy}/10</span>
          <span class="kpi-badge">Irritability ${todayCheckin.irritability}/10</span>
        </div>
      ` : `<div class="empty">No check-in saved for today.</div>`}
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
              .map((item) => `<li><strong>${escapeHtml(niceDate(item.date))}</strong> ${escapeHtml(item.medicationName ? `(${item.medicationName})` : "")} · ${escapeHtml(item.noteText || "-")} ${item.trainingNotes ? `<div class="subtle">Training: ${escapeHtml(item.trainingNotes)}</div>` : ""}</li>`)
              .join("")}
          </ul>
        </article>
      `;
    })
    .filter(Boolean)
    .join("");

  root.innerHTML = blocks || `<div class="empty">No notes available for this view.</div>`;
}

function renderTimeline(root, data) {
  const checkins = data.checkins.slice().sort((a, b) => a.date.localeCompare(b.date));
  const changeDates = data.changes.map((entry) => entry.date);

  const moodSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.mood) }));
  const anxietySeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.anxiety) }));
  const focusSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.focus) }));
  const sleepSeries = checkins.map((entry) => ({ date: entry.date, value: toNumber(entry.sleepHours) }));

  const sideEffectCounts = buildSideEffectCounts(data);

  if (!app.ui.comparisonChangeId && data.changes[0]) {
    app.ui.comparisonChangeId = data.changes[0].id;
  }

  root.innerHTML = `
    <div class="grid" style="grid-template-columns: 1fr; gap: 12px;">
      <article class="chart-box">
        <h4>Mood / Anxiety / Focus over time</h4>
        ${renderLineChart(
          [
            { label: "Mood", color: "#14806f", points: moodSeries },
            { label: "Anxiety", color: "#c16e2b", points: anxietySeries },
            { label: "Focus", color: "#3f63be", points: focusSeries }
          ],
          { yMin: 0, yMax: 10, changeDates }
        )}
      </article>

      <article class="chart-box">
        <h4>Sleep hours over time</h4>
        ${renderLineChart([{ label: "Sleep hours", color: "#6d4ad4", points: sleepSeries }], { yMin: 0, yMax: 12, changeDates })}
      </article>

      <article class="chart-box">
        <h4>Side effect frequency over time</h4>
        ${renderBarChart(sideEffectCounts, changeDates)}
      </article>

      <article class="card">
        <h3>Before/After comparison around a medication change</h3>
        ${renderBeforeAfterComparison(data)}
      </article>

      <article class="card">
        <h3>Timeline</h3>
        ${renderCombinedTimeline(data)}
      </article>
    </div>
  `;

  const comparisonSelect = root.querySelector("#comparisonChangeSelect");
  if (comparisonSelect) {
    comparisonSelect.addEventListener("change", () => {
      app.ui.comparisonChangeId = comparisonSelect.value;
      renderAll();
    });
  }
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
    return `<div class="empty">No timeline events yet.</div>`;
  }

  return `
    <ul class="timeline-list">
      ${sorted.map((event) => `<li><strong>${escapeHtml(niceDate(event.date))}</strong> · ${escapeHtml(event.type)} · ${escapeHtml(event.detail)}</li>`).join("")}
    </ul>
  `;
}

function renderBeforeAfterComparison(data) {
  if (!data.changes.length) {
    return `<div class="empty">No medication changes available for comparison.</div>`;
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

function renderWorkflowForm(data) {
  if (app.ui.entryWorkflow === "medication") {
    const draft = app.drafts.medication || {};
    return `
      <form id="formMedication" class="card">
        <h3>Add Current Medication</h3>
        <div class="field-grid">
          <div>
            <label>Medication name</label>
            <input name="name" list="commonMedicationNames" value="${escapeHtml(draft.name || "")}" required>
          </div>
          <div>
            <label>Generic name</label>
            <input name="genericName" value="${escapeHtml(draft.genericName || "")}">
          </div>
          <div>
            <label>Current dose</label>
            <input name="currentDose" placeholder="e.g. 40 mg" value="${escapeHtml(draft.currentDose || "")}" required>
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
              ${Object.entries(SCHEDULE_PRESETS).map(([key, meta]) => `<option value="${key}" ${draft.schedulePreset === key ? "selected" : ""}>${escapeHtml(meta.label)}</option>`).join("")}
            </select>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Schedule times (HH:MM, comma separated)</label>
            <input name="scheduleTimes" id="medScheduleTimes" value="${escapeHtml(draft.scheduleTimes || "")}" placeholder="08:00, 14:00">
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
        <div class="row" style="margin-top:10px;">
          <button class="btn btn-primary" type="submit">Add medication</button>
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
          </div>
          <div>
            <label>Old dose</label>
            <input name="oldDose" value="${escapeHtml(draft.oldDose || "")}" required>
          </div>
          <div>
            <label>New dose</label>
            <input name="newDose" value="${escapeHtml(draft.newDose || "")}" required>
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Reason</label>
            <textarea name="reason" required>${escapeHtml(draft.reason || "")}</textarea>
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
        <div class="row" style="margin-top:10px;">
          <button class="btn btn-secondary" type="button" id="fillInterpretationTemplate">Apply template</button>
          <button class="btn btn-primary" type="submit">Log medication change</button>
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
        <div class="row" style="margin-top:10px;">
          <button class="btn btn-primary" type="submit">Log note</button>
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

      <div class="field-grid" style="margin-top:10px;">
        <div style="grid-column: 1 / -1;"><label>Side effects free text</label><textarea name="sideEffectsText">${escapeHtml(draft.sideEffectsText || "")}</textarea></div>
        <div style="grid-column: 1 / -1;"><label>Training / exercise notes</label><textarea name="trainingNotes">${escapeHtml(draft.trainingNotes || "")}</textarea></div>
        <div><label>Weight (optional)</label><input name="weight" value="${escapeHtml(draft.weight || "")}"></div>
        <div><label>BP systolic (optional)</label><input name="bpSystolic" value="${escapeHtml(draft.bpSystolic || "")}"></div>
        <div><label>BP diastolic (optional)</label><input name="bpDiastolic" value="${escapeHtml(draft.bpDiastolic || "")}"></div>
        <div><label>HR (optional)</label><input name="hr" value="${escapeHtml(draft.hr || "")}"></div>
      </div>

      <div class="row" style="margin-top:10px;">
        <button class="btn btn-primary" type="submit">Save daily check-in</button>
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
      const preset = SCHEDULE_PRESETS[schedulePreset.value];
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
        route: values.route || "oral",
        currentDose: values.currentDose,
        schedulePreset: values.schedulePreset || "custom",
        scheduleTimes: normalizeTimes((values.scheduleTimes || "").split(",").map((item) => item.trim())),
        startDate: values.startDate,
        indication: values.indication || "",
        moaSimple: (values.moaSimple || "").split("\n").map((line) => line.trim()).filter(Boolean),
        moaTechnical: values.moaTechnical || "",
        adjustmentAcute: "",
        adjustmentChronic: "",
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
      if (duplicate) {
        return setStatus("Duplicate warning: check-in for this date already exists.", "error");
      }

      const rangeValid = ["mood", "anxiety", "focus", "sleepQuality", "appetite", "energy", "irritability", "cravingsImpulsivity"].every((field) => {
        const value = Number(values[field]);
        return Number.isFinite(value) && value >= 1 && value <= 10;
      });

      if (!rangeValid) {
        return setStatus("Validation failed: 1-10 fields must be within range.", "error");
      }

      app.ownerData.checkins.push({
        id: uid(),
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
        createdAt: isoDateTime(new Date())
      });

      saveOwnerData(app.ownerData);
      app.drafts.checkin = {};
      saveDrafts();
      setStatus("Daily check-in saved.");
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

  const defaultPreset = PRESETS.family;
  const toggles = app.drafts.sharePermissions || normalizePermissions(defaultPreset.permissions);
  const draftShare = app.drafts.share || {};

  root.innerHTML = `
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
          <div><label>Link expiry (optional)</label><input name="expiresAt" type="date" value="${escapeHtml(draftShare.expiresAt || "")}"></div>
        </div>

        <div class="card" style="margin-top:10px;">
          <h4>Per-link visibility toggles</h4>
          <div class="field-grid">
            ${renderPermissionToggle("showSensitiveNotes", "Show sensitive notes", toggles.showSensitiveNotes)}
            ${renderPermissionToggle("showJournalText", "Show journal text", toggles.showJournalText)}
            ${renderPermissionToggle("showLibido", "Show libido / sexual side effects", toggles.showLibido)}
            ${renderPermissionToggle("showSubstance", "Show substance-use notes", toggles.showSubstance)}
            ${renderPermissionToggle("showFreeText", "Show free-text notes", toggles.showFreeText)}
          </div>

          <label style="margin-top:10px;">Allowed views</label>
          <div class="row">
            ${["daily", "clinical", "personal"].map((mode) => {
              const checked = Array.isArray(draftShare.allowedModes)
                ? draftShare.allowedModes.includes(mode)
                : defaultPreset.defaultModes.includes(mode);
              return `<label class="check-item"><input type="checkbox" name="allowedModes" value="${mode}" ${checked ? "checked" : ""}><span>${escapeHtml(VIEW_MODE_META[mode].label)}</span></label>`;
            }).join("")}
          </div>
        </div>

        <div class="row" style="margin-top:10px;">
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
  const presetSelect = root.querySelector("#sharePresetSelect");

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

    if (!allowedModes.length) {
      return setStatus("Select at least one allowed view mode.", "error");
    }

    const permissions = normalizePermissions({
      showSensitiveNotes: shareForm.elements.showSensitiveNotes.checked,
      showJournalText: shareForm.elements.showJournalText.checked,
      showLibido: shareForm.elements.showLibido.checked,
      showSubstance: shareForm.elements.showSubstance.checked,
      showFreeText: shareForm.elements.showFreeText.checked
    });

    const token = uid();
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
      expiresAt: values.expiresAt || "",
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
      expiresAt: values.expiresAt || "",
      revoked: false,
      createdAt,
      token,
      url,
      lastOpenedAt: "",
      totalOpens: 0
    });

    saveOwnerData(app.ownerData);
    app.drafts.share = {};
    app.drafts.sharePermissions = {};
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
      window.open(link.url, "_blank", "noopener,noreferrer");
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
          <div class="subtle">Access log (local): opens ${access.totalOpens || 0}${access.lastOpenedAt ? ` · last opened ${escapeHtml(niceDateTime(access.lastOpenedAt))}` : ""}</div>
          <textarea class="share-url" readonly>${escapeHtml(link.url)}</textarea>
          <div class="row" style="margin-top:8px;">
            <button class="btn btn-secondary" type="button" data-copy-link="${link.id}">Copy</button>
            <button class="btn btn-secondary" type="button" data-preview-link="${link.id}">Open preview</button>
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

function renderExports(root, data) {
  root.innerHTML = `
    <div class="card">
      <h3>Export options</h3>
      <div class="row">
        <button class="btn btn-secondary" type="button" id="exportJson">Download JSON backup</button>
        <button class="btn btn-secondary" type="button" id="exportCsvMedications">Download medications CSV</button>
        <button class="btn btn-secondary" type="button" id="exportCsvChanges">Download changes CSV</button>
        <button class="btn btn-secondary" type="button" id="exportCsvCheckins">Download check-ins CSV</button>
        <button class="btn btn-primary" type="button" id="exportPdfSummary">Generate clinician PDF summary</button>
      </div>
      <p class="safety-footnote">Clinician summary text is informational. Discuss with prescriber.</p>
    </div>
  `;

  root.querySelector("#exportJson").addEventListener("click", () => {
    const payload = JSON.stringify(ensureStateShape(data), null, 2);
    downloadFile(`medication-tracker-backup-${isoDate(new Date())}.json`, payload, "application/json");
  });

  root.querySelector("#exportCsvMedications").addEventListener("click", () => {
    const rows = data.medications.map((med) => ({
      name: med.name,
      generic_name: med.genericName,
      current_dose: med.currentDose,
      schedule_times: (med.scheduleTimes || []).join(" | "),
      route: med.route,
      start_date: med.startDate,
      indication: med.indication,
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
      reason: entry.reason,
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
    const html = buildClinicianSummaryHtml(data);
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

function buildClinicianSummaryHtml(data) {
  const meds = data.medications.filter((entry) => entry.active);
  const recentChanges = data.changes.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const recentCheckins = data.checkins.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  const notes = data.notes.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

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

        <h2>Current Medications</h2>
        <table>
          <thead><tr><th>Name</th><th>Dose</th><th>Schedule</th><th>Route</th><th>Indication</th><th>Monitor</th><th>Questions</th></tr></thead>
          <tbody>
            ${meds.map((med) => `<tr><td>${escapeHtml(med.name)}</td><td>${escapeHtml(med.currentDose)}</td><td>${escapeHtml(formatSchedule(med))}</td><td>${escapeHtml(med.route)}</td><td>${escapeHtml(med.indication || "-")}</td><td>${escapeHtml(med.monitor || "-")}</td><td>${escapeHtml(med.questions || "-")}</td></tr>`).join("")}
          </tbody>
        </table>

        <h2>Recent Medication Changes</h2>
        <table>
          <thead><tr><th>Date</th><th>Medication</th><th>Old</th><th>New</th><th>Reason</th><th>Short term</th><th>Long term</th></tr></thead>
          <tbody>
            ${recentChanges.map((change) => `<tr><td>${escapeHtml(niceDate(change.date))}</td><td>${escapeHtml(change.medicationName)}</td><td>${escapeHtml(change.oldDose)}</td><td>${escapeHtml(change.newDose)}</td><td>${escapeHtml(change.reason)}</td><td>${escapeHtml(change.interpretation.shortTerm)}</td><td>${escapeHtml(change.interpretation.longTerm)}</td></tr>`).join("")}
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
            ${notes.map((note) => `<tr><td>${escapeHtml(niceDate(note.date))}</td><td>${escapeHtml(note.noteType)}</td><td>${escapeHtml(note.medicationName || "-")}</td><td>${escapeHtml(note.noteText || "-")}</td></tr>`).join("")}
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

function getDoseState(activeMeds, adherence) {
  const now = new Date();
  const today = isoDate(now);
  const dueNow = [];
  const next = [];
  const taken = [];

  for (const med of activeMeds) {
    const times = med.scheduleTimes || [];
    for (const time of times) {
      const existing = adherence.find(
        (entry) =>
          entry.date === today &&
          entry.medicationId === med.id &&
          entry.scheduleTime === time
      );

      const scheduleDate = parseDateTime(today, time);
      const diffMinutes = (scheduleDate.getTime() - now.getTime()) / 60000;
      const row = {
        medicationId: med.id,
        medicationName: med.name,
        time,
        statusLabel: existing ? `Marked ${existing.status}` : diffMinutes < -120 ? "Overdue" : diffMinutes <= 45 ? "Due now" : "Upcoming"
      };

      if (existing) {
        taken.push(row);
      } else if (diffMinutes <= 45) {
        dueNow.push(row);
      } else {
        next.push(row);
      }
    }
  }

  dueNow.sort((a, b) => a.time.localeCompare(b.time));
  next.sort((a, b) => a.time.localeCompare(b.time));
  taken.sort((a, b) => a.time.localeCompare(b.time));

  return { dueNow, next, taken };
}

function upsertAdherence(medicationId, scheduleTime, status) {
  const med = app.ownerData.medications.find((entry) => entry.id === medicationId);
  if (!med) return;

  const today = isoDate(new Date());
  const existing = app.ownerData.adherence.find(
    (entry) => entry.date === today && entry.medicationId === medicationId && entry.scheduleTime === scheduleTime
  );

  if (existing) {
    existing.status = status;
    existing.createdAt = isoDateTime(new Date());
  } else {
    app.ownerData.adherence.push({
      id: uid(),
      date: today,
      medicationId,
      medicationName: med.name,
      scheduleTime,
      status,
      createdAt: isoDateTime(new Date())
    });
  }

  saveOwnerData(app.ownerData);
}

function buildAlerts(data) {
  const alerts = [];

  const highNotes = data.notes.filter((note) => note.severity === "high").slice(0, 3);
  highNotes.forEach((note) => {
    alerts.push(`High-severity ${note.noteType.replaceAll("_", " ")} note on ${niceDate(note.date)}${note.medicationName ? ` (${note.medicationName})` : ""}.`);
  });

  const recentChanges = data.changes
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2);

  recentChanges.forEach((change) => {
    alerts.push(`${change.medicationName}: monitor ${change.interpretation.monitor}`);
  });

  const today = isoDate(new Date());
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
    return `<div class="empty">Not enough data for chart.</div>`;
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
    return `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" stroke="#e7edf4" stroke-width="1" />`;
  }).join("");

  const markerLines = (options.changeDates || []).map((date) => {
    if (!dates.includes(date)) return "";
    const x = xFor(date);
    return `<line x1="${x}" x2="${x}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#c88a2c" stroke-dasharray="4 4" stroke-width="1" />`;
  }).join("");

  const seriesPaths = seriesList.map((series) => {
    const points = series.points
      .filter((point) => Number.isFinite(point.value))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!points.length) return "";

    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.date).toFixed(2)} ${yFor(point.value).toFixed(2)}`)
      .join(" ");

    const circles = points.map((point) => `<circle cx="${xFor(point.date).toFixed(2)}" cy="${yFor(point.value).toFixed(2)}" r="2.2" fill="${series.color}" />`).join("");
    return `<path d="${path}" fill="none" stroke="${series.color}" stroke-width="2.2" />${circles}`;
  }).join("");

  const labels = [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]]
    .filter(Boolean)
    .map((date) => `<text x="${xFor(date)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#5d7087">${escapeHtml(shortDate(date))}</text>`)
    .join("");

  const legend = `
    <div class="legend">
      ${seriesList.map((series) => `<span><i style="background:${series.color}"></i>${escapeHtml(series.label)}</span>`).join("")}
      <span><i style="background:#c88a2c"></i>Medication change marker</span>
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

function renderBarChart(points, changeDates = []) {
  const width = 860;
  const height = 210;
  const padding = { top: 18, right: 16, bottom: 26, left: 32 };

  if (!points.length) {
    return `<div class="empty">Not enough side effect data for chart.</div>`;
  }

  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const span = Math.max(points.length - 1, 1);

  const xFor = (index) => padding.left + (index / span) * (width - padding.left - padding.right);
  const yFor = (value) => height - padding.bottom - (value / maxValue) * (height - padding.top - padding.bottom);

  const bars = points.map((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    const barWidth = Math.max((width - padding.left - padding.right) / (points.length * 1.6), 6);
    return `<rect x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${height - padding.bottom - y}" fill="#2f7cbf" opacity="0.82" />`;
  }).join("");

  const markerLines = changeDates
    .filter((date) => points.some((point) => point.date === date))
    .map((date) => {
      const idx = points.findIndex((point) => point.date === date);
      const x = xFor(idx);
      return `<line x1="${x}" x2="${x}" y1="${padding.top}" y2="${height - padding.bottom}" stroke="#c88a2c" stroke-dasharray="4 4" stroke-width="1" />`;
    })
    .join("");

  const labels = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]
    .filter(Boolean)
    .map((point, index) => `<text x="${xFor(index === 0 ? 0 : index === 1 ? Math.floor(points.length / 2) : points.length - 1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#5d7087">${escapeHtml(shortDate(point.date))}</text>`)
    .join("");

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="bar chart">
      <line x1="${padding.left}" x2="${width - padding.right}" y1="${height - padding.bottom}" y2="${height - padding.bottom}" stroke="#e5edf4" stroke-width="1" />
      ${markerLines}
      ${bars}
      ${labels}
    </svg>
    <div class="legend"><span><i style="background:#2f7cbf"></i>Side effect frequency</span><span><i style="background:#c88a2c"></i>Medication change marker</span></div>
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

function setStatus(message, type = "ok") {
  clearTimeout(app.statusTimeout);
  dom.globalStatus.classList.remove("hidden", "error");
  if (type === "error") {
    dom.globalStatus.classList.add("error");
  }
  dom.globalStatus.textContent = message;

  app.statusTimeout = setTimeout(() => {
    if (getActiveContext().blockedReason) return;
    dom.globalStatus.classList.add("hidden");
    dom.globalStatus.classList.remove("error");
    dom.globalStatus.textContent = "";
  }, 5000);
}

function parseDateTime(date, time) {
  return new Date(`${date}T${time || "00:00"}:00`);
}

function formatSchedule(medication) {
  const preset = SCHEDULE_PRESETS[medication.schedulePreset]?.label || "Custom";
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
