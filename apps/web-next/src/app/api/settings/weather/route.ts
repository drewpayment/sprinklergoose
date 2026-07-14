import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { notifySprinklerEvents } from "@/db/notify";
import { weatherSettings, type WeatherSettingsRow } from "@/db/schema";
import {
  forbidden,
  getSession,
  isAdmin,
  jsonError,
  unauthorized,
} from "@/lib/session";
import type { WeatherSettingsView } from "@/lib/types";
import { validateWeatherSettingsInput } from "@/lib/weather-validation";

export const dynamic = "force-dynamic";

/**
 * Weather autonomy settings (docs/M3-SPEC.md) — the singleton row (id=1) the
 * executor reads to decide skips. Admin-only in both directions (the page is
 * admin-only; M3.S1). forecast_probability is reserved for M3.1: reads omit
 * it and writes never touch it.
 */

function toView(row: WeatherSettingsRow): WeatherSettingsView {
  return {
    enabled: row.enabled,
    latitude: row.latitude,
    longitude: row.longitude,
    rain_lookback_mm: row.rainLookbackMm,
    forecast_lookahead_mm: row.forecastLookaheadMm,
    freeze_temp_c: row.freezeTempC,
    updated_at: row.updatedAt.toISOString(),
  };
}

async function getSingleton(): Promise<WeatherSettingsRow | undefined> {
  const [row] = await db
    .select()
    .from(weatherSettings)
    .where(eq(weatherSettings.id, 1));
  return row;
}

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const row = await getSingleton();
  if (!row) return jsonError(500, "weather settings row missing — run migrations");
  return NextResponse.json(toView(row));
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const body = await request.json().catch(() => null);
  const result = validateWeatherSettingsInput(body);
  if (!result.ok) return jsonError(422, result.detail);
  const input = result.value;

  const [updated] = await db
    .update(weatherSettings)
    .set({
      enabled: input.enabled,
      latitude: input.latitude,
      longitude: input.longitude,
      rainLookbackMm: input.rain_lookback_mm,
      forecastLookaheadMm: input.forecast_lookahead_mm,
      freezeTempC: input.freeze_temp_c,
      updatedAt: new Date(),
    })
    .where(eq(weatherSettings.id, 1))
    .returning();
  if (!updated) {
    return jsonError(500, "weather settings row missing — run migrations");
  }
  // The executor refetches weather at its next evaluation on this signal.
  await notifySprinklerEvents();

  return NextResponse.json(toView(updated));
}
