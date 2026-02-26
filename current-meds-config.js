/**
 * @typedef {Object} MedicationScheduleEntry
 * @property {string} timeLabel
 * @property {string} [time24h]
 * @property {string} frequency
 */

/**
 * @typedef {Object} CurrentMedicationConfig
 * @property {string} name
 * @property {string} [genericName]
 * @property {number|string} [dose]
 * @property {string} units
 * @property {string} [formulation]
 * @property {string} [route]
 * @property {MedicationScheduleEntry[]} schedule
 * @property {boolean} prn
 * @property {string} [prnRange]
 * @property {string} [notes]
 * @property {string[]} [aliases]
 */

export const CURRENT_MEDICATION_GROUPS = Object.freeze([
  { key: "morning", label: "Morning", time24h: "08:00" },
  { key: "afternoon", label: "2:00 pm", time24h: "14:00" },
  { key: "night", label: "8:00 pm", time24h: "20:00" },
  { key: "prn", label: "PRN", time24h: "" }
]);

/** @type {readonly CurrentMedicationConfig[]} */
export const CURRENT_MEDICATION_REGIMEN = Object.freeze([
  {
    name: "Concerta (methylphenidate ER / OROS)",
    genericName: "methylphenidate",
    dose: 36,
    units: "mg",
    formulation: "ER",
    route: "oral",
    schedule: [{ timeLabel: "Morning", time24h: "08:00", frequency: "daily" }],
    prn: false,
    notes: "Morning dose.",
    aliases: ["Concerta", "methylphenidate ER", "Concerta (methylphenidate ER)"]
  },
  {
    name: "Bupropion SR",
    genericName: "bupropion",
    dose: 150,
    units: "mg",
    formulation: "SR",
    route: "oral",
    schedule: [{ timeLabel: "Morning", time24h: "08:00", frequency: "daily" }],
    prn: false,
    notes: "Morning dose.",
    aliases: ["Bupropion"]
  },
  {
    name: "Clonazepam",
    genericName: "clonazepam",
    dose: 1,
    units: "mg",
    route: "oral",
    schedule: [
      { timeLabel: "Morning", time24h: "08:00", frequency: "daily" },
      { timeLabel: "2:00 pm", time24h: "14:00", frequency: "daily" }
    ],
    prn: false,
    notes: "Scheduled twice daily.",
    aliases: ["Klonopin"]
  },
  {
    name: "Clonidine",
    genericName: "clonidine",
    dose: 300,
    units: "mcg",
    route: "oral",
    schedule: [{ timeLabel: "8:00 pm", time24h: "20:00", frequency: "daily" }],
    prn: false,
    notes: "Night dose."
  },
  {
    name: "Nicotine patch",
    genericName: "nicotine",
    dose: 21,
    units: "mg/24 hours",
    formulation: "patch",
    route: "transdermal",
    schedule: [{ timeLabel: "8:00 pm", time24h: "20:00", frequency: "daily" }],
    prn: false,
    notes: "Apply daily."
  },
  {
    name: "Quetiapine (Seroquel)",
    genericName: "quetiapine",
    units: "mg",
    route: "oral",
    schedule: [{ timeLabel: "Night", time24h: "20:00", frequency: "as needed" }],
    prn: true,
    prnRange: "25–100",
    notes: "At night as needed.",
    aliases: ["Seroquel", "Quetiapine"]
  }
]);

export function normalizeMedicationKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function medicationConfigLookupKeys(config) {
  return Array.from(
    new Set(
      [config?.name, config?.genericName, ...(Array.isArray(config?.aliases) ? config.aliases : [])]
        .map(normalizeMedicationKey)
        .filter(Boolean)
    )
  );
}

export function formatRegimenDose(config) {
  const unit = String(config?.units || "").trim();
  if (config?.prn && config?.prnRange) {
    return `${String(config.prnRange).trim()} ${unit}`.trim();
  }
  if (config?.dose !== undefined && config?.dose !== null && String(config.dose).trim() !== "") {
    return `${String(config.dose).trim()} ${unit}`.trim();
  }
  return unit;
}

function uniqueScheduleTimes(config) {
  const schedule = Array.isArray(config?.schedule) ? config.schedule : [];
  return Array.from(
    new Set(
      schedule
        .map((entry) => String(entry?.time24h || "").trim())
        .filter(Boolean)
    )
  );
}

function deriveSchedulePreset(config) {
  if (config?.prn) return "prn";
  const times = uniqueScheduleTimes(config);
  if (times.length === 1 && times[0] === "08:00") return "am";
  if (times.length === 1 && times[0] === "20:00") return "pm";
  if (times.length === 2 && times.includes("08:00") && times.includes("20:00")) return "bid";
  return "custom";
}

export function toProfileMedicationValues(config) {
  return {
    name: config.name,
    genericName: config.genericName || "",
    currentDose: formatRegimenDose(config),
    schedulePreset: deriveSchedulePreset(config),
    scheduleTimes: config.prn ? [] : uniqueScheduleTimes(config),
    route: config.route || "oral",
    indication: config.notes || "",
    monitor: "",
    questions: "",
    needsConfirmation: false,
    confirmationNotes: "",
    lookupKeys: medicationConfigLookupKeys(config)
  };
}

const REGIMEN_BY_LOOKUP_KEY = (() => {
  const map = new Map();
  for (const config of CURRENT_MEDICATION_REGIMEN) {
    for (const key of medicationConfigLookupKeys(config)) {
      if (!map.has(key)) {
        map.set(key, config);
      }
    }
  }
  return map;
})();

export function findRegimenMedicationConfigByMedication(medication) {
  const keys = [
    normalizeMedicationKey(medication?.name),
    normalizeMedicationKey(medication?.genericName)
  ].filter(Boolean);
  for (const key of keys) {
    if (REGIMEN_BY_LOOKUP_KEY.has(key)) {
      return REGIMEN_BY_LOOKUP_KEY.get(key);
    }
  }
  return null;
}
