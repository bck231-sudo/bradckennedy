import test from "node:test";
import assert from "node:assert/strict";

import { computeRiskAssessment, defaultRiskConfig } from "../risk-engine.js";

test("risk status explains active triggers for missed and overdue doses", () => {
  const now = new Date("2026-02-24T12:00:00");
  const date = "2026-02-24";
  const result = computeRiskAssessment({
    now,
    checkins: [],
    notes: [],
    adherence: [
      { date, status: "skipped" }
    ],
    dueState: {
      dueNow: [{ statusLabel: "Overdue" }]
    }
  });

  assert.notEqual(result.level, "low");
  assert.ok(result.reasons.some((reason) => reason.toLowerCase().includes("missed/skipped")));
  assert.ok(result.reasons.some((reason) => reason.toLowerCase().includes("overdue")));
  assert.ok(result.reasons.length >= 2);
});

test("risk thresholds are configurable and change resulting level", () => {
  const now = new Date("2026-02-24T12:00:00");
  const checkins = [
    {
      date: "2026-02-24",
      anxiety: 8,
      sleepHours: 4,
      mood: 5,
      focus: 5
    }
  ];
  const noSigns = [];

  const conservativeThresholds = {
    ...defaultRiskConfig(),
    watchScore: 50,
    elevatedScore: 60,
    highScore: 70
  };

  const sensitiveThresholds = {
    ...defaultRiskConfig(),
    watchScore: 1,
    elevatedScore: 2,
    highScore: 3
  };

  const conservative = computeRiskAssessment({
    now,
    checkins,
    notes: [],
    adherence: [],
    dueState: { dueNow: [] },
    warningSigns: noSigns,
    riskConfig: conservativeThresholds
  });

  const sensitive = computeRiskAssessment({
    now,
    checkins,
    notes: [],
    adherence: [],
    dueState: { dueNow: [] },
    warningSigns: noSigns,
    riskConfig: sensitiveThresholds
  });

  assert.equal(conservative.level, "watch");
  assert.equal(sensitive.level, "high");
  assert.ok(sensitive.score >= conservative.score);
});
