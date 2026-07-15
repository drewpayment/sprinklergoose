"use client";

// Compact hourly forecast strip on the dashboard: everything GET
// /api/forecast has from the current hour forward (48h from the M4.M
// executor proxy), in the user's preferred units. Same 5-min visible-tab
// poll as the map's ForecastPanel. Deliberately quiet: renders nothing
// while loading, on fetch failure, when weather is disabled, or when no
// points remain — the dashboard already has its own offline banner, so
// this section never adds error noise.

import { useCallback, useEffect, useState } from "react";
import { useUnits } from "@/components/units-provider";
import { api } from "@/lib/api-client";
import type { ForecastHourlyPoint, ForecastResponse } from "@/lib/types";
import { formatPrecip, formatTempShort } from "@/lib/units";

const FORECAST_POLL_MS = 5 * 60 * 1000;

export function HourlyForecast() {
  const { units } = useUnits();
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      setForecast(await api.getForecast());
    } catch {
      setForecast(null);
    }
  }, []);

  // Poll every 5 min; pause while the tab is hidden, refetch on return
  // (same pattern as the map page's ForecastPanel).
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

  if (!forecast || !forecast.enabled) return null;

  const days = groupByDay(upcomingHours(forecast.hourly));
  if (days.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
      <h2 className="mb-2 text-[13.5px] font-semibold text-muted-foreground">
        Hourly forecast
      </h2>
      {/* Day labels are sticky against the scrollport's left edge: the
          current day's label stays pinned while its hours scroll beneath,
          and the next day's label pushes it out at the boundary — pure CSS
          wayfinding, no scroll listeners. */}
      <div className="overflow-x-auto pb-1">
        <ol className="flex w-max gap-2">
          {days.map((day, di) => (
            <li
              key={day.label}
              className={
                di > 0 ? "flex-none border-l pl-2" : "flex-none"
              }
            >
              <div className="sticky left-0 z-10 w-fit rounded-md bg-card pr-2 text-[11px] font-semibold text-muted-foreground">
                {day.label}
              </div>
              <ol className="mt-1 flex gap-1">
                {day.hours.map((p, i) => (
                  <li
                    key={p.time}
                    className={
                      di === 0 && i === 0
                        ? "flex min-w-[52px] flex-none flex-col items-center gap-0.5 rounded-xl bg-secondary px-1.5 py-2"
                        : "flex min-w-[52px] flex-none flex-col items-center gap-0.5 rounded-xl px-1.5 py-2"
                    }
                  >
                    <span className="text-[11px] text-muted-foreground">
                      {di === 0 && i === 0
                        ? "Now"
                        : new Date(p.time).toLocaleTimeString([], {
                            hour: "numeric",
                          })}
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums">
                      {formatTempShort(p.temp_c, units)}
                    </span>
                    <span
                      className={
                        p.precip_mm > 0
                          ? "text-[11px] tabular-nums text-[#2f7de1]"
                          : "text-[11px] tabular-nums text-muted-foreground opacity-50"
                      }
                    >
                      {p.precip_mm > 0 ? formatPrecip(p.precip_mm, units) : "—"}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** All forecast points from the start of the current hour forward. */
function upcomingHours(hourly: ForecastHourlyPoint[]): ForecastHourlyPoint[] {
  const currentHourStart = Date.now() - (Date.now() % (60 * 60 * 1000));
  return hourly.filter((p) => new Date(p.time).getTime() >= currentHourStart);
}

interface DayGroup {
  /** "Today" | "Wed, Jul 16" — also the sticky header text. */
  label: string;
  hours: ForecastHourlyPoint[];
}

/** Split consecutive points into local-calendar-day groups. */
function groupByDay(hours: ForecastHourlyPoint[]): DayGroup[] {
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const todayKey = dayKey(new Date());

  const groups: { key: string; label: string; hours: ForecastHourlyPoint[] }[] =
    [];
  for (const p of hours) {
    const d = new Date(p.time);
    const key = dayKey(d);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.hours.push(p);
    } else {
      groups.push({
        key,
        label:
          key === todayKey
            ? "Today"
            : d.toLocaleDateString([], {
                weekday: "short",
                month: "short",
                day: "numeric",
              }),
        hours: [p],
      });
    }
  }
  return groups;
}
