import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
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
      <PageHeading
        title="Zones"
        description="Rename stations and switch unwired slots off. Disabled zones are hidden from members everywhere."
        back={{ href: "/more", label: "More" }}
        action={
          <Link
            href="/map"
            className="inline-flex min-h-10 items-center border border-border px-4 text-sm font-extrabold text-primary hover:bg-foreground/[0.07]"
          >
            Edit on map ›
          </Link>
        }
      />
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
