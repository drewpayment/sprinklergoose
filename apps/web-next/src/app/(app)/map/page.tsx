import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MapPageClient } from "@/components/map/map-page-client";
import { db } from "@/db";
import { weatherSettings, zones } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/session";
import type { ZoneMapView } from "@/lib/types";

export const metadata: Metadata = { title: "Map — Sprinkler" };
export const dynamic = "force-dynamic";

/**
 * Member-visible zone map + weather forecast (docs/M4-MAP-SPEC.md). Members
 * only ever receive enabled zones (same rule as the dashboard); admins get
 * every zone (including disabled, muted on the map) plus the edit-mode UI.
 */
export default async function MapPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const admin = isAdmin(session);

  const zoneConfigs = await db.select().from(zones).orderBy(asc(zones.id));
  const [settings] = await db
    .select()
    .from(weatherSettings)
    .where(eq(weatherSettings.id, 1));

  const zoneViews: ZoneMapView[] = zoneConfigs
    .filter((z) => admin || z.enabled)
    .map((z) => ({
      id: z.id,
      name: z.name,
      enabled: z.enabled,
      geometry: z.geometry ?? null,
    }));

  const fallbackCenter =
    settings?.latitude != null && settings?.longitude != null
      ? { lat: settings.latitude, lon: settings.longitude }
      : null;

  return (
    <main>
      <h2 className="mb-1 text-lg font-semibold">Map</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {admin
          ? "Zones on the property, satellite or street view. Toggle edit mode to place pins or draw zone boundaries."
          : "Zones on the property, satellite or street view."}
      </p>
      <MapPageClient
        admin={admin}
        initialZones={zoneViews}
        fallbackCenter={fallbackCenter}
      />
    </main>
  );
}
