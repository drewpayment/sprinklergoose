"use client";

// Port of the v1 dashboard (apps/web/src/App.tsx): 5s polling paused when
// hidden, client-side countdown between polls, offline banner with cached
// state, presets + custom durations, stop-all bar, rain sensor/delay chips.
// Polling itself lives in the shared use-live-status hook (also used by the
// M4.M map page) — this component's behavior is unchanged (docs/M4-MAP-SPEC.md W7).

import { CalendarClock, CloudRain } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { HourlyForecast } from "@/components/hourly-forecast";
import { QuickRunDialog } from "@/components/quick-run-dialog";
import { RainDelayChip } from "@/components/rain-delay";
import { useUnits } from "@/components/units-provider";
import { ZoneCard } from "@/components/zone-card";
import {
  remainingForProgramStep,
  remainingForZone,
  useLiveStatus,
} from "@/hooks/use-live-status";
import { api } from "@/lib/api-client";
import { formatClock, formatSeconds } from "@/lib/format";
import { formatOccurrence } from "@/lib/schedule";
import { ApiError, type DashboardZone } from "@/lib/types";
import { formatPrecip } from "@/lib/units";

export function Dashboard({ admin }: { admin: boolean }) {
  const live = useLiveStatus();
  const { status, offline, refresh } = live;
  const { units } = useUnits();
  const [expandedZone, setExpandedZone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const anyRunning = status?.zones.some((z) => z.active) ?? false;
  const programRun = status?.program_run ?? null;

  const remainingFor = (zone: DashboardZone): number | null =>
    remainingForZone(zone, live);

  // Countdown for the running program's current step, ticked between polls.
  const programStepRemaining = (): number => {
    if (!programRun) return 0;
    return remainingForProgramStep(programRun, live);
  };

  const programStepZoneName = (): string => {
    if (!programRun) return "";
    return (
      status?.zones.find((z) => z.id === programRun.step_zone_id)?.name ??
      `Zone ${programRun.step_zone_id}`
    );
  };

  /** Run a command, then refetch promptly to verify. Returns success. */
  const runCommand = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        await refresh();
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          // The executor reports distinct 503 causes ("controller
          // unreachable", "zone config unavailable"…) — surface whichever.
          toast.error(`${capitalize(e.detail)} — command not sent`);
        } else if (e instanceof ApiError && e.status !== 0) {
          toast.error(capitalize(e.detail));
        } else {
          toast.error("Network error — command not sent");
        }
        void refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const startZone = async (id: number, minutes: number) => {
    if (await runCommand(() => api.startZone(id, minutes))) {
      setExpandedZone(null);
    }
  };
  const stopAll = () => void runCommand(() => api.stopAll());
  const setRainDelay = (days: number) =>
    runCommand(() => api.setRainDelay(days));

  return (
    <div>
      {status?.controller && (
        <p className="mb-3 text-[13.5px] text-muted-foreground">
          {status.controller.model} · firmware {status.controller.firmware}
        </p>
      )}

      {offline && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-xl border border-warn-border bg-warn-bg px-4 py-3 text-warn-text"
        >
          <span
            aria-hidden="true"
            className="h-[18px] w-[18px] flex-none animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
          />
          <div>
            <strong className="block text-[15px]">Controller offline</strong>
            <span className="block text-[13px] opacity-90">
              Retrying automatically
              {status?.cached_at
                ? ` — showing state from ${formatClock(status.cached_at)}`
                : ""}
            </span>
          </div>
        </div>
      )}

      {status ? (
        <>
          {programRun && (
            <div
              role="status"
              className="mb-4 rounded-2xl border border-primary bg-gradient-to-b from-secondary to-card to-85% p-4 ring-1 ring-primary"
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="pulse-dot h-2.5 w-2.5 flex-none rounded-full bg-primary"
                />
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">
                  Running: {programRun.program_name}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="text-[28px] leading-none font-bold tracking-tight tabular-nums text-primary dark:text-secondary-foreground">
                  {formatSeconds(programStepRemaining())}
                </span>
                <span className="text-sm text-muted-foreground">
                  left on {programStepZoneName()} · step{" "}
                  {programRun.step_position + 1} of {programRun.total_steps}
                </span>
              </div>
              <button
                onClick={stopAll}
                disabled={busy || offline}
                className="mt-3 min-h-11 w-full rounded-xl bg-destructive text-[15px] font-bold text-white disabled:opacity-60"
              >
                Stop everything
              </button>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-start gap-2">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm shadow-(--shadow-card)">
              <span
                aria-hidden="true"
                className={
                  status.rain_sensor_active
                    ? "h-2 w-2 rounded-full bg-[#2f7de1]"
                    : "h-2 w-2 rounded-full bg-muted-foreground opacity-60"
                }
              />
              Rain sensor: {status.rain_sensor_active ? "wet" : "dry"}
            </span>
            <RainDelayChip
              days={status.rain_delay_days}
              busy={busy}
              offline={offline}
              canEdit={admin}
              onSet={setRainDelay}
            />
            {status.next_scheduled && (
              <span className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm shadow-(--shadow-card)">
                <CalendarClock
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                Next: {status.next_scheduled.program_name} ·{" "}
                {formatOccurrence(new Date(status.next_scheduled.at))}
              </span>
            )}
            {status.weather && (
              <span className="inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm shadow-(--shadow-card)">
                <CloudRain
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
                24h: {formatPrecip(status.weather.past24_mm, units)} · next
                6h: {formatPrecip(status.weather.next6_mm, units)}
              </span>
            )}
          </div>

          <HourlyForecast />

          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[13.5px] font-semibold text-muted-foreground">
              Zones
            </h2>
            <QuickRunDialog
              zones={status.zones
                .filter((z) => z.enabled)
                .map((z) => ({ id: z.id, name: z.name }))}
              disabled={busy || offline}
              onSubmitted={refresh}
            />
          </div>

          <main className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {status.zones.filter((z) => z.enabled).length === 0 && (
              <p className="text-[13px] text-muted-foreground">
                All zones are disabled — enable zones in Admin → Zones.
              </p>
            )}
            {status.zones
              .filter((z) => z.enabled)
              .map((zone) => (
                <ZoneCard
                  key={zone.id}
                  zone={zone}
                  remaining={remainingFor(zone)}
                  expanded={expandedZone === zone.id}
                  busy={busy}
                  offline={offline}
                  onToggleExpand={() =>
                    setExpandedZone((cur) => (cur === zone.id ? null : zone.id))
                  }
                  onStart={(minutes) => void startZone(zone.id, minutes)}
                  onStop={stopAll}
                />
              ))}
          </main>
        </>
      ) : (
        !offline && (
          <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
            />
            Connecting to controller…
          </div>
        )
      )}

      {anyRunning && !offline && (
        <button
          onClick={stopAll}
          disabled={busy}
          className="fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 min-h-14 w-[min(448px,calc(100%-32px))] -translate-x-1/2 rounded-2xl bg-destructive text-[17px] font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.3)] disabled:opacity-60"
        >
          Stop all watering
        </button>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
