"use client";

// The Split dashboard (design_handoff_sprinklergoose_modernist, direction 1c):
// the property plan and the zone list sit together and stay in sync — selecting
// a zone (tap a parcel on the map OR a row in the list) highlights it in both.
// The list is the primary control; the map adds spatial orientation, with a
// Plan (Modernist site-plan) / Aerial (Leaflet satellite) toggle. Live status,
// countdowns, optimistic commands and the executor 503 handling are unchanged
// (docs/M4-MAP-SPEC.md) — this is a layout + skin pass over the same behavior.

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { DashboardMap } from "@/components/dashboard-map";
import { useSharedLiveStatus } from "@/components/live-status-provider";
import { QuickRunDialog } from "@/components/quick-run-dialog";
import { RainDelayChip } from "@/components/rain-delay";
import { Button } from "@/components/ui/button";
import { useUnits } from "@/components/units-provider";
import {
  getRunningZone,
  remainingForProgramStep,
  remainingForZone,
} from "@/hooks/use-live-status";
import { api } from "@/lib/api-client";
import { formatClock, formatSeconds } from "@/lib/format";
import { formatOccurrence } from "@/lib/schedule";
import { ApiError, type DashboardZone, type ZoneMapView } from "@/lib/types";
import { formatPrecip } from "@/lib/units";
import { cn } from "@/lib/utils";

const PRESETS = [5, 10, 15, 30];

const AerialMap = dynamic(
  () => import("@/components/map/leaflet-map").then((m) => m.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[220px] w-full items-center justify-center gap-3 border-2 border-border text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-[18px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
        />
        Loading map…
      </div>
    ),
  },
);

