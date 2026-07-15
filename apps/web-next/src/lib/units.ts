// Per-user display-unit preference. Stored values and API payloads are
// metric (mm / °C) everywhere — conversion happens only at the display and
// input boundary, keyed off the user's `units` field (Better Auth).

export type Units = "metric" | "imperial";

/** DB/session value → Units (anything unrecognized falls back to metric). */
export const normalizeUnits = (v: unknown): Units =>
  v === "imperial" ? "imperial" : "metric";

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const mmToIn = (mm: number): number => mm / 25.4;
export const inToMm = (inches: number): number => inches * 25.4;

const round = (n: number, dp: number): number =>
  Math.round(n * 10 ** dp) / 10 ** dp;

/** "9.2mm" | "0.36in" — the M3 chip style (no space before the unit). */
export function formatPrecip(mm: number, units: Units): string {
  return units === "imperial"
    ? `${round(mmToIn(mm), 2)}in`
    : `${round(mm, 1)}mm`;
}

/** "18.5°C" | "65.3°F" — the map forecast-panel style. */
export function formatTemp(c: number, units: Units): string {
  return units === "imperial"
    ? `${round(cToF(c), 1)}°F`
    : `${round(c, 1)}°C`;
}

/** Whole-degree temp with a bare "°" — the hourly-strip chip style. */
export function formatTempShort(c: number, units: Units): string {
  return `${Math.round(units === "imperial" ? cToF(c) : c)}°`;
}
