import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { zones } from "@/db/schema";
import { executor, ExecutorError } from "@/lib/executor";
import { getSession, isAdmin, jsonError, unauthorized } from "@/lib/session";
import type { DashboardStatus, DashboardZone } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Merged dashboard status: executor live state (active, remaining_seconds)
 * + app-owned zone config (name, enabled). Members never see disabled zones.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  const admin = isAdmin(session);
  const zoneConfigs = await db.select().from(zones).orderBy(asc(zones.id));

  try {
    const status = await executor.status();
    const liveById = new Map(status.zones.map((z) => [z.id, z]));

    const merged: DashboardZone[] = zoneConfigs
      .filter((z) => admin || z.enabled)
      .map((z) => ({
        id: z.id,
        name: z.name,
        enabled: z.enabled,
        active: liveById.get(z.id)?.active ?? false,
        remaining_seconds: liveById.get(z.id)?.remaining_seconds ?? null,
      }));

    const body: DashboardStatus = {
      controller: status.controller,
      zones: merged,
      rain_sensor_active: status.rain_sensor_active,
      rain_delay_days: status.rain_delay_days,
      reachable: status.reachable,
      cached_at: status.cached_at ?? null,
      // M2: scheduler state, passed through from the executor. Older
      // executors don't send these yet — default to null.
      program_run: status.program_run ?? null,
      next_scheduled: status.next_scheduled ?? null,
    };
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof ExecutorError) return jsonError(e.status, e.detail);
    throw e;
  }
}
