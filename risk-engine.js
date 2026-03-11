const RISK_LEVELS = ["low", "watch", "elevated", "high"];

export const RISK_LEVEL_META = Object.freeze({
  low: { label: "Low", tone: "low" },
  watch: { label: "Watch", tone: "watch" },
  elevated: { label: "Elevated", tone: "elevated" },
  high: { label: "High", tone: "high" }
});

export function defaultWarningSigns() {
  return [
    {
      id: "sign-missed-doses",
      label: "Missed doses",
      category: "meds",
      severityWeight: 3,
      active: true,
      thresholdConfig: {}
    },
    {
      id: "sign-low-sleep",
      label: "Sleeping less",
      category: "sleep",
      severityWeight: 2,
      active: true,
      thresholdConfig: {}
    },
    {
      id: "sign-high-anxiety",
      label: "Elevated anxiety",
      category: "mood",
      severityWeight: 2,
      active: true,
      thresholdConfig: {}
    },
    {
      id: "sign-no-checkins",
      label: "No check-ins",
      category: "custom",
      severityWeight: 2,
      active: true,
      thresholdConfig: {}
    }
  ];
}

export function defaultRiskConfig() {
  return {
    missedDoseWatch: 1,
    missedDoseElevated: 2,
    missedDoseHigh: 3,
    anxietyWatch: 7,
    anxietyHigh: 9,
    lowSleepHours: 5.5,
    noCheckinHours: 30,
    sideEffectsWindowDays: 3,
    sideEffectsTriggerCount: 3,
    watchScore: 3,
    elevatedScore: 6,
    highScore: 9
  };
}

export function normalizeWarningSigns(input) {
  const source = Array.isArray(input) ? input : defaultWarningSigns();
  return source
    .map((entry, index) => ({
      id: String(entry?.id || `warning-sign-${index + 1}`),
      label: String(entry?.label || "Warning sign").trim(),
      category: normalizeCategory(entry?.category),
      severityWeight: normalizeWeight(entry?.severityWeight),
      active: entry?.active !== false,
      thresholdConfig: entry?.thresholdConfig && typeof entry.thresholdConfig === "object" ? entry.thresholdConfig : {}
    }))
    .filter((entry) => entry.label);
}

export function normalizeRiskConfig(input) {
  const defaults = defaultRiskConfig();
  return {
    missedDoseWatch: clampInt(input?.missedDoseWatch, 0, 10, defaults.missedDoseWatch),
    missedDoseElevated: clampInt(input?.missedDoseElevated, 0, 10, defaults.missedDoseElevated),
    missedDoseHigh: clampInt(input?.missedDoseHigh, 0, 10, defaults.missedDoseHigh),
    anxietyWatch: clampInt(input?.anxietyWatch, 1, 10, defaults.anxietyWatch),
    anxietyHigh: clampInt(input?.anxietyHigh, 1, 10, defaults.anxietyHigh),
    lowSleepHours: clampFloat(input?.lowSleepHours, 0, 24, defaults.lowSleepHours),
    noCheckinHours: clampInt(input?.noCheckinHours, 1, 168, defaults.noCheckinHours),
    sideEffectsWindowDays: clampInt(input?.sideEffectsWindowDays, 1, 30, defaults.sideEffectsWindowDays),
    sideEffectsTriggerCount: clampInt(input?.sideEffectsTriggerCount, 1, 50, defaults.sideEffectsTriggerCount),
    watchScore: clampInt(input?.watchScore, 1, 100, defaults.watchScore),
    elevatedScore: clampInt(input?.elevatedScore, 1, 100, defaults.elevatedScore),
    highScore: clampInt(input?.highScore, 1, 100, defaults.highScore)
  };
}

