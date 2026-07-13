import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SchedulesManager } from "@/components/schedules-manager";
import { getPrograms } from "@/lib/programs";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Schedules — Sprinkler" };
export const dynamic = "force-dynamic";

/** Watering programs: admins edit, members view and may "Run now". */
export default async function SchedulesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const programs = await getPrograms();

  return (
    <main>
      <SchedulesManager initialPrograms={programs} admin={isAdmin(session)} />
    </main>
  );
}
