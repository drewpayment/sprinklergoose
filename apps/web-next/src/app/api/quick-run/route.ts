import { and, eq, inArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { notifySprinklerEvents } from "@/db/notify";
import { runRequests, zones, type QuickRunStep } from "@/db/schema";
import { getSession, jsonError, unauthorized } from "@/lib/session";
import type { QuickRunResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_STEPS = 20;

/**
 * Quick Run (docs/M3-SPEC.md M3.Q) — ad-hoc multi-zone "run now" with no
 * program. Member+ (same auth as program run-now / zone start). Rides the
 * existing run_request -> scheduler -> history pipeline: this row is a
 * synthetic request (program_id NULL, steps set) the executor claims and
 * runs as "Quick run", strictly sequential in payload order.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = await request.json().catch(() => null);
  const rawSteps = body?.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1) {
    return jsonError(400, "select at least one zone");
  }
  if (rawSteps.length > MAX_STEPS) {
    return jsonError(400, `at most ${MAX_STEPS} zones per quick run`);
  }

  const seenZoneIds = new Set<number>();
  const steps: QuickRunStep[] = [];
  for (const raw of rawSteps) {
    const zoneId = raw?.zone_id;
    const minutes = raw?.minutes;
    if (!Number.isInteger(zoneId) || zoneId < 1) {
      return jsonError(400, "each step needs a valid zone_id");
    }
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      return jsonError(400, "minutes must be an integer between 1 and 240");
    }
    if (seenZoneIds.has(zoneId)) {
      return jsonError(400, `zone ${zoneId} is selected more than once`);
    }
    seenZoneIds.add(zoneId);
    steps.push({ zone_id: zoneId, minutes });
  }

  const enabledRows = await db
    .select({ id: zones.id })
    .from(zones)
    .where(and(inArray(zones.id, [...seenZoneIds]), eq(zones.enabled, true)));
  const enabledIds = new Set(enabledRows.map((z) => z.id));
  const badZone = steps.find((s) => !enabledIds.has(s.zone_id));
  if (badZone) {
    return jsonError(
      400,
      `zone ${badZone.zone_id} is disabled or does not exist`,
    );
  }

  const [created] = await db
    .insert(runRequests)
    .values({ programId: null, steps, requestedBy: session.user.email })
    .returning({ id: runRequests.id });
  await notifySprinklerEvents();

  const responseBody: QuickRunResponse = { request_id: created.id };
  return NextResponse.json(responseBody, { status: 202 });
}
