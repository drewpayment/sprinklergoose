import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { zones } from "@/db/schema";
import { executor, ExecutorError } from "@/lib/executor";
import { getSession, jsonError, unauthorized } from "@/lib/session";

/**
 * Start an enabled zone. Any authenticated user may start enabled zones;
 * disabled zones are refused for everyone (403), unknown ids 404 —
 * matching the executor's own enforcement (defense in depth).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return unauthorized();

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return jsonError(404, "unknown zone");

  const body = await request.json().catch(() => null);
  const minutes = body?.minutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    return jsonError(422, "minutes must be an integer between 1 and 240");
  }

  const [zone] = await db.select().from(zones).where(eq(zones.id, id));
  if (!zone) return jsonError(404, "unknown zone");
  if (!zone.enabled) return jsonError(403, "zone disabled");

  try {
    const result = await executor.startZone(id, minutes);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ExecutorError) return jsonError(e.status, e.detail);
    throw e;
  }
}
