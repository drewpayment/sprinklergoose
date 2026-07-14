// Server-side validation of weather settings writes (docs/M3-SPEC.md).
// Mirrors the spec's ranges so bad input fails with a clear 422 message.
// UI hiding is not enforcement — this runs on every PUT.

import type { WeatherSettingsInput } from "./types";

export type WeatherValidationResult =
  | { ok: true; value: WeatherSettingsInput }
  | { ok: false; detail: string };

const err = (detail: string): WeatherValidationResult => ({ ok: false, detail });

export const WEATHER_LIMITS = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
  mm: { min: 0, max: 100 },
  temp: { min: -30, max: 10 },
} as const;

function finiteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

/** Validate an untrusted PUT body into a normalized WeatherSettingsInput. */
export function validateWeatherSettingsInput(
  body: unknown,
): WeatherValidationResult {
  if (!body || typeof body !== "object") return err("invalid body");
  const b = body as Record<string, unknown>;

  if (typeof b.enabled !== "boolean") return err("invalid enabled flag");

  // Coordinates: optional while disabled, REQUIRED when enabled.
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (b.latitude !== null && b.latitude !== undefined) {
    if (
      !finiteInRange(
        b.latitude,
        WEATHER_LIMITS.latitude.min,
        WEATHER_LIMITS.latitude.max,
      )
    ) {
      return err("latitude must be a number between -90 and 90");
    }
    latitude = b.latitude;
  }
  if (b.longitude !== null && b.longitude !== undefined) {
    if (
      !finiteInRange(
        b.longitude,
        WEATHER_LIMITS.longitude.min,
        WEATHER_LIMITS.longitude.max,
      )
    ) {
      return err("longitude must be a number between -180 and 180");
    }
    longitude = b.longitude;
  }
  if ((latitude === null) !== (longitude === null)) {
    return err("provide both latitude and longitude, or neither");
  }
  if (b.enabled && (latitude === null || longitude === null)) {
    return err("a location (latitude and longitude) is required to enable weather skips");
  }

  if (
    !finiteInRange(b.rain_lookback_mm, WEATHER_LIMITS.mm.min, WEATHER_LIMITS.mm.max)
  ) {
    return err("rain lookback must be between 0 and 100 mm");
  }
  if (
    !finiteInRange(
      b.forecast_lookahead_mm,
      WEATHER_LIMITS.mm.min,
      WEATHER_LIMITS.mm.max,
    )
  ) {
    return err("forecast lookahead must be between 0 and 100 mm");
  }
  if (
    !finiteInRange(b.freeze_temp_c, WEATHER_LIMITS.temp.min, WEATHER_LIMITS.temp.max)
  ) {
    return err("freeze guard temperature must be between -30 and 10 °C");
  }

  return {
    ok: true,
    value: {
      enabled: b.enabled,
      latitude,
      longitude,
      rain_lookback_mm: b.rain_lookback_mm as number,
      forecast_lookahead_mm: b.forecast_lookahead_mm as number,
      freeze_temp_c: b.freeze_temp_c as number,
    },
  };
}
