import test from "node:test";
import assert from "node:assert/strict";

import { buildDataQualityIndicators, computeBeforeAfterComparison } from "../consult-engine.js";

function baseData() {
  return {
    medications: [
      {
        id: "med-1",
        name: "ExampleMed",
        active: true,
        scheduleTimes: ["08:00", "20:00"]
      }
    ],
    adherence: [
      { date: "2026-02-01", status: "taken" },
      { date: "2026-02-02", status: "taken" },
      { date: "2026-02-03", status: "skipped" },
      { date: "2026-02-04", status: "taken" }
    ],
    checkins: [
      { date: "2026-02-01", mood: 4, anxiety: 7, focus: 4, sleepHours: 5 },
      { date: "2026-02-02", mood: 5, anxiety: 6, focus: 5, sleepHours: 6 },
      { date: "2026-02-03", mood: 6, anxiety: 5, focus: 6, sleepHours: 7 },
      { date: "2026-02-04", mood: 7, anxiety: 4, focus: 7, sleepHours: 7.5 }
    ],
    notes: [
      { date: "2026-02-03", noteType: "side_effect", checklist: ["headache"] }
    ],
    sideEffectEvents: [
      { date: "2026-02-03", confidenceRelatedToMed: "low" },
      { date: "2026-02-04", confidenceRelatedToMed: "medium" }
    ],
    medicationChangeExperiments: [
      {
        id: "exp-1",
        dateEffective: "2026-02-03",
        medicationName: "ExampleMed",
        oldDose: "20 mg",
        newDose: "30 mg",
        reasonForChange: "insufficient effect",
        confidenceInOutcome: "low"
      }
    ],
    riskHistory: [
      { date: "2026-02-01", level: "watch" },
      { date: "2026-02-02", level: "low" },
      { date: "2026-02-03", level: "elevated" },
      { date: "2026-02-04", level: "watch" }
    ]
  };
}

test("before/after comparison provides observed pattern and quality note", () => {
  const result = computeBeforeAfterComparison(baseData(), "2026-02-03", { beforeDays: 2, afterDays: 2 });
  assert.equal(result.valid, true);
  assert.ok(Array.isArray(result.metrics));
  assert.ok(typeof result.summary === "string");
  assert.ok(result.summary.toLowerCase().includes("observed pattern"));
  assert.ok(result.dataQuality.note.length > 0);
});

test("before/after comparison handles missing change date safely", () => {
  const result = computeBeforeAfterComparison(baseData(), "", { beforeDays: 7, afterDays: 7 });
  assert.equal(result.valid, false);
  assert.ok(result.reason.toLowerCase().includes("missing"));
});

test("data quality indicators count missingness and low-confidence entries", () => {
  const indicators = buildDataQualityIndicators(baseData(), {
    startDate: "2026-02-01",
    endDate: "2026-02-07",
    expectedDoseLogs: 14
  });

  assert.equal(indicators.daysInRange, 7);
  assert.equal(indicators.loggedDoseActions, 4);
  assert.equal(indicators.missingDoseLogs, 10);
  assert.equal(indicators.incompleteExperiments, 0);
  assert.equal(indicators.lowConfidenceEntries, 2);
});
