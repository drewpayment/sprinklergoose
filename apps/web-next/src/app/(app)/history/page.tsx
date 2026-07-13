import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HistoryList } from "@/components/history-list";
import { db } from "@/db";
import { programs } from "@/db/schema";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "History — Sprinkler" };
export const dynamic = "force-dynamic";

/** Run history — members and up. The executor writes it; we read. */
export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  // Program names for the filter select (deleted programs still show up in
  // history rows via the denormalized name; they just can't be filtered on).
  const programOptions = await db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .orderBy(asc(programs.name));

  return (
    <main>
      <h2 className="mb-1 text-lg font-semibold">History</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Every program run — scheduled, run now, skipped, or missed.
      </p>
      <HistoryList programOptions={programOptions} />
    </main>
  );
}
