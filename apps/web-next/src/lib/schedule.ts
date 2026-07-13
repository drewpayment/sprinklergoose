// Human-readable schedule rules and next-occurrence previews.
//
// Program times are LOCAL wall times in the executor's SCHEDULE_TIMEZONE
// (docs/M2-SPEC.md). Previews here are computed in the browser's local time —
// for this household deployment they are the same zone; the executor's
// next_scheduled (dashboard chip) is always authoritative.

import type { ProgramView } from "./types";

/** Spec day indexes: 0=Mon .. 6=Sun. */
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** JS Date.getDay() (0=Sun) -> spec day index (0=Mon). */
const specDay = (jsDay: number) => (jsDay + 6) % 7;

/** "06:00" | "06:00:00" -> minutes since midnight, NaN if invalid. */
export function timeToMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

/** "06:00:00" -> "6:00 AM". */
export function formatTimeOfDay(t: string): string {
  const mins = timeToMinutes(t);
  if (Number.isNaN(mins)) return t;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** "Mon/Wed/Fri" | "Every day" | "Weekends" | "Every 3 days". */
export function formatDayRule(program: {
  day_type: string;
  days_of_week: number[] | null;
  interval_days: number | null;
}): string {
  if (program.day_type === "interval") {
    const n = program.interval_days ?? 0;
    return n === 1 ? "Every day" : `Every ${n} days`;
  }
  const days = [...new Set(program.days_of_week ?? [])].sort((a, b) => a - b);
  if (days.length === 7) return "Every day";
  if (days.join() === "0,1,2,3,4") return "Weekdays";
  if (days.join() === "5,6") return "Weekends";
  return days.map((d) => DAY_LABELS[d] ?? `?${d}`).join("/");
}

/** "Mon/Wed/Fri · 6:00 AM · 4 zones · 60 min" */
export function formatRuleSummary(program: ProgramView): string {
  const times = program.start_times.map(formatTimeOfDay).join(" + ");
  const zones = `${program.steps.length} zone${program.steps.length === 1 ? "" : "s"}`;
  const totalMin = program.steps.reduce((sum, s) => sum + s.minutes, 0);
  return `${formatDayRule(program)} · ${times} · ${zones} · ${totalMin} min`;
}

/** Does the rule match the given local calendar day? */
function ruleMatchesDay(
  program: {
    day_type: string;
    days_of_week: number[] | null;
    interval_days: number | null;
    anchor_date: string | null;
  },
  day: Date,
): boolean {
  if (program.day_type === "days_of_week") {
    return (program.days_of_week ?? []).includes(specDay(day.getDay()));
  }
  const interval = program.interval_days ?? 0;
  if (interval < 1 || !program.anchor_date) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(program.anchor_date);
  if (!m) return false;
  const anchor = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const diffDays = Math.round(
    (dayStart.getTime() - anchor.getTime()) / 86_400_000,
  );
  return diffDays >= 0 && diffDays % interval === 0;
}

/**
 * Earliest occurrence strictly after `from` within the next `horizonDays`
 * local calendar days. Null when the rule never matches in the horizon.
 */
export function nextOccurrence(
  program: {
    day_type: string;
    days_of_week: number[] | null;
    interval_days: number | null;
    anchor_date: string | null;
    start_times: string[];
  },
  from: Date = new Date(),
  horizonDays = 8,
): Date | null {
  const sortedTimes = [...program.start_times]
    .map(timeToMinutes)
    .filter((m) => !Number.isNaN(m))
    .sort((a, b) => a - b);
  if (sortedTimes.length === 0) return null;

  for (let i = 0; i < horizonDays; i++) {
    const day = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + i,
    );
    if (!ruleMatchesDay(program, day)) continue;
    for (const mins of sortedTimes) {
      const at = new Date(day);
      at.setMinutes(mins);
      if (at.getTime() > from.getTime()) return at;
    }
  }
  return null;
}

/** "today 6:00 AM" | "tomorrow 6:00 AM" | "Wed 6:00 AM" | "Jul 20, 6:00 AM". */
export function formatOccurrence(at: Date, from: Date = new Date()): string {
  const time = at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOf(at) - startOf(from)) / 86_400_000);
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  if (dayDiff > 1 && dayDiff < 7) {
    return `${DAY_LABELS[specDay(at.getDay())]} ${time}`;
  }
  return `${at.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
