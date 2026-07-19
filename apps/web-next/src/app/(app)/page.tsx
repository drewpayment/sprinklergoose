import { asc, eq } from "drizzle-orm";
import { Dashboard } from "@/components/dashboard";
import { MarketingPage } from "@/components/marketing-page";
import { db } from "@/db";
import { weatherSettings, zones } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/session";
import type { ZoneMapView } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return <MarketingPage />;
  const admin = isAdmin(session);

  // Zone geometry + home center for the dashboard map's Aerial (Leaflet) view.
  // Members only ever receive enabled zones (same rule as the map page).
  const zoneConfigs = await db.select().from(zones).orderBy(asc(zones.id));
  const [settings] = await db
    .select()
    .from(weatherSettings)
    .where(eq(weatherSettings.id, 1));

  const initialZones: ZoneMapView[] = zoneConfigs
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
    <Dashboard
      admin={admin}
      initialZones={initialZones}
      fallbackCenter={fallbackCenter}
    />
  );
}