export function computeRiskAssessment({
  now = new Date(),
  checkins = [],
  notes = [],
  adherence = [],
  dueState = null,
  warningSigns = defaultWarningSigns(),
  riskConfig = defaultRiskConfig()
} = {}) {
  const config = normalizeRiskConfig(riskConfig);
  const normalizedSigns = normalizeWarningSigns(warningSigns).filter((entry) => entry.active);
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const todayKey = toLocalDateKey(now);
  const reasons = [];
  const triggeredSigns = [];
  let score = 0;
  let levelFloor = "low";

  const latestCheckin = [...checkins]
    .filter((entry) => entry?.date)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0] || null;

  const latestCheckinMs = latestCheckin ? Date.parse(`${latestCheckin.date}T12:00:00`) : NaN;
  if (!Number.isFinite(latestCheckinMs) || (nowMs - latestCheckinMs) / 3600000 > config.noCheckinHours) {
    score += 2;
    reasons.push(`No recent check-in within ${config.noCheckinHours} hours.`);
    levelFloor = maxLevel(levelFloor, "watch");
  }

  const missedToday = (Array.isArray(adherence) ? adherence : []).filter(
    (entry) =>
      String(entry?.date || "") === todayKey &&
      normalizeStatus(entry?.status) === "skipped"
  ).length;

  if (missedToday >= config.missedDoseWatch) {
    score += missedToday >= config.missedDoseElevated ? 3 : 2;
    reasons.push(`${missedToday} missed/skipped dose${missedToday === 1 ? "" : "s"} logged today.`);
    if (missedToday >= config.missedDoseHigh) {
      levelFloor = maxLevel(levelFloor, "high");
    } else if (missedToday >= config.missedDoseElevated) {
      levelFloor = maxLevel(levelFloor, "elevated");
    } else {
      levelFloor = maxLevel(levelFloor, "watch");
    }
  }

  const overdueCount = countOverdue(dueState?.dueNow || []);
  if (overdueCount > 0) {
    score += Math.min(3, overdueCount);
    reasons.push(`${overdueCount} overdue dose${overdueCount === 1 ? "" : "s"} right now.`);
    levelFloor = maxLevel(levelFloor, "watch");
  }

  const latestAnxiety = toNumber(latestCheckin?.anxiety);
  if (Number.isFinite(latestAnxiety) && latestAnxiety >= config.anxietyWatch) {
    score += latestAnxiety >= config.anxietyHigh ? 3 : 2;
    reasons.push(`Anxiety check-in is ${latestAnxiety}/10.`);
    levelFloor = maxLevel(levelFloor, latestAnxiety >= config.anxietyHigh ? "elevated" : "watch");
  }

  const latestSleep = toNumber(latestCheckin?.sleepHours);
  if (Number.isFinite(latestSleep) && latestSleep <= config.lowSleepHours) {
    score += 2;
    reasons.push(`Sleep is ${latestSleep}h (below ${config.lowSleepHours}h threshold).`);
    levelFloor = maxLevel(levelFloor, "watch");
  }

  const sideEffectCount = countRecentSideEffects(checkins, notes, config.sideEffectsWindowDays, now);
  if (sideEffectCount >= config.sideEffectsTriggerCount) {
    score += 2;
    reasons.push(`Side effect flags reached ${sideEffectCount} in the last ${config.sideEffectsWindowDays} days.`);
    levelFloor = maxLevel(levelFloor, "watch");
  }

  for (const sign of normalizedSigns) {
    if (isWarningSignTriggered(sign, { latestCheckin, missedToday, overdueCount, notes, now })) {
      triggeredSigns.push(sign);
      score += sign.severityWeight;
      reasons.push(`Warning sign triggered: ${sign.label}.`);
    }
  }

  let scoreLevel = "low";
  if (score >= config.highScore) {
    scoreLevel = "high";
  } else if (score >= config.elevatedScore) {
    scoreLevel = "elevated";
  } else if (score >= config.watchScore) {
    scoreLevel = "watch";
  }

  const level = maxLevel(levelFloor, scoreLevel);
  const dedupedReasons = dedupe(reasons).slice(0, 8);

  return {
    level,
    label: RISK_LEVEL_META[level].label,
    score,
    reasons: dedupedReasons,
    triggeredSigns,
    latestCheckinDate: latestCheckin?.date || "",
    missedToday,
    overdueCount,
    sideEffectCount
  };
}

