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
    // Full-bleed breakout (desktop only): the shared (app)/layout.tsx shell
    // caps content at max-w-4xl (~896px), which is far too narrow for a map
    // + sidebar layout on a large screen. `relative left-1/2 -translate-x-1/2`
    // recenters this element on the *viewport* (its containing block, since
    // no ancestor is positioned) instead of the narrow shell, without
    // touching the shared layout so every other page is unaffected.
    <main className="lg:relative lg:left-1/2 lg:w-[min(96vw,1560px)] lg:-translate-x-1/2">
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
