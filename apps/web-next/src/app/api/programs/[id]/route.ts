import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { notifySprinklerEvents } from "@/db/notify";
import { programs, programSteps } from "@/db/schema";
import { validateProgramInput } from "@/lib/program-validation";
import { getEnabledZoneIds, getProgram } from "@/lib/programs";
import {
  forbidden,
  getSession,
  isAdmin,
  jsonError,
  unauthorized,
} from "@/lib/session";

export const dynamic = "force-dynamic";

function parseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

type Params = { params: Promise<{ id: string }> };

/** Any authenticated user may view a schedule. */
export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return unauthorized();

  const id = parseId((await params).id);
  if (id === null) return jsonError(404, "unknown program");
  const program = await getProgram(id);
  if (!program) return jsonError(404, "unknown program");
  return NextResponse.json(program);
}

/** Only admins may edit programs. Steps are replaced wholesale. */
export async function PUT(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const id = parseId((await params).id);
  if (id === null) return jsonError(404, "unknown program");

  const body = await request.json().catch(() => null);
  const result = validateProgramInput(body, await getEnabledZoneIds());
  if (!result.ok) return jsonError(422, result.detail);
  const input = result.value;

  const found = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(programs)
      .set({
        name: input.name,
        enabled: input.enabled,
        startTimes: input.start_times,
        dayType: input.day_type,
        daysOfWeek: input.days_of_week,
        intervalDays: input.interval_days,
        anchorDate: input.anchor_date,
        respectRainDelay: input.respect_rain_delay,
        updatedAt: new Date(),
      })
      .where(eq(programs.id, id))
      .returning({ id: programs.id });
    if (!updated) return false;
    await tx.delete(programSteps).where(eq(programSteps.programId, id));
    await tx.insert(programSteps).values(
      input.steps.map((s, position) => ({
        programId: id,
        position,
        zoneId: s.zone_id,
        minutes: s.minutes,
      })),
    );
    return true;
  });
  if (!found) return jsonError(404, "unknown program");
  await notifySprinklerEvents();

  return NextResponse.json(await getProgram(id));
}

/**
 * Admin-only quick toggle: enable/disable without resubmitting the whole
 * program (works even when a step's zone was disabled after the fact).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const id = parseId((await params).id);
  if (id === null) return jsonError(404, "unknown program");

  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return jsonError(422, "invalid enabled flag");
  }

  const [updated] = await db
    .update(programs)
    .set({ enabled: body.enabled, updatedAt: new Date() })
    .where(eq(programs.id, id))
    .returning({ id: programs.id });
  if (!updated) return jsonError(404, "unknown program");
  await notifySprinklerEvents();

  return NextResponse.json(await getProgram(id));
}

/** Only admins may delete programs (history survives via denormalized name). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const id = parseId((await params).id);
  if (id === null) return jsonError(404, "unknown program");

  const [deleted] = await db
    .delete(programs)
    .where(eq(programs.id, id))
    .returning({ id: programs.id });
  if (!deleted) return jsonError(404, "unknown program");
  await notifySprinklerEvents();

  return NextResponse.json({ ok: true });
}
