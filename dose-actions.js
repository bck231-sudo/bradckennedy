export const ADHERENCE_STATUS = Object.freeze({
  TAKEN: "taken",
  SKIPPED: "skipped"
});

export function normalizeAdherenceStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === ADHERENCE_STATUS.SKIPPED || normalized === "missed") {
    return ADHERENCE_STATUS.SKIPPED;
  }
  if (normalized === ADHERENCE_STATUS.TAKEN || normalized === "completed" || normalized === "done") {
    return ADHERENCE_STATUS.TAKEN;
  }
  return ADHERENCE_STATUS.TAKEN;
}

export function getLocalDateKey(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createDoseOccurrenceId(dateKey, medicationId, scheduleTime) {
  return [dateKey, medicationId, scheduleTime].map((part) => encodeURIComponent(String(part || ""))).join("|");
}

export function parseDoseOccurrenceId(occurrenceId) {
  const [dateKey, medicationId, scheduleTime] = String(occurrenceId || "")
    .split("|")
    .map((part) => decodeURIComponent(part || ""));
  return { dateKey, medicationId, scheduleTime };
}

function parseLocalDateTime(dateKey, timeValue) {
  const hourMinute = String(timeValue || "00:00");
  return new Date(`${dateKey}T${hourMinute}:00`);
}

export function buildDoseState(activeMeds, adherence, now = new Date()) {
  const today = getLocalDateKey(now);
  const dueNow = [];
  const next = [];
  const taken = [];
  const skipped = [];

  for (const medication of Array.isArray(activeMeds) ? activeMeds : []) {
    const scheduleTimes = Array.isArray(medication.scheduleTimes) ? medication.scheduleTimes : [];
    for (const time of scheduleTimes) {
      const occurrenceId = createDoseOccurrenceId(today, medication.id, time);
      const existing = (Array.isArray(adherence) ? adherence : []).find(
        (entry) => entry.date === today && entry.medicationId === medication.id && entry.scheduleTime === time
      );

      const row = {
        occurrenceId,
        medicationId: medication.id,
        medicationName: medication.name,
        time
      };

      if (existing) {
        const status = normalizeAdherenceStatus(existing.status);
        if (status === ADHERENCE_STATUS.SKIPPED) {
          skipped.push({ ...row, statusLabel: "Marked skipped" });
        } else {
          taken.push({ ...row, statusLabel: "Marked taken" });
        }
        continue;
      }

      const scheduleDate = parseLocalDateTime(today, time);
      const diffMinutes = (scheduleDate.getTime() - now.getTime()) / 60000;
      if (diffMinutes <= 45) {
        dueNow.push({ ...row, statusLabel: diffMinutes < -120 ? "Overdue" : "Due now" });
      } else {
        next.push({ ...row, statusLabel: "Upcoming" });
      }
    }
  }

  dueNow.sort((left, right) => left.time.localeCompare(right.time));
  next.sort((left, right) => left.time.localeCompare(right.time));
  taken.sort((left, right) => left.time.localeCompare(right.time));
  skipped.sort((left, right) => left.time.localeCompare(right.time));

  return {
    today,
    dueNow,
    next,
    taken,
    skipped,
    counts: {
      taken: taken.length,
      remaining: dueNow.length + next.length,
      missed: skipped.length
    }
  };
}

export function applyDoseAction(ownerData, action, now = new Date()) {
  const { occurrenceId, status } = action || {};
  const { dateKey, medicationId, scheduleTime } = parseDoseOccurrenceId(occurrenceId);
  if (!dateKey || !medicationId || !scheduleTime) {
    throw new Error("Invalid dose occurrence.");
  }

  const normalizedStatus = normalizeAdherenceStatus(status);
  const medications = Array.isArray(ownerData?.medications) ? ownerData.medications : [];
  const medication = medications.find((entry) => entry.id === medicationId);
  if (!medication) {
    throw new Error("Medication not found for dose action.");
  }

  const timestamp = now.toISOString();
  const existing = Array.isArray(ownerData?.adherence) ? ownerData.adherence : [];
  const matchIndex = existing.findIndex(
    (entry) =>
      entry.date === dateKey &&
      entry.medicationId === medicationId &&
      entry.scheduleTime === scheduleTime
  );

  const nextAdherence =
    matchIndex >= 0
      ? existing.map((entry, index) =>
          index === matchIndex
            ? {
                ...entry,
                status: normalizedStatus,
                updatedAt: timestamp,
                occurrenceId: entry.occurrenceId || occurrenceId
              }
            : entry
        )
      : [
          ...existing,
          {
            id: occurrenceId,
            occurrenceId,
            date: dateKey,
            medicationId,
            medicationName: medication.name || "",
            scheduleTime,
            status: normalizedStatus,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ];

  return {
    ...ownerData,
    adherence: nextAdherence
  };
}
