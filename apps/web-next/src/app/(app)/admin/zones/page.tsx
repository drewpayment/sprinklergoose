import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ZonesManager } from "@/components/zones-manager";
import { db } from "@/db";
import { zones } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Zones — Sprinkler" };
export const dynamic = "force-dynamic";

export default async function AdminZonesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) redirect("/");

  const zoneConfigs = await db.select().from(zones).orderBy(asc(zones.id));

  return (
    <main>
      <h2 className="mb-1 text-lg font-semibold">Zones</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Rename zones and control which ones appear on the dashboard. Members
        only see enabled zones.
      </p>
      <ZonesManager
        initialZones={zoneConfigs.map((z) => ({
          id: z.id,
          name: z.name,
          enabled: z.enabled,
        }))}
      />
    </main>
  );
}
