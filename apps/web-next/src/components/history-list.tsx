"use client";

// Run history (M2): reverse-chron, filterable by program + status, paginated,
// with expandable per-step detail. The executor writes the rows; the only
// write here is M3's "Water anyway" — a run_request for a skipped program.

import { CalendarClock, ChevronDown, Droplets, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RunStatusBadge, StepOutcomeBadge } from "@/components/run-status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { formatSeconds } from "@/lib/format";
import {
  ApiError,
  RUN_STATUSES,
  type HistoryResponse,
  type HistoryRun,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped_rain_delay: "Rain delay",
  skipped_weather: "Weather skip",
  missed: "Missed",
};

/** Rows offering the M3 "Water anyway" override: automation skipped, a
 * human may overrule (both weather and rain-delay skips). */
const OVERRIDABLE_STATUSES = new Set(["skipped_weather", "skipped_rain_delay"]);

const selectClass =
  "min-h-10 appearance-none rounded-xl border border-input bg-card py-1 pr-8 pl-3 text-sm font-medium shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Actual watering time of a step, from its own timestamps. */
function actualDuration(step: HistoryRun["steps"][number]): string | null {
  if (!step.started_at || !step.finished_at) return null;
  const ms =
    new Date(step.finished_at).getTime() - new Date(step.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return formatSeconds(Math.round(ms / 1000));
}

export function HistoryList({
  programOptions,
}: {
  programOptions: { id: number; name: string }[];
}) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [programFilter, setProgramFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [wateringRun, setWateringRun] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getHistory({
        page,
        program: programFilter,
        status: statusFilter,
      });
      setData(res);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [page, programFilter, statusFilter]);

  // Fetch on mount and whenever a filter/page changes (the handlers flip
  // `loading` themselves; this effect only starts the async request).
  useEffect(() => {
    const run = () => void load();
    run();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  /** M3 "Water anyway": creates a run_request for the skipped program via
   * the existing run-now mechanism (member+ allowed). */
  const waterAnyway = async (run: HistoryRun) => {
    if (run.program_id === null) return;
    setWateringRun(run.id);
    try {
      await api.runProgramNow(run.program_id);
      toast.success(`${run.program_name} will start shortly`, {
        description: "Watering was requested despite the skip.",
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Request failed");
    } finally {
      setWateringRun(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative">
          <select
            value={programFilter ?? ""}
            aria-label="Filter by program"
            onChange={(e) => {
              setProgramFilter(e.target.value ? Number(e.target.value) : undefined);
              setPage(1);
              setLoading(true);
            }}
            className={selectClass}
          >
            <option value="">All programs</option>
            {programOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter ?? ""}
            aria-label="Filter by status"
            onChange={(e) => {
              setStatusFilter(e.target.value || undefined);
              setPage(1);
              setLoading(true);
            }}
            className={selectClass}
          >
            <option value="">All statuses</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>

      {failed ? (
        <div
          role="alert"
          className="rounded-xl border border-warn-border bg-warn-bg px-4 py-3 text-warn-text"
        >
          Couldn&apos;t load history — it will retry when you change a filter.
        </div>
      ) : data === null ? (
        <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
          />
          Loading history…
        </div>
      ) : data.runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-muted-foreground shadow-(--shadow-card)">
          <p className="text-[15px] font-medium">No runs yet</p>
          <p className="mt-1 text-sm">
            {programFilter || statusFilter
              ? "Nothing matches these filters."
              : "Runs will appear here once a program fires."}
          </p>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-3", loading && "opacity-60")}>
          {data.runs.map((run) => {
            const isOpen = expanded.has(run.id);
            const schedule = run.initiator === "schedule";
            return (
              <section
                key={run.id}
                className="rounded-2xl border bg-card shadow-(--shadow-card)"
              >
                <button
                  onClick={() =>
                    setExpanded((ex) => {
                      const next = new Set(ex);
                      if (next.has(run.id)) next.delete(run.id);
                      else next.add(run.id);
                      return next;
                    })
                  }
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">
                        {run.program_name}
                      </span>
                      <RunStatusBadge status={run.status} />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {schedule ? (
                          <CalendarClock aria-hidden="true" className="size-3.5" />
                        ) : (
                          <User aria-hidden="true" className="size-3.5" />
                        )}
                        {schedule ? "Schedule" : run.initiator}
                      </span>
                      {run.scheduled_for && (
                        <span>Scheduled {formatWhen(run.scheduled_for)}</span>
                      )}
                      {run.started_at ? (
                        <span>Started {formatWhen(run.started_at)}</span>
                      ) : (
                        !run.scheduled_for && <span>Not started</span>
                      )}
                    </p>
                    {run.note && (
                      <p className="mt-1 text-[13px] text-muted-foreground italic">
                        {run.note}
                      </p>
                    )}
                  </div>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-5 flex-none text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>

                {OVERRIDABLE_STATUSES.has(run.status) && (
                  <div className="flex min-h-12 items-center justify-between gap-3 border-t px-4 py-2">
                    {run.program_id !== null && run.program_enabled ? (
                      <>
                        <span className="text-[13px] text-muted-foreground">
                          Overrule the skip and water now.
                        </span>
                        <Button
                          variant="outline"
                          disabled={wateringRun !== null}
                          onClick={() => void waterAnyway(run)}
                          className="min-h-9 rounded-xl px-3 font-semibold"
                        >
                          <Droplets data-slot="icon" />
                          {wateringRun === run.id
                            ? "Requesting…"
                            : "Water anyway"}
                        </Button>
                      </>
                    ) : (
                      <span className="text-[13px] text-muted-foreground italic">
                        {run.program_id === null
                          ? "Program was deleted — it can't be watered anymore."
                          : "Program is disabled — enable it to water anyway."}
                      </span>
                    )}
                  </div>
                )}

                {isOpen && (
                  <div className="border-t px-4 pt-3 pb-4">
                    {run.steps.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">
                        No step detail recorded for this run.
                      </p>
                    ) : (
                      <ol className="flex flex-col gap-2">
                        {run.steps.map((step) => {
                          const actual = actualDuration(step);
                          return (
                            <li
                              key={step.id}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]"
                            >
                              <span
                                aria-hidden="true"
                                className="flex size-6 flex-none items-center justify-center rounded-full bg-muted text-[12px] font-bold text-muted-foreground tabular-nums"
                              >
                                {step.position + 1}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {step.zone_name}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                {actual
                                  ? `${actual} of ${step.planned_minutes}:00`
                                  : `${step.planned_minutes} min planned`}
                              </span>
                              <StepOutcomeBadge outcome={step.outcome} />
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {data !== null && data.total > data.page_size && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => {
              setPage((p) => p - 1);
              setLoading(true);
            }}
            className="min-h-10 rounded-xl px-4 font-semibold"
          >
            Newer
          </Button>
          <span className="text-[13px] text-muted-foreground tabular-nums">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages || loading}
            onClick={() => {
              setPage((p) => p + 1);
              setLoading(true);
            }}
            className="min-h-10 rounded-xl px-4 font-semibold"
          >
            Older
          </Button>
        </div>
      )}
    </div>
  );
}