function normalizeLevel(value, fallback = "low") {
  const normalized = String(value || "").trim().toLowerCase();
  return RISK_LEVELS.includes(normalized) ? normalized : fallback;
}

function levelRank(level) {
  return RISK_LEVELS.indexOf(normalizeLevel(level, "low"));
}

function maxLevel(left, right) {
  return levelRank(left) >= levelRank(right) ? normalizeLevel(left, "low") : normalizeLevel(right, "low");
}

function normalizeCategory(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["sleep", "mood", "meds", "behaviour", "social", "custom"].includes(normalized)) {
    return normalized;
  }
  return "custom";
}

function normalizeWeight(value) {
  return clampInt(value, 1, 5, 2);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampFloat(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toLocalDateKey(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "skipped" || normalized === "missed") return "skipped";
  if (normalized === "taken" || normalized === "completed" || normalized === "done") return "taken";
  return normalized;
}

function countOverdue(items) {
  return (Array.isArray(items) ? items : []).filter((entry) =>
    String(entry?.statusLabel || "").toLowerCase().includes("overdue")
  ).length;
}

function countRecentSideEffects(checkins, notes, windowDays, now) {
  const nowDate = now instanceof Date ? now : new Date();
  const cutoff = new Date(nowDate);
  cutoff.setDate(cutoff.getDate() - Math.max(1, Number(windowDays || 1)) + 1);
  const cutoffKey = toLocalDateKey(cutoff);
  let total = 0;

  for (const checkin of Array.isArray(checkins) ? checkins : []) {
    if (!checkin?.date || String(checkin.date) < cutoffKey) continue;
    total += Array.isArray(checkin.sideEffectsChecklist) ? checkin.sideEffectsChecklist.length : 0;
    if (checkin.sideEffectsText) total += 1;
  }

  for (const note of Array.isArray(notes) ? notes : []) {
    if (!note?.date || String(note.date) < cutoffKey) continue;
    if (String(note.noteType || "") === "side_effect") {
      total += Math.max(1, Array.isArray(note.checklist) ? note.checklist.length : 0);
    }
  }

  return total;
}

function isWarningSignTriggered(sign, context) {
  const category = sign.category;
  if (category === "meds") {
    return context.missedToday > 0 || context.overdueCount > 0;
  }
  if (category === "sleep") {
    const sleepHours = toNumber(context.latestCheckin?.sleepHours);
    return Number.isFinite(sleepHours) && sleepHours <= 5.5;
  }
  if (category === "mood") {
    const mood = toNumber(context.latestCheckin?.mood);
    const anxiety = toNumber(context.latestCheckin?.anxiety);
    return (Number.isFinite(mood) && mood <= 4) || (Number.isFinite(anxiety) && anxiety >= 7);
  }
  if (category === "custom" && sign.label.toLowerCase().includes("no check")) {
    const latestCheckinDate = context.latestCheckin?.date;
    if (!latestCheckinDate) return true;
    const last = Date.parse(`${latestCheckinDate}T12:00:00`);
    if (!Number.isFinite(last)) return true;
    return (context.now.getTime() - last) / 3600000 > 24;
  }

  const noteText = (Array.isArray(context.notes) ? context.notes : [])
    .slice()
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
    .slice(0, 14)
    .map((entry) => `${entry.noteText || ""} ${(entry.tags || []).join(" ")}`)
    .join(" ")
    .toLowerCase();

  const keywords = String(sign.label || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  if (!keywords.length) return false;
  return keywords.some((keyword) => noteText.includes(keyword));
}

function dedupe(items) {
  return Array.from(new Set((Array.isArray(items) ? items : []).map((item) => String(item || "").trim()).filter(Boolean)));
}