export function Dashboard({
  admin,
  initialZones,
  fallbackCenter,
}: {
  admin: boolean;
  initialZones: ZoneMapView[];
  fallbackCenter: { lat: number; lon: number } | null;
}) {
  const live = useSharedLiveStatus();
  const { status, offline, refresh } = live;
  const { units } = useUnits();

  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [pendingMinutes, setPendingMinutes] = useState(10);
  const [custom, setCustom] = useState("");
  const [mapView, setMapView] = useState<"plan" | "aerial">("plan");
  const [busy, setBusy] = useState(false);

  const programRun = status?.program_run ?? null;
  const running = getRunningZone(live);
  const runningZoneId = running?.zoneId ?? null;
  const anyRunning = runningZoneId !== null;

  const runningZoneName =
    runningZoneId !== null
      ? (status?.zones.find((z) => z.id === runningZoneId)?.name ??
        `Zone ${runningZoneId}`)
      : "";

  const programStepRemaining = programRun
    ? remainingForProgramStep(programRun, live)
    : 0;
  const runningCountdown =
    running !== null ? formatSeconds(running.remainingSeconds) : null;

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
      setSelectedZoneId(null);
    }
  };
  const stopAll = () => void runCommand(() => api.stopAll());
  const setRainDelay = (days: number) =>
    runCommand(() => api.setRainDelay(days));

  const selectZone = (id: number) => {
    setSelectedZoneId((cur) => (cur === id ? null : id));
    setPendingMinutes(10);
    setCustom("");
  };

  const zones = status?.zones ?? [];
  const enabledZones = zones.filter((z) => z.enabled);
  const disabledZones = zones.filter((z) => !z.enabled);
  const planZones = zones.map((z) => ({
    id: z.id,
    name: z.name,
    enabled: z.enabled,
    active: z.id === runningZoneId,
  }));

  const selectedZone =
    selectedZoneId !== null
      ? zones.find((z) => z.id === selectedZoneId)
      : undefined;

  const remainingFor = (zone: DashboardZone) => remainingForZone(zone, live);

  return (
    <div className="pb-2">
      {offline && (
        <div
          role="alert"
          className="mb-5 flex items-center gap-3 border-2 border-border bg-[var(--color-warn-bg)] px-4 py-3"
        >
          <span
            aria-hidden="true"
            className="size-[18px] flex-none animate-spin rounded-full border-[2.5px] border-primary border-t-transparent"
          />
          <div>
            <strong className="block text-[15px]">Controller offline</strong>
            <span className="block text-[13px] text-muted-foreground">
              Retrying automatically
              {status?.cached_at
                ? ` — showing state from ${formatClock(status.cached_at)}`
                : ""}
            </span>
          </div>
        </div>
      )}

      {!status && !offline ? (
        <div className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-[18px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
          />
          Connecting to controller…
        </div>
      ) : (
        status && (
          <>
            {/* Running banner — full-width red field. */}
            {running && (
              <div
                role="status"
                className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 bg-primary px-4 py-3.5 text-primary-foreground md:px-6"
              >
                <span
                  aria-hidden="true"
                  className="pulse-dot size-[11px] flex-none rounded-full bg-current"
                />
                <span className="text-base font-extrabold">
                  {runningZoneName}
                </span>
                <span className="text-[13px] font-semibold opacity-85">
                  {programRun
                    ? `${programRun.program_name} · step ${
                        programRun.step_position + 1
                      } of ${programRun.total_steps}`
                    : "Manual run"}
                </span>
                <span className="ml-auto text-2xl leading-none font-extrabold tabular-nums">
                  {formatSeconds(
                    programRun ? programStepRemaining : running.remainingSeconds,
                  )}
                </span>
                <button
                  type="button"
                  onClick={stopAll}
                  disabled={busy || offline}
                  className="border-[1.5px] border-current px-4 py-2 text-sm font-extrabold disabled:opacity-60"
                >
                  Stop everything
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[1.55fr_1fr]">
              {/* LEFT — the yard */}
              <div className="md:border-r-2 md:border-border md:pr-6">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-xl md:text-2xl">Your yard</h2>
                  <div
                    className="inline-flex border border-border text-[13px]"
                    role="group"
                    aria-label="Map view"
                  >
                    {(["plan", "aerial"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setMapView(v)}
                        aria-pressed={mapView === v}
                        className={cn(
                          "px-3 py-1.5 font-semibold capitalize",
                          mapView === v
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground hover:bg-foreground/[0.07]",
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {mapView === "plan" ? (
                  <DashboardMap
                    zones={planZones}
                    selectedZoneId={selectedZoneId}
                    runningZoneId={runningZoneId}
                    runningCountdown={runningCountdown}
                    onSelect={selectZone}
                  />
                ) : (
                  <div className="h-[300px] overflow-hidden border-2 border-border md:h-[340px]">
                    <AerialMap
                      zones={initialZones}
                      admin={admin}
                      fallbackCenter={fallbackCenter}
                      runningZoneId={runningZoneId}
                      runningRemainingSeconds={running?.remainingSeconds ?? null}
                      editMode={false}
                      tool={null}
                      selectedZoneId={selectedZoneId}
                      draftPin={null}
                      draftPolygon={[]}
                      onMapClick={() => {}}
                    />
                  </div>
                )}

                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  {selectedZone ? (
                    <>
                      Selected:{" "}
                      <strong className="text-foreground">
                        {selectedZone.name}
                      </strong>{" "}
                      — set a duration in the list.
                    </>
                  ) : (
                    "Tap a zone to select it · the running zone glows with its countdown."
                  )}
                </p>

                {admin && (
                  <div className="mt-4 hidden md:block">
                    <RainDelayChip
                      days={status.rain_delay_days}
                      busy={busy}
                      offline={offline}
                      canEdit={admin}
                      onSet={setRainDelay}
                    />
                  </div>
                )}
              </div>

              {/* RIGHT — the control column */}
              <div className="mt-6 md:mt-0 md:pl-6">
                {/* Metric strip */}
                <div className="mb-5 grid grid-cols-3 border-y-2 border-border">
                  <Metric label="Sensor">
                    {status.rain_sensor_active ? "Wet" : "Dry"}
                  </Metric>
                  <Metric label="Rain 24h" divide>
                    {status.weather
                      ? formatPrecip(status.weather.past24_mm, units)
                      : "—"}
                  </Metric>
                  <Metric label="Next 6h">
                    {status.weather
                      ? formatPrecip(status.weather.next6_mm, units)
                      : status.next_scheduled
                        ? formatOccurrence(new Date(status.next_scheduled.at))
                        : "—"}
                  </Metric>
                </div>

                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="kicker">Zones</h3>
                  <QuickRunDialog
                    zones={enabledZones.map((z) => ({
                      id: z.id,
                      name: z.name,
                    }))}
                    disabled={busy || offline}
                    onSubmitted={refresh}
                  />
                </div>

                <div>
                  {enabledZones.length === 0 && (
                    <p className="border-t border-border py-4 text-[13px] text-muted-foreground">
                      All zones are disabled — enable zones in Admin → Zones.
                    </p>
                  )}
                  {enabledZones.map((zone) => (
                    <ZoneRow
                      key={zone.id}
                      zone={zone}
                      running={zone.id === runningZoneId}
                      selected={zone.id === selectedZoneId}
                      remaining={remainingFor(zone)}
                      busy={busy}
                      offline={offline}
                      pendingMinutes={pendingMinutes}
                      custom={custom}
                      onPickPreset={setPendingMinutes}
                      onCustom={setCustom}
                      onSelect={() => selectZone(zone.id)}
                      onStart={(m) => void startZone(zone.id, m)}
                      onStop={stopAll}
                    />
                  ))}
                  {disabledZones.map((zone) => (
                    <div
                      key={zone.id}
                      className="flex items-center gap-3 border-t border-border py-3.5 opacity-50 last:border-b"
                    >
                      <span className="w-[22px] text-center text-[13px] font-extrabold">
                        {zone.id}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] leading-tight font-bold">
                          {zone.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Disabled
                        </div>
                      </div>
                      <span className="bg-[var(--color-neutral-100)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--color-neutral-800)]">
                        OFF
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex gap-2.5">
                  <QuickRunDialog
                    zones={enabledZones.map((z) => ({
                      id: z.id,
                      name: z.name,
                    }))}
                    disabled={busy || offline}
                    onSubmitted={refresh}
                    trigger={
                      <Button
                        variant="outline"
                        className="min-h-12 flex-1 justify-center"
                      >
                        Quick run
                      </Button>
                    }
                  />
                  <Button
                    onClick={stopAll}
                    disabled={busy || offline || !anyRunning}
                    className="min-h-12 flex-1 justify-center"
                  >
                    Stop all
                  </Button>
                </div>

                {admin && (
                  <div className="mt-5 md:hidden">
                    <RainDelayChip
                      days={status.rain_delay_days}
                      busy={busy}
                      offline={offline}
                      canEdit={admin}
                      onSet={setRainDelay}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

function Metric({
  label,
  children,
  divide,
}: {
  label: string;
  children: React.ReactNode;
  divide?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-3 py-2.5",
        divide && "border-x border-border",
      )}
    >
      <div className="text-[9.5px] font-extrabold tracking-[0.09em] text-[var(--color-accent-700)] uppercase">
        {label}
      </div>
      <div className="text-base leading-tight font-extrabold tabular-nums">
        {children}
      </div>
    </div>
  );
}

function ZoneRow({
  zone,
  running,
  selected,
  remaining,
  busy,
  offline,
  pendingMinutes,
  custom,
  onPickPreset,
  onCustom,
  onSelect,
  onStart,
  onStop,
}: {
  zone: DashboardZone;
  running: boolean;
  selected: boolean;
  remaining: number | null;
  busy: boolean;
  offline: boolean;
  pendingMinutes: number;
  custom: string;
  onPickPreset: (m: number) => void;
  onCustom: (v: string) => void;
  onSelect: () => void;
  onStart: (minutes: number) => void;
  onStop: () => void;
}) {
  const customValid = /^\d+$/.test(custom) && +custom >= 1 && +custom <= 240;

  if (running) {
    return (
      <div className="flex items-center gap-3 border-t border-l-[3px] border-border border-l-primary bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] py-3.5 pr-1 pl-3">
        <span
          aria-hidden="true"
          className="pulse-dot size-[11px] flex-none rounded-full bg-primary"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-tight font-extrabold">
            {zone.name}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {remaining !== null
              ? `Running · ${formatSeconds(remaining)} left`
              : "Running"}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={onStop}
          disabled={busy}
          className="min-h-11 px-4"
        >
          Stop
        </Button>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="border-t border-l-[3px] border-border border-l-primary py-3.5 pl-3">
        <button
          type="button"
          onClick={onSelect}
          className="flex w-full items-center gap-3 text-left"
          aria-expanded="true"
        >
          <span className="w-[22px] text-center text-[13px] font-extrabold text-primary">
            {zone.id}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-tight font-extrabold">
              {zone.name}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Zone {zone.id} · selected on map
            </span>
          </span>
        </button>
        <div className="mt-2.5 flex gap-1.5 pl-[34px]">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onPickPreset(m)}
              className={cn(
                "flex-1 py-2.5 text-sm font-extrabold tabular-nums",
                pendingMinutes === m && !customValid
                  ? "border-[1.5px] border-primary bg-secondary text-secondary-foreground"
                  : "border border-border bg-[var(--color-surface)] text-foreground",
              )}
            >
              {m}
            </button>
          ))}
          <Button
            onClick={() => onStart(customValid ? +custom : pendingMinutes)}
            disabled={busy || offline}
            className="flex-[1.4] min-h-0 justify-center py-2.5"
          >
            Start
          </Button>
        </div>
        <form
          className="mt-2 flex gap-1.5 pl-[34px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (customValid) onStart(+custom);
          }}
        >
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Custom (1–240 min)"
            value={custom}
            aria-label={`Custom minutes for ${zone.name}`}
            onChange={(e) =>
              onCustom(e.target.value.replace(/\D/g, "").slice(0, 3))
            }
            className="min-h-10 flex-1 border border-border bg-[var(--color-surface)] px-2.5 text-sm tabular-nums caret-[var(--color-accent)] outline-none focus-visible:border-primary"
          />
        </form>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy || offline}
      className="flex w-full items-center gap-3 border-t border-border py-3.5 pl-3 text-left last:border-b disabled:opacity-60"
    >
      <span className="w-[22px] text-center text-[13px] font-extrabold text-muted-foreground">
        {zone.id}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-tight font-bold">
          {zone.name}
        </span>
        <span className="block text-[11px] text-muted-foreground">Idle</span>
      </span>
      <span className="border border-border px-4 py-2 text-sm font-extrabold">
        Start
      </span>
    </button>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
