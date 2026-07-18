"use client";

// Program editor (M2): name, day rule, start times, ordered steps, rain-delay
// toggle. Client validation mirrors the server (which mirrors the DB) so every
// M2.S2 case gets a clear inline message before a request is even sent.

import {
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { DAY_LABELS, formatTimeOfDay } from "@/lib/schedule";
import {
  ApiError,
  type DayType,
  type ProgramInput,
  type ProgramView,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface ZoneOption {
  id: number;
  name: string;
}

interface StepDraft {
  key: number;
  zoneId: number | null;
  minutes: string;
  /** Set when editing a program whose step zone was disabled after the fact. */
  disabledZoneName: string | null;
}

interface Errors {
  name?: string;
  days?: string;
  interval?: string;
  anchor?: string;
  times?: (string | undefined)[];
  timesGeneral?: string;
  steps?: ({ zone?: string; minutes?: string } | undefined)[];
  stepsGeneral?: string;
}

let keySeq = 0;
const nextKey = () => ++keySeq;

const inputClass = "min-h-11 text-[15px]";
const selectClass =
  "min-h-11 w-full appearance-none border border-input bg-[var(--color-surface)] py-1 pr-9 pl-3 text-[15px] outline-none focus-visible:border-primary";

export function ProgramEditor({
  zones,
  program,
}: {
  /** Enabled zones only — disabled zones are never offered (M2.S7). */
  zones: ZoneOption[];
  program?: ProgramView;
}) {
  const router = useRouter();
  const editing = program !== undefined;

  const [name, setName] = useState(program?.name ?? "");
  const [dayType, setDayType] = useState<DayType>(
    program?.day_type ?? "days_of_week",
  );
  const [days, setDays] = useState<Set<number>>(
    () => new Set(program?.days_of_week ?? []),
  );
  const [intervalDays, setIntervalDays] = useState(
    program?.interval_days ? String(program.interval_days) : "2",
  );
  const [anchorDate, setAnchorDate] = useState(program?.anchor_date ?? "");
  const [times, setTimes] = useState<string[]>(
    program ? [...program.start_times] : ["06:00"],
  );
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    program
      ? program.steps.map((s) => ({
          key: nextKey(),
          zoneId: s.zone_id,
          minutes: String(s.minutes),
          disabledZoneName: s.zone_enabled
            ? null
            : (s.zone_name ?? `Zone ${s.zone_id}`),
        }))
      : [{ key: nextKey(), zoneId: null, minutes: "15", disabledZoneName: null }],
  );
  const [respectRainDelay, setRespectRainDelay] = useState(
    program?.respect_rain_delay ?? true,
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const totalMinutes = useMemo(
    () =>
      steps.reduce((sum, s) => {
        const m = Number(s.minutes);
        return sum + (Number.isInteger(m) && m > 0 ? m : 0);
      }, 0),
    [steps],
  );

  const enabledZoneIds = useMemo(() => new Set(zones.map((z) => z.id)), [zones]);

  function validate(): Errors {
    const e: Errors = {};
    const trimmed = name.trim();
    if (trimmed.length === 0) e.name = "Give the schedule a name";
    else if (trimmed.length > 60) e.name = "Keep the name to 60 characters";

    if (dayType === "days_of_week") {
      if (days.size === 0) e.days = "Pick at least one day";
    } else {
      const n = Number(intervalDays);
      if (!Number.isInteger(n) || n < 1) {
        e.interval = "Interval must be a whole number of days, at least 1";
      }
      if (!anchorDate) {
        e.anchor = "Pick a starting date so we know which days it runs";
      }
    }

    if (times.length === 0) {
      e.timesGeneral = "Add at least one start time";
    } else {
      const timeErrors: (string | undefined)[] = times.map(() => undefined);
      const seen = new Map<string, number>();
      times.forEach((t, i) => {
        if (!/^\d{2}:\d{2}$/.test(t)) {
          timeErrors[i] = "Pick a time";
          return;
        }
        const firstIndex = seen.get(t);
        if (firstIndex !== undefined) {
          timeErrors[i] = `Same as start time ${firstIndex + 1} — remove one`;
        } else {
          seen.set(t, i);
        }
      });
      if (timeErrors.some(Boolean)) e.times = timeErrors;
    }

    if (steps.length === 0) {
      e.stepsGeneral = "Add at least one zone to water";
    } else {
      const stepErrors = steps.map((s) => {
        const se: { zone?: string; minutes?: string } = {};
        if (s.zoneId === null) se.zone = "Pick a zone";
        else if (!enabledZoneIds.has(s.zoneId)) {
          se.zone = "This zone is disabled — pick another or remove the step";
        }
        const m = Number(s.minutes);
        if (!/^\d+$/.test(s.minutes) || m < 1 || m > 240) {
          se.minutes = "1–240 minutes";
        }
        return Object.keys(se).length > 0 ? se : undefined;
      });
      if (stepErrors.some(Boolean)) e.steps = stepErrors;
    }
    return e;
  }

  const save = async () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Fix the highlighted fields to save");
      return;
    }
    const input: ProgramInput = {
      name: name.trim(),
      enabled: program?.enabled ?? true,
      start_times: [...times].sort(),
      day_type: dayType,
      days_of_week:
        dayType === "days_of_week"
          ? [...days].sort((a, b) => a - b)
          : null,
      interval_days: dayType === "interval" ? Number(intervalDays) : null,
      anchor_date: dayType === "interval" ? anchorDate : null,
      respect_rain_delay: respectRainDelay,
      steps: steps.map((s) => ({
        zone_id: s.zoneId as number,
        minutes: Number(s.minutes),
      })),
    };
    setSaving(true);
    try {
      if (editing) await api.updateProgram(program.id, input);
      else await api.createProgram(input);
      toast.success(editing ? "Schedule saved" : "Schedule created");
      router.push("/schedules");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Save failed");
      setSaving(false);
    }
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    setSteps((ss) => {
      const target = index + delta;
      if (target < 0 || target >= ss.length) return ss;
      const next = [...ss];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const fieldError = (msg?: string) =>
    msg ? (
      <p role="alert" className="mt-1.5 text-[13px] font-medium text-destructive">
        {msg}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeading
        title={editing ? `Edit · ${program.name}` : "New schedule"}
        description="Times are local wall-clock times."
        back={{ href: "/schedules", label: "Schedules" }}
      />

      {/* Name + day rule */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <Label htmlFor="program-name" className="mb-2">
          Name
        </Label>
        <Input
          id="program-name"
          value={name}
          maxLength={60}
          placeholder="e.g. Lawn — morning"
          aria-invalid={errors.name ? true : undefined}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        {fieldError(errors.name)}

        <p className="kicker mt-4 mb-2">Runs on</p>
        <div
          role="radiogroup"
          aria-label="Day rule"
          className="grid grid-cols-2 border border-border"
        >
          {(
            [
              ["days_of_week", "Days of week"],
              ["interval", "Every N days"],
            ] as const
          ).map(([value, label], i) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={dayType === value}
              onClick={() => setDayType(value)}
              className={cn(
                "min-h-10 text-sm font-semibold transition-colors",
                i > 0 && "border-l border-border",
                dayType === value
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-foreground/[0.07]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {dayType === "days_of_week" ? (
          <>
            <div className="mt-3 grid grid-cols-7 border border-border">
              {DAY_LABELS.map((label, day) => {
                const selected = days.has(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setDays((d) => {
                        const next = new Set(d);
                        if (next.has(day)) next.delete(day);
                        else next.add(day);
                        return next;
                      })
                    }
                    className={cn(
                      "min-h-11 text-[13px] font-extrabold transition-colors [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border sm:text-sm",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.07]",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {fieldError(errors.days)}
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
            <div>
              <Label htmlFor="interval-days" className="mb-2">
                Every
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="interval-days"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={intervalDays}
                  aria-invalid={errors.interval ? true : undefined}
                  onChange={(e) =>
                    setIntervalDays(e.target.value.replace(/\D/g, "").slice(0, 3))
                  }
                  className={cn(inputClass, "w-20 text-center tabular-nums")}
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              {fieldError(errors.interval)}
            </div>
            <div>
              <Label htmlFor="anchor-date" className="mb-2">
                Starting
              </Label>
              <Input
                id="anchor-date"
                type="date"
                value={anchorDate}
                aria-invalid={errors.anchor ? true : undefined}
                onChange={(e) => setAnchorDate(e.target.value)}
                className={cn(inputClass, "w-44")}
              />
              {fieldError(errors.anchor)}
            </div>
          </div>
        )}
      </section>

      {/* Start times */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <p className="text-sm font-medium">Start times</p>
        <p className="mt-0.5 mb-3 text-[13px] text-muted-foreground">
          The full zone sequence runs at each time.
        </p>
        <div className="flex flex-col gap-2">
          {times.map((t, i) => (
            <div key={i}>
              <div className="flex items-center gap-2">
                <Clock
                  aria-hidden="true"
                  className="size-4 flex-none text-muted-foreground"
                />
                <Input
                  type="time"
                  value={t}
                  aria-label={`Start time ${i + 1}`}
                  aria-invalid={errors.times?.[i] ? true : undefined}
                  onChange={(e) =>
                    setTimes((ts) =>
                      ts.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  className={cn(inputClass, "w-36 tabular-nums")}
                />
                {t && /^\d{2}:\d{2}$/.test(t) && (
                  <span className="text-sm text-muted-foreground">
                    {formatTimeOfDay(t)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={times.length === 1}
                  aria-label={`Remove start time ${i + 1}`}
                  onClick={() =>
                    setTimes((ts) => ts.filter((_, j) => j !== i))
                  }
                  className="ml-auto size-10 rounded-xl text-muted-foreground"
                >
                  <X />
                </Button>
              </div>
              {fieldError(errors.times?.[i])}
            </div>
          ))}
        </div>
        {fieldError(errors.timesGeneral)}
        <Button
          variant="outline"
          onClick={() => setTimes((ts) => [...ts, ""])}
          className="mt-3 min-h-10 rounded-xl px-3.5 font-semibold"
        >
          <Plus data-slot="icon" />
          Add start time
        </Button>
      </section>

      {/* Steps */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Zones, in order</p>
          <p className="text-[13px] text-muted-foreground tabular-nums">
            {steps.length} zone{steps.length === 1 ? "" : "s"} · {totalMinutes}{" "}
            min total
          </p>
        </div>
        <p className="mt-0.5 mb-3 text-[13px] text-muted-foreground">
          Zones water one at a time, top to bottom.
        </p>

        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const stepErr = errors.steps?.[i];
            return (
              <li
                key={step.key}
                className="rounded-xl border bg-background p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex size-7 flex-none items-center justify-center bg-primary text-[13px] font-extrabold text-primary-foreground tabular-nums"
                  >
                    {i + 1}
                  </span>

                  <div className="relative min-w-0 flex-1">
                    <select
                      value={step.zoneId ?? ""}
                      aria-label={`Zone for step ${i + 1}`}
                      aria-invalid={stepErr?.zone ? true : undefined}
                      onChange={(e) =>
                        setSteps((ss) =>
                          ss.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  zoneId: e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                  disabledZoneName: null,
                                }
                              : s,
                          ),
                        )
                      }
                      className={cn(
                        selectClass,
                        stepErr?.zone && "border-destructive",
                      )}
                    >
                      <option value="" disabled>
                        Pick a zone…
                      </option>
                      {step.disabledZoneName !== null && step.zoneId !== null && (
                        <option value={step.zoneId} disabled>
                          {step.disabledZoneName} (disabled)
                        </option>
                      )}
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={step.minutes}
                      aria-label={`Minutes for step ${i + 1}`}
                      aria-invalid={stepErr?.minutes ? true : undefined}
                      onChange={(e) =>
                        setSteps((ss) =>
                          ss.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  minutes: e.target.value
                                    .replace(/\D/g, "")
                                    .slice(0, 3),
                                }
                              : s,
                          ),
                        )
                      }
                      className={cn(inputClass, "w-16 text-center tabular-nums")}
                    />
                    <span className="text-[13px] text-muted-foreground">min</span>
                  </div>
                </div>

                {(stepErr?.zone || stepErr?.minutes) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 pl-9">
                    {stepErr.zone && (
                      <p
                        role="alert"
                        className="flex items-center gap-1 text-[13px] font-medium text-destructive"
                      >
                        <TriangleAlert aria-hidden="true" className="size-3.5" />
                        {stepErr.zone}
                      </p>
                    )}
                    {stepErr.minutes && (
                      <p
                        role="alert"
                        className="text-[13px] font-medium text-destructive"
                      >
                        {stepErr.minutes}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-1 pl-9">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === 0}
                    aria-label={`Move step ${i + 1} up`}
                    onClick={() => moveStep(i, -1)}
                    className="size-10 rounded-xl text-muted-foreground"
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={i === steps.length - 1}
                    aria-label={`Move step ${i + 1} down`}
                    onClick={() => moveStep(i, 1)}
                    className="size-10 rounded-xl text-muted-foreground"
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={steps.length === 1 && step.zoneId === null}
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() =>
                      setSteps((ss) => ss.filter((_, j) => j !== i))
                    }
                    className="ml-auto min-h-10 rounded-xl px-3 text-muted-foreground hover:text-destructive"
                  >
                    <X data-slot="icon" />
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        {fieldError(errors.stepsGeneral)}
        <Button
          variant="outline"
          onClick={() =>
            setSteps((ss) => [
              ...ss,
              {
                key: nextKey(),
                zoneId: null,
                minutes: "15",
                disabledZoneName: null,
              },
            ])
          }
          className="mt-3 min-h-10 rounded-xl px-3.5 font-semibold"
        >
          <Plus data-slot="icon" />
          Add zone
        </Button>
      </section>

      {/* Rain delay + weather deference (one flag governs both, M3) */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              Skip when rain delay or weather says so
            </p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Scheduled runs are skipped while a rain delay is active or when
              weather rules apply. Run now always waters.
            </p>
          </div>
          <Switch
            checked={respectRainDelay}
            aria-label="Skip when rain delay or weather says so"
            onCheckedChange={setRespectRainDelay}
          />
        </div>
      </section>

      <div className="flex items-center gap-2">
        <Button
          disabled={saving}
          onClick={() => void save()}
          className="min-h-12 flex-1 rounded-xl text-[16px] font-bold"
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Create schedule"}
        </Button>
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => router.push("/schedules")}
          className="min-h-12 rounded-xl px-4 text-[15px]"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
