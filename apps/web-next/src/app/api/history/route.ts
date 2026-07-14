import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { programRuns, programRunSteps, programs } from "@/db/schema";
import { getSession, jsonError, unauthorized } from "@/lib/session";
import {
  RUN_STATUSES,
  type HistoryResponse,
  type HistoryRun,
  type RunStatus,
  type StepOutcome,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Run history — members and up. Reverse-chronological, filterable by
 * program and status, paginated. The executor writes these rows; we only read.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const q = request.nextUrl.searchParams;
  const page = Math.max(1, Number(q.get("page")) || 1);
  const filters = [];
  const programParam = q.get("program");
  if (programParam !== null) {
    const programId = Number(programParam);
    if (!Number.isInteger(programId) || programId < 1) {
      return jsonError(422, "invalid program filter");
    }
    filters.push(eq(programRuns.programId, programId));
  }
  const statusParam = q.get("status");
  if (statusParam !== null) {
    if (!RUN_STATUSES.includes(statusParam as RunStatus)) {
      return jsonError(422, "invalid status filter");
    }
    filters.push(eq(programRuns.status, statusParam));
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  // Most-recent-first by when the run happened (or should have happened).
  const happenedAt = sql`coalesce(${programRuns.startedAt}, ${programRuns.scheduledFor}, ${programRuns.finishedAt})`;
  const [runRows, [{ total }]] = await Promise.all([
    db
      // Left join: whether the program still exists and is enabled (M3 gates
      // "Water anyway" on it; deleted programs yield null).
      .select({ run: programRuns, programEnabled: programs.enabled })
      .from(programRuns)
      .leftJoin(programs, eq(programRuns.programId, programs.id))
      .where(where)
      .orderBy(desc(happenedAt), desc(programRuns.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(programRuns).where(where),
  ]);

  const stepRows =
    runRows.length > 0
      ? await db
          .select()
          .from(programRunSteps)
          .where(
            inArray(
              programRunSteps.runId,
              runRows.map((r) => r.run.id),
            ),
          )
          .orderBy(asc(programRunSteps.position))
      : [];
  const stepsByRun = new Map<number, HistoryRun["steps"]>();
  for (const s of stepRows) {
    const list = stepsByRun.get(s.runId) ?? [];
    list.push({
      id: s.id,
      position: s.position,
      zone_id: s.zoneId,
      zone_name: s.zoneName,
      planned_minutes: s.plannedMinutes,
      started_at: iso(s.startedAt),
      finished_at: iso(s.finishedAt),
      outcome: s.outcome as StepOutcome | null,
    });
    stepsByRun.set(s.runId, list);
  }

  const body: HistoryResponse = {
    runs: runRows.map(({ run: r, programEnabled }) => ({
      id: r.id,
      program_id: r.programId,
      program_name: r.programName,
      scheduled_for: iso(r.scheduledFor),
      initiator: r.initiator,
      status: r.status as RunStatus,
      started_at: iso(r.startedAt),
      finished_at: iso(r.finishedAt),
      note: r.note,
      program_enabled: r.programId === null ? null : (programEnabled ?? null),
      steps: stepsByRun.get(r.id) ?? [],
    })),
    total,
    page,
    page_size: PAGE_SIZE,
  };
  return NextResponse.json(body);
}
