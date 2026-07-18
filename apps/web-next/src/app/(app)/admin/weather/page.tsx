import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { WeatherSettings } from "@/components/weather-settings";
import { db } from "@/db";
import { weatherSettings } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Weather — Sprinkler" };
export const dynamic = "force-dynamic";

/** Admin-only (M3.S1): members are redirected; writes 403 server-side. */
export default async function AdminWeatherPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) redirect("/");

  const [row] = await db
    .select()
    .from(weatherSettings)
    .where(eq(weatherSettings.id, 1));
  if (!row) {
    throw new Error("weather_settings row missing — run migrations and seed");
  }

  return (
    <main>
      <PageHeading
        title="Weather"
        description="Let the schedule skip watering when the weather already did the job. Skipped runs appear in History with a “Water anyway” override."
        back={{ href: "/more", label: "More" }}
      />
      <WeatherSettings
        initialSettings={{
          enabled: row.enabled,
          latitude: row.latitude,
          longitude: row.longitude,
          rain_lookback_mm: row.rainLookbackMm,
          forecast_lookahead_mm: row.forecastLookaheadMm,
          freeze_temp_c: row.freezeTempC,
          updated_at: row.updatedAt.toISOString(),
        }}
      />
    </main>
  );
}
