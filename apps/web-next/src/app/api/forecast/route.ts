import { NextResponse } from "next/server";
import { executor, ExecutorError } from "@/lib/executor";
import { getSession, jsonError, unauthorized } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * M4.M weather forecast (docs/M4-MAP-SPEC.md) — session-required proxy to
 * the executor's GET /api/forecast (the executor is the single weather
 * owner; this route never fetches Open-Meteo itself). Member+ (same
 * visibility as the map page). On executor unreachable, respond 502 so the
 * map page can render a degraded forecast panel while the map itself keeps
 * working.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  try {
    const forecast = await executor.forecast();
    return NextResponse.json(forecast);
  } catch (e) {
    if (e instanceof ExecutorError) {
      // executorFetch throws 503 "controller unreachable" for network
      // errors/timeouts; the spec's contract for this route is 502 in that
      // case. Any other executor-reported error status passes through.
      if (e.status === 503) return jsonError(502, "executor unreachable");
      return jsonError(e.status, e.detail);
    }
    throw e;
  }
}
