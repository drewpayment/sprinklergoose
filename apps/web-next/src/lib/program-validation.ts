// Server-side validation of program create/update payloads. Mirrors the DB
// constraints (docs/M2-SPEC.md shared schema) so bad input fails with a clear
// 422 message instead of a constraint violation. UI hiding is not enforcement.

import { timeToMinutes } from "./schedule";
import type { ProgramInput } from "./types";

export type ValidationResult =
  | { ok: true; value: ProgramInput }
  | { ok: false; detail: string };

const err = (detail: string): ValidationResult => ({ ok: false, detail });

const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate an untrusted request body into a normalized ProgramInput.
 * `enabledZoneIds` is the set of zone ids steps may reference — disabled or
 * unknown zones are rejected (M2.S7: the editor never offers them; the server
 * enforces it).
 */
export function validateProgramInput(
  body: unknown,
  enabledZoneIds: Set<number>,
): ValidationResult {
  if (!body || typeof body !== "object") return err("invalid body");
  const b = body as Record<string, unknown>;

  // name
  if (typeof b.name !== "string") return err("name is required");
  const name = b.name.trim();
  if (name.length < 1 || name.length > 60) {
    return err("name must be 1-60 characters");
  }

  // enabled / respect_rain_delay
  const enabled = b.enabled === undefined ? true : b.enabled;
  if (typeof enabled !== "boolean") return err("invalid enabled flag");
  const respectRainDelay =
    b.respect_rain_delay === undefined ? true : b.respect_rain_delay;
  if (typeof respectRainDelay !== "boolean") {
    return err("invalid respect_rain_delay flag");
  }

  // start_times: >=1, valid HH:MM, no duplicates
  if (!Array.isArray(b.start_times) || b.start_times.length === 0) {
    return err("at least one start time is required");
  }
  const startTimes: string[] = [];
  for (const t of b.start_times) {
    if (typeof t !== "string" || !TIME_RE.test(t)) {
      return err(`invalid start time "${String(t)}" — use HH:MM`);
    }
    const mins = timeToMinutes(t);
    if (Number.isNaN(mins)) {
      return err(`invalid start time "${t}" — use HH:MM`);
    }
    // Normalize to HH:MM so duplicates like 06:00 vs 06:00:00 collide.
    const norm = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    if (startTimes.includes(norm)) {
      return err("duplicate start times are not allowed");
    }
    startTimes.push(norm);
  }
  startTimes.sort();

  // day rule
  let daysOfWeek: number[] | null = null;
  let intervalDays: number | null = null;
  let anchorDate: string | null = null;
  if (b.day_type === "days_of_week") {
    if (!Array.isArray(b.days_of_week) || b.days_of_week.length === 0) {
      return err("select at least one day of the week");
    }
    const days = [...new Set(b.days_of_week)];
    for (const d of days) {
      if (!Number.isInteger(d) || (d as number) < 0 || (d as number) > 6) {
        return err("days_of_week values must be 0 (Mon) through 6 (Sun)");
      }
    }
    daysOfWeek = (days as number[]).sort((x, y) => x - y);
  } else if (b.day_type === "interval") {
    if (!Number.isInteger(b.interval_days) || (b.interval_days as number) < 1) {
      return err("interval must be a whole number of days, at least 1");
    }
    intervalDays = b.interval_days as number;
    if (typeof b.anchor_date !== "string" || !DATE_RE.test(b.anchor_date)) {
      return err("interval schedules need a starting date");
    }
    const [, y, mo, d] = DATE_RE.exec(b.anchor_date)!;
    const parsed = new Date(Number(y), Number(mo) - 1, Number(d));
    if (
      parsed.getFullYear() !== Number(y) ||
      parsed.getMonth() !== Number(mo) - 1 ||
      parsed.getDate() !== Number(d)
    ) {
      return err("interval starting date is not a valid date");
    }
    anchorDate = b.anchor_date;
  } else {
    return err("day_type must be 'days_of_week' or 'interval'");
  }

  // steps: >=1, enabled zones only, minutes 1-240
  if (!Array.isArray(b.steps) || b.steps.length === 0) {
    return err("at least one step is required");
  }
  const steps: { zone_id: number; minutes: number }[] = [];
  for (const [i, raw] of b.steps.entries()) {
    const s = raw as Record<string, unknown> | null;
    if (!s || typeof s !== "object") return err(`invalid step ${i + 1}`);
    if (!Number.isInteger(s.zone_id)) {
      return err(`step ${i + 1}: pick a zone`);
    }
    if (!enabledZoneIds.has(s.zone_id as number)) {
      return err(`step ${i + 1}: zone ${s.zone_id} is disabled or unknown`);
    }
    if (
      !Number.isInteger(s.minutes) ||
      (s.minutes as number) < 1 ||
      (s.minutes as number) > 240
    ) {
      return err(`step ${i + 1}: minutes must be between 1 and 240`);
    }
    steps.push({
      zone_id: s.zone_id as number,
      minutes: s.minutes as number,
    });
  }

  return {
    ok: true,
    value: {
      name,
      enabled,
      start_times: startTimes,
      day_type: b.day_type,
      days_of_week: daysOfWeek,
      interval_days: intervalDays,
      anchor_date: anchorDate,
      respect_rain_delay: respectRainDelay,
      steps,
    },
  };
}
