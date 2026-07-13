import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProgramEditor } from "@/components/program-editor";
import { db } from "@/db";
import { zones } from "@/db/schema";
import { getProgram } from "@/lib/programs";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Edit schedule — Sprinkler" };
export const dynamic = "force-dynamic";

export default async function EditSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) redirect("/schedules");

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const program = await getProgram(id);
  if (!program) notFound();

  const enabledZones = await db
    .select({ id: zones.id, name: zones.name })
    .from(zones)
    .where(eq(zones.enabled, true))
    .orderBy(asc(zones.id));

  return (
    <main>
      <ProgramEditor zones={enabledZones} program={program} />
    </main>
  );
}
