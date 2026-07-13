import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { notifySprinklerEvents } from "@/db/notify";
import { programs, programSteps } from "@/db/schema";
import { validateProgramInput } from "@/lib/program-validation";
import { getEnabledZoneIds, getProgram, getPrograms } from "@/lib/programs";
import {
  forbidden,
  getSession,
  isAdmin,
  jsonError,
  unauthorized,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/** Any authenticated user may view schedules (authorization matrix, M2). */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  return NextResponse.json(await getPrograms());
}

/** Only admins may create programs. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  if (!isAdmin(session)) return forbidden();

  const body = await request.json().catch(() => null);
  const result = validateProgramInput(body, await getEnabledZoneIds());
  if (!result.ok) return jsonError(422, result.detail);
  const input = result.value;

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(programs)
      .values({
        name: input.name,
        enabled: input.enabled,
        startTimes: input.start_times,
        dayType: input.day_type,
        daysOfWeek: input.days_of_week,
        intervalDays: input.interval_days,
        anchorDate: input.anchor_date,
        respectRainDelay: input.respect_rain_delay,
      })
      .returning({ id: programs.id });
    await tx.insert(programSteps).values(
      input.steps.map((s, position) => ({
        programId: created.id,
        position,
        zoneId: s.zone_id,
        minutes: s.minutes,
      })),
    );
    return created.id;
  });
  await notifySprinklerEvents();

  return NextResponse.json(await getProgram(id), { status: 201 });
}
