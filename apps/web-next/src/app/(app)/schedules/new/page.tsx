import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProgramEditor } from "@/components/program-editor";
import { db } from "@/db";
import { zones } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "New schedule — Sprinkler" };
export const dynamic = "force-dynamic";

export default async function NewSchedulePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) redirect("/schedules");

  const enabledZones = await db
    .select({ id: zones.id, name: zones.name })
    .from(zones)
    .where(eq(zones.enabled, true))
    .orderBy(asc(zones.id));

  return (
    <main>
      <ProgramEditor zones={enabledZones} />
    </main>
  );
}
