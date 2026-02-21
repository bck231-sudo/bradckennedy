import test from "node:test";
import assert from "node:assert/strict";

import {
  ADHERENCE_STATUS,
  applyDoseAction,
  buildDoseState,
  createDoseOccurrenceId,
  getLocalDateKey
} from "../dose-actions.js";

function buildOwnerData() {
  return {
    medications: [
      {
        id: "med-1",
        name: "ExampleMed",
        scheduleTimes: ["09:00"],
        active: true
      }
    ],
    adherence: []
  };
}

test("clicking Taken removes item from pending Today's Doses", () => {
  const now = new Date(2026, 1, 21, 10, 0, 0);
  const ownerData = buildOwnerData();
  const before = buildDoseState(ownerData.medications, ownerData.adherence, now);
  assert.equal(before.counts.remaining, 1);

  const occurrenceId = before.dueNow[0].occurrenceId;
  const nextOwnerData = applyDoseAction(ownerData, { occurrenceId, status: ADHERENCE_STATUS.TAKEN }, now);
  const after = buildDoseState(nextOwnerData.medications, nextOwnerData.adherence, now);

  assert.equal(after.counts.remaining, 0);
  assert.equal(after.counts.taken, 1);
});

test("persisted dose state survives refresh", () => {
  const now = new Date(2026, 1, 21, 10, 0, 0);
  const ownerData = buildOwnerData();
  const occurrenceId = createDoseOccurrenceId(getLocalDateKey(now), "med-1", "09:00");
  const nextOwnerData = applyDoseAction(ownerData, { occurrenceId, status: ADHERENCE_STATUS.TAKEN }, now);

  const reloaded = JSON.parse(JSON.stringify(nextOwnerData));
  const afterReload = buildDoseState(reloaded.medications, reloaded.adherence, now);
  assert.equal(afterReload.counts.remaining, 0);
  assert.equal(afterReload.counts.taken, 1);
});

test("duplicate clicks do not create duplicate adherence entries", () => {
  const now = new Date(2026, 1, 21, 10, 0, 0);
  const ownerData = buildOwnerData();
  const occurrenceId = createDoseOccurrenceId(getLocalDateKey(now), "med-1", "09:00");

  const first = applyDoseAction(ownerData, { occurrenceId, status: ADHERENCE_STATUS.TAKEN }, now);
  const second = applyDoseAction(first, { occurrenceId, status: ADHERENCE_STATUS.TAKEN }, now);

  assert.equal(second.adherence.length, 1);
  assert.equal(second.adherence[0].status, ADHERENCE_STATUS.TAKEN);
});

test("local date boundary key is used consistently for today", () => {
  const now = new Date(2026, 1, 21, 23, 59, 0);
  const todayKey = getLocalDateKey(now);
  const ownerData = buildOwnerData();
  const occurrenceId = createDoseOccurrenceId(todayKey, "med-1", "09:00");
  const nextOwnerData = applyDoseAction(ownerData, { occurrenceId, status: ADHERENCE_STATUS.SKIPPED }, now);

  assert.equal(nextOwnerData.adherence[0].date, todayKey);
  assert.equal(nextOwnerData.adherence[0].status, ADHERENCE_STATUS.SKIPPED);
});
