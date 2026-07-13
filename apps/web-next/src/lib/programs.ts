import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { programs, programSteps, zones } from "@/db/schema";
import type { ProgramView } from "./types";

/** "06:00:00" (pg time) -> "06:00". */
const toHHMM = (t: string) => t.slice(0, 5);

type ProgramRow = typeof programs.$inferSelect;
type StepJoinRow = {
  step: typeof programSteps.$inferSelect;
  zoneName: string | null;
  zoneEnabled: boolean | null;
};

function toView(program: ProgramRow, steps: StepJoinRow[]): ProgramView {
  return {
    id: program.id,
    name: program.name,
    enabled: program.enabled,
    start_times: [...program.startTimes].map(toHHMM).sort(),
    day_type: program.dayType as ProgramView["day_type"],
    days_of_week: program.daysOfWeek,
    interval_days: program.intervalDays,
    anchor_date: program.anchorDate,
    respect_rain_delay: program.respectRainDelay,
    updated_at: program.updatedAt.toISOString(),
    steps: steps.map(({ step, zoneName, zoneEnabled }) => ({
      id: step.id,
      position: step.position,
      zone_id: step.zoneId,
      minutes: step.minutes,
      zone_name: zoneName,
      zone_enabled: zoneEnabled ?? false,
    })),
  };
}

async function stepsFor(programId?: number): Promise<
  Map<number, StepJoinRow[]>
> {
  const base = db
    .select({
      step: programSteps,
      zoneName: zones.name,
      zoneEnabled: zones.enabled,
    })
    .from(programSteps)
    .leftJoin(zones, eq(programSteps.zoneId, zones.id))
    .orderBy(asc(programSteps.programId), asc(programSteps.position));
  const rows =
    programId === undefined
      ? await base
      : await base.where(eq(programSteps.programId, programId));

  const byProgram = new Map<number, StepJoinRow[]>();
  for (const row of rows) {
    const list = byProgram.get(row.step.programId) ?? [];
    list.push(row);
    byProgram.set(row.step.programId, list);
  }
  return byProgram;
}

export async function getPrograms(): Promise<ProgramView[]> {
  const [programRows, stepMap] = await Promise.all([
    db.select().from(programs).orderBy(asc(programs.name), asc(programs.id)),
    stepsFor(),
  ]);
  return programRows.map((p) => toView(p, stepMap.get(p.id) ?? []));
}

export async function getProgram(id: number): Promise<ProgramView | null> {
  const [programRow] = await db
    .select()
    .from(programs)
    .where(eq(programs.id, id));
  if (!programRow) return null;
  const stepMap = await stepsFor(id);
  return toView(programRow, stepMap.get(id) ?? []);
}

export async function getEnabledZoneIds(): Promise<Set<number>> {
  const rows = await db
    .select({ id: zones.id })
    .from(zones)
    .where(eq(zones.enabled, true));
  return new Set(rows.map((r) => r.id));
}
