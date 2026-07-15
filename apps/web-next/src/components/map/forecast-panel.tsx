"use client";

// Weather forecast panel (docs/M4-MAP-SPEC.md): current conditions, 48h
// strip chart, upcoming-runs list with prediction badges. Polls
// GET /api/forecast every 5 min while the tab is visible (same
// pause-when-hidden pattern as the live-status hook, different endpoint/
// interval so it's a small dedicated poller rather than a hook reuse).

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useUnits } from "@/components/units-provider";
import { api } from "@/lib/api-client";
import { formatOccurrence } from "@/lib/schedule";
import type { ForecastPrediction, ForecastResponse } from "@/lib/types";
import { formatPrecip, formatTemp } from "@/lib/units";
import { cn } from "@/lib/utils";
import { PrecipChart } from "./precip-chart";

const FORECAST_POLL_MS = 5 * 60 * 1000;

const PREDICTION_STYLES: Record<
  ForecastPrediction,
  { label: string; className: string }
> = {
  watering: {
    label: "Watering",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  skip_rain: {
    label: "Likely skip — rain",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  skip_forecast: {
    label: "Likely skip — forecast",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  skip_freeze: {
    label: "Likely skip — freeze",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  rain_delay: {
    label: "Rain delay",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  unknown: {
    label: "No weather data",
    className: "border-border bg-transparent text-muted-foreground",
  },
};

export function ForecastPanel() {
  const { units } = useUnits();
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const f = await api.getForecast();
      setForecast(f);
      setDegraded(false);
    } catch {
      // Covers both network errors and the route's 502 (executor
      // unreachable) — either way, show the degraded panel.
      setDegraded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 5 min; pause while the tab is hidden, refetch on return.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      void refresh();
      timer = setInterval(() => void refresh(), FORECAST_POLL_MS);
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

  if (loading) {
    return (
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card) lg:p-3">
        <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
          <span
            aria-hidden="true"
            className="h-[16px] w-[16px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
          />
          Loading forecast…
        </div>
      </section>
    );
  }

  if (degraded || !forecast) {
    return (
      <section
        role="alert"
        className="rounded-2xl border border-warn-border bg-warn-bg p-4 text-warn-text"
      >
        <p className="text-[15px] font-semibold">Forecast unavailable</p>
        <p className="mt-1 text-[13px] opacity-90">
          Couldn&apos;t reach the executor for weather data. The map still
          works — retrying automatically.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-3">
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card) lg:p-3">
        <h3 className="mb-2 text-[13.5px] font-semibold text-muted-foreground lg:mb-1.5">
          Current conditions
        </h3>
        {forecast.weather ? (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
            <span>
              <strong className="font-semibold">
                {formatTemp(forecast.weather.current_temp_c, units)}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Past 24h: {formatPrecip(forecast.weather.past24_mm, units)}
            </span>
            <span className="text-muted-foreground">
              Next 6h: {formatPrecip(forecast.weather.next6_mm, units)}
            </span>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {forecast.enabled
              ? "No current weather data yet."
              : "Weather forecasting is off — enable it in Weather settings."}
          </p>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card) lg:p-3">
        <h3 className="mb-2 text-[13.5px] font-semibold text-muted-foreground lg:mb-1.5">
          Next 48 hours
        </h3>
        <PrecipChart hourly={forecast.hourly} units={units} />
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card) lg:p-3">
        <h3 className="mb-2 text-[13.5px] font-semibold text-muted-foreground lg:mb-1.5">
          Upcoming runs
        </h3>
        {forecast.upcoming.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No scheduled runs in the next 48 hours.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {forecast.upcoming.map((run) => {
              const style = PREDICTION_STYLES[run.prediction] ?? {
                label: run.prediction,
                className: "border-border bg-transparent text-muted-foreground",
              };
              return (
                <li
                  key={`${run.program_id}-${run.at}`}
                  className="flex items-start justify-between gap-3 rounded-xl border bg-background p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">
                      {run.program_name}
                    </p>
                    <p className="text-[12.5px] text-muted-foreground">
                      {formatOccurrence(new Date(run.at))}
                    </p>
                    {run.note && (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {run.note}
                      </p>
                    )}
                  </div>
                  <Badge
                    className={cn(
                      "shrink-0 border border-transparent",
                      style.className,
                    )}
                  >
                    {style.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
