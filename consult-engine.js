import { ADHERENCE_STATUS, normalizeAdherenceStatus } from "./dose-actions.js";

const RISK_LEVEL_RANK = Object.freeze({
  low: 0,
  watch: 1,
  elevated: 2,
  high: 3
});

const METRIC_DEFINITIONS = Object.freeze([
  { key: "adherencePct", label: "Adherence %", direction: "higher", threshold: 3, precision: 1 },
  { key: "moodAvg", label: "Mood", direction: "higher", threshold: 0.35, precision: 2 },
  { key: "anxietyAvg", label: "Anxiety", direction: "lower", threshold: 0.35, precision: 2 },
  { key: "focusAvg", label: "Focus", direction: "higher", threshold: 0.35, precision: 2 },
  { key: "sleepHoursAvg", label: "Sleep hours", direction: "higher", threshold: 0.3, precision: 2 },
  { key: "sideEffectCount", label: "Side effects", direction: "lower", threshold: 1, precision: 0 },
  { key: "notesCount", label: "Notes", direction: "lower", threshold: 1, precision: 0 },
  { key: "riskFlagDays", label: "Risk flags", direction: "lower", threshold: 1, precision: 0 }
]);

function dateKey(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function toMs(key) {
  const parsed = new Date(`${key}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? NaN : parsed.getTime();
}

function shiftDateKey(dateValue, days) {
  const key = dateKey(dateValue);
  if (!key) return "";
  const parsed = new Date(`${key}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + Number(days || 0));
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function inRange(key, startDate, endDate) {
  if (!key) return false;
  if (startDate && key < startDate) return false;
  if (endDate && key > endDate) return false;
  return true;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function countDistinctDays(rows, field = "date") {
  const set = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = dateKey(row?.[field]);
    if (key) set.add(key);
  }
  return set.size;
}

function countDaysInclusive(startDate, endDate) {
  const start = toMs(dateKey(startDate));
  const end = toMs(dateKey(endDate));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function normalizeMetricValue(metric, value) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const power = metric.precision || 0;
  const factor = 10 ** power;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function metricOutcome(metric, beforeValue, afterValue) {
  if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) {
    return {
      direction: "no_data",
      changeType: "insufficient",
      delta: null
    };
  }

  const delta = afterValue - beforeValue;
  if (Math.abs(delta) <= metric.threshold) {
    return {
      direction: "stable",
      changeType: "stable",
      delta
    };
  }

  const direction = delta > 0 ? "up" : "down";
  const improved = metric.direction === "higher" ? delta > 0 : delta < 0;
  return {
    direction,
    changeType: improved ? "improved" : "worsened",
    delta
  };
}

function computeAdherencePct(rows) {
  let taken = 0;
  let total = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = normalizeAdherenceStatus(row?.status);
    if (![ADHERENCE_STATUS.TAKEN, ADHERENCE_STATUS.SKIPPED].includes(status)) continue;
    total += 1;
    if (status === ADHERENCE_STATUS.TAKEN) taken += 1;
  }
  if (!total) return null;
  return (taken / total) * 100;
}

function collectWindowRows(data, startDate, endDate) {
  const checkins = (data.checkins || []).filter((row) => inRange(dateKey(row?.date), startDate, endDate));
  const adherence = (data.adherence || []).filter((row) => inRange(dateKey(row?.date), startDate, endDate));
  const notes = (data.notes || []).filter((row) => inRange(dateKey(row?.date), startDate, endDate));
  const sideEffectEvents = (data.sideEffectEvents || []).filter((row) => inRange(dateKey(row?.date || row?.createdAt), startDate, endDate));
  const riskHistory = (data.riskHistory || []).filter((row) => inRange(dateKey(row?.date), startDate, endDate));
  return { checkins, adherence, notes, sideEffectEvents, riskHistory };
}

function computeWindowMetrics(rows) {
  const sideEffectNotes = rows.notes.filter((note) => String(note?.noteType || "") === "side_effect");
  const sideEffectCountFromNotes = sideEffectNotes.reduce((count, note) => {
    const checklistCount = Array.isArray(note?.checklist) ? note.checklist.length : 0;
    return count + (checklistCount > 0 ? checklistCount : 1);
  }, 0);

  const riskFlagDays = rows.riskHistory.filter((entry) => {
    const rank = RISK_LEVEL_RANK[String(entry?.level || "").toLowerCase()] || 0;
    return rank >= RISK_LEVEL_RANK.watch;
  }).length;

  return {
    adherencePct: computeAdherencePct(rows.adherence),
    moodAvg: average(rows.checkins.map((row) => Number(row?.mood))),
    anxietyAvg: average(rows.checkins.map((row) => Number(row?.anxiety))),
    focusAvg: average(rows.checkins.map((row) => Number(row?.focus))),
    sleepHoursAvg: average(rows.checkins.map((row) => Number(row?.sleepHours))),
    sideEffectCount: rows.sideEffectEvents.length + sideEffectCountFromNotes,
    notesCount: rows.notes.length,
    riskFlagDays,
    checkinDays: countDistinctDays(rows.checkins, "date")
  };
}

function observedPatternSummary(metricRows) {
  const phrases = [];
  const byKey = new Map(metricRows.map((row) => [row.key, row]));

  const maybePush = (key, improvedPhrase, worsenedPhrase) => {
    const row = byKey.get(key);
    if (!row || row.changeType === "stable" || row.changeType === "insufficient") return;
    if (row.changeType === "improved") phrases.push(improvedPhrase);
    if (row.changeType === "worsened") phrases.push(worsenedPhrase);
  };

  maybePush("focusAvg", "focus improved", "focus decreased");
  maybePush("moodAvg", "mood improved", "mood worsened");
  maybePush("anxietyAvg", "anxiety reduced", "anxiety increased");
  maybePush("sleepHoursAvg", "sleep duration improved", "sleep duration decreased");
  maybePush("sideEffectCount", "side effects reduced", "side effects increased");

  if (!phrases.length) {
    return "Observed pattern: no clear directional pattern yet.";
  }

  return `Observed pattern: ${phrases.slice(0, 4).join(", ")}.`;
}

export function computeBeforeAfterComparison(data, changeDate, options = {}) {
  const dateEffective = dateKey(changeDate);
  if (!dateEffective) {
    return {
      valid: false,
      reason: "Missing change date.",
      windows: null,
      metrics: [],
      summary: "Observed pattern: no clear directional pattern yet.",
      dataQuality: {
        beforeCheckinDays: 0,
        afterCheckinDays: 0,
        insufficientCoverage: true,
        note: "Insufficient data for this comparison."
      }
    };
  }

  const beforeDays = Math.max(1, Number(options.beforeDays || 7));
  const afterDays = Math.max(1, Number(options.afterDays || 7));

  const beforeWindow = {
    startDate: shiftDateKey(dateEffective, -beforeDays),
    endDate: shiftDateKey(dateEffective, -1)
  };
  const afterWindow = {
    startDate: dateEffective,
    endDate: shiftDateKey(dateEffective, afterDays - 1)
  };

  const beforeRows = collectWindowRows(data, beforeWindow.startDate, beforeWindow.endDate);
  const afterRows = collectWindowRows(data, afterWindow.startDate, afterWindow.endDate);
  const beforeMetrics = computeWindowMetrics(beforeRows);
  const afterMetrics = computeWindowMetrics(afterRows);

  const metricRows = METRIC_DEFINITIONS.map((metric) => {
    const beforeRaw = beforeMetrics[metric.key];
    const afterRaw = afterMetrics[metric.key];
    const normalizedBefore = normalizeMetricValue(metric, beforeRaw);
    const normalizedAfter = normalizeMetricValue(metric, afterRaw);
    const outcome = metricOutcome(metric, beforeRaw, afterRaw);
    return {
      ...metric,
      before: normalizedBefore,
      after: normalizedAfter,
      delta: normalizeMetricValue(metric, outcome.delta),
      direction: outcome.direction,
      changeType: outcome.changeType
    };
  });

  const minimumCoverage = Math.min(3, beforeDays, afterDays);
  const beforeCheckinDays = beforeMetrics.checkinDays;
  const afterCheckinDays = afterMetrics.checkinDays;
  const insufficientCoverage = beforeCheckinDays < minimumCoverage || afterCheckinDays < minimumCoverage;

  return {
    valid: true,
    reason: "",
    windows: {
      before: beforeWindow,
      after: afterWindow
    },
    metrics: metricRows,
    summary: observedPatternSummary(metricRows),
    dataQuality: {
      beforeCheckinDays,
      afterCheckinDays,
      insufficientCoverage,
      note: insufficientCoverage
        ? `Limited check-in coverage (${beforeCheckinDays} before / ${afterCheckinDays} after). Interpret cautiously.`
        : "Coverage is adequate for directional comparison."
    }
  };
}

function estimateExpectedDoseCount(medications, daysInRange) {
  if (!Array.isArray(medications) || !daysInRange) return 0;
  const perDay = medications
    .filter((med) => med?.active !== false)
    .reduce((sum, med) => sum + Math.max(1, Array.isArray(med?.scheduleTimes) ? med.scheduleTimes.length : 0), 0);
  return perDay * daysInRange;
}

export function buildDataQualityIndicators(data, options = {}) {
  const startDate = dateKey(options.startDate);
  const endDate = dateKey(options.endDate);
  const daysInRange = countDaysInclusive(startDate, endDate);

  const checkins = (data.checkins || []).filter((entry) => inRange(dateKey(entry?.date), startDate, endDate));
  const adherence = (data.adherence || []).filter((entry) => inRange(dateKey(entry?.date), startDate, endDate));
  const experiments = (data.medicationChangeExperiments || []).filter((entry) => inRange(dateKey(entry?.dateEffective || entry?.date), startDate, endDate));
  const sideEffects = (data.sideEffectEvents || []).filter((entry) => inRange(dateKey(entry?.date || entry?.createdAt), startDate, endDate));

  const checkinDays = countDistinctDays(checkins, "date");
  const daysWithoutCheckin = Math.max(0, daysInRange - checkinDays);

  const expectedDoseLogs = Number.isFinite(Number(options.expectedDoseLogs))
    ? Math.max(0, Number(options.expectedDoseLogs))
    : estimateExpectedDoseCount(data.medications || [], daysInRange);
  const loggedDoseActions = adherence.length;
  const missingDoseLogs = Math.max(0, expectedDoseLogs - loggedDoseActions);

  const incompleteExperiments = experiments.filter((entry) => {
    return !String(entry?.medicationName || "").trim()
      || !String(entry?.oldDose || "").trim()
      || !String(entry?.newDose || "").trim()
      || !String(entry?.reasonForChange || entry?.reason || "").trim();
  }).length;

  const lowConfidenceEntries = experiments.filter((entry) => String(entry?.confidenceInOutcome || "").toLowerCase() === "low").length
    + sideEffects.filter((entry) => String(entry?.confidenceRelatedToMed || "").toLowerCase() === "low").length;

  return {
    startDate,
    endDate,
    daysInRange,
    checkinDays,
    daysWithoutCheckin,
    expectedDoseLogs,
    loggedDoseActions,
    missingDoseLogs,
    incompleteExperiments,
    lowConfidenceEntries
  };
}
