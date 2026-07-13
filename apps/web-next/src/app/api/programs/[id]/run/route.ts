import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { notifySprinklerEvents } from "@/db/notify";
import { programs, runRequests } from "@/db/schema";
import { getSession, jsonError, unauthorized } from "@/lib/session";
import type { RunNowResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * "Run now" — members and up (they can already start zones). Creates a
 * run_request the executor claims; the executor does all the watering.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return jsonError(404, "unknown program");

  const [program] = await db
    .select({ id: programs.id, enabled: programs.enabled })
    .from(programs)
    .where(eq(programs.id, id));
  if (!program) return jsonError(404, "unknown program");
  if (!program.enabled) {
    return jsonError(422, "program is disabled — enable it to run");
  }

  const [created] = await db
    .insert(runRequests)
    .values({ programId: id, requestedBy: session.user.email })
    .returning({ id: runRequests.id });
  await notifySprinklerEvents();

  const body: RunNowResponse = { request_id: created.id };
  return NextResponse.json(body, { status: 202 });
}
