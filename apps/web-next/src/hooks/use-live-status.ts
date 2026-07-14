"use client";

// Shared live-status polling (docs/M4-MAP-SPEC.md): GET /api/status every
// 5s, paused while the tab is hidden, refetched on return, plus a 1s
// client-side countdown tick whenever something is actively running. This
// is a straight extraction of the dashboard's original polling logic
// (apps/web-next/src/components/dashboard.tsx) so the map page can reuse it
// without duplicating it — dashboard behavior must not change (W7).

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { DashboardStatus } from "@/lib/types";

const POLL_MS = 5000;

export interface LiveStatus {
  status: DashboardStatus | null;
  /** Client clock (ms) at the moment `status` was fetched. */
  fetchedAt: number;
  /** True when the last poll failed, or the executor reported unreachable. */
  offline: boolean;
  /** Client clock (ms), ticked every 1s while something is running. */
  now: number;
  /** Re-poll immediately (e.g. right after issuing a command). */
  refresh: () => Promise<void>;
}

export function useLiveStatus(): LiveStatus {
  const [status, setStatus] = useState<DashboardStatus | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [now, setNow] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getStatus();
      const t = Date.now();
      setStatus(s);
      setFetchedAt(t);
      setNow(t);
      setFetchFailed(false);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  // Poll every 5s; pause while the tab is hidden, refetch on return.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      stop();
      if (!document.hidden) start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const offline = fetchFailed || (status !== null && !status.reachable);

  const hasCountdown =
    !offline &&
    status !== null &&
    (status.program_run !== null ||
      status.zones.some((z) => z.active && z.remaining_seconds !== null));

  // Tick the countdown down client-side between polls.
  useEffect(() => {
    if (!hasCountdown) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasCountdown]);

  return { status, fetchedAt, offline, now, refresh };
}

/** Remaining seconds for a manually-active zone, frozen while offline. */
export function remainingForZone(
  zone: { active: boolean; remaining_seconds: number | null },
  live: Pick<LiveStatus, "offline" | "fetchedAt" | "now">,
): number | null {
  if (!zone.active || zone.remaining_seconds === null) return null;
  if (live.offline) return zone.remaining_seconds; // frozen cached value
  const elapsed = Math.max(0, Math.round((live.now - live.fetchedAt) / 1000));
  return Math.max(0, zone.remaining_seconds - elapsed);
}

/** Remaining seconds for the running program's current step, ticked between polls. */
export function remainingForProgramStep(
  programRun: { step_remaining_seconds: number },
  live: Pick<LiveStatus, "offline" | "fetchedAt" | "now">,
): number {
  if (live.offline) return programRun.step_remaining_seconds; // frozen
  const elapsed = Math.max(0, Math.round((live.now - live.fetchedAt) / 1000));
  return Math.max(0, programRun.step_remaining_seconds - elapsed);
}

/**
 * The single zone currently animating on the map (docs/M4-MAP-SPEC.md):
 * either a manual run (zones[].active + remaining_seconds) or the current
 * step of a program/quick run (program_run.step_zone_id +
 * step_remaining_seconds). Manual and program runs are mutually exclusive
 * (docs/M2-SPEC.md), so at most one zone is ever running.
 */
export interface RunningZone {
  zoneId: number;
  remainingSeconds: number;
}

export function getRunningZone(live: LiveStatus): RunningZone | null {
  const { status } = live;
  if (!status || live.offline) return null;
  if (status.program_run) {
    return {
      zoneId: status.program_run.step_zone_id,
      remainingSeconds: remainingForProgramStep(status.program_run, live),
    };
  }
  const active = status.zones.find(
    (z) => z.active && z.remaining_seconds !== null,
  );
  if (active) {
    return {
      zoneId: active.id,
      remainingSeconds: remainingForZone(active, live) ?? 0,
    };
  }
  return null;
}
