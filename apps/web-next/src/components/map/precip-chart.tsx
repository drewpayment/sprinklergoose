// Hand-rolled 48h precip bars + temp line (docs/M4-MAP-SPEC.md: "no chart
// library"). Plain SVG, scaled via viewBox so it's responsive without JS
// measuring. Scaling math stays on the raw metric values (unit conversion
// is linear, so the shapes are identical) — `units` only swaps the legend
// labels.

import type { ForecastHourlyPoint } from "@/lib/types";
import type { Units } from "@/lib/units";

const WIDTH = 600;
const HEIGHT = 160;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const PAD_X = 4;

export function PrecipChart({
  hourly,
  units,
}: {
  hourly: ForecastHourlyPoint[];
  units: Units;
}) {
  if (hourly.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No hourly forecast data.
      </p>
    );
  }

  const plotW = WIDTH - PAD_X * 2;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const n = hourly.length;
  const barW = plotW / n;

  const maxPrecip = Math.max(1, ...hourly.map((p) => p.precip_mm));
  const temps = hourly.map((p) => p.temp_c);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const tempRange = Math.max(1, maxTemp - minTemp);

  const xFor = (i: number) => PAD_X + i * barW + barW / 2;
  const yForPrecip = (mm: number) =>
    PAD_TOP + plotH - (Math.max(0, mm) / maxPrecip) * plotH;
  const yForTemp = (t: number) =>
    PAD_TOP + plotH - ((t - minTemp) / tempRange) * plotH;

  const linePoints = hourly
    .map((p, i) => `${xFor(i)},${yForTemp(p.temp_c)}`)
    .join(" ");

  const labelEvery = Math.max(1, Math.round(n / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-40 w-full min-w-[420px] text-muted-foreground"
        role="img"
        aria-label="48-hour precipitation and temperature forecast"
      >
        {hourly.map((p, i) => {
          const y = yForPrecip(p.precip_mm);
          return (
            <rect
              key={p.time}
              x={PAD_X + i * barW + 0.5}
              y={y}
              width={Math.max(1, barW - 1)}
              height={Math.max(0, PAD_TOP + plotH - y)}
              fill="var(--primary)"
              opacity={0.5}
            />
          );
        })}
        <polyline
          points={linePoints}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hourly.map((p, i) =>
          i % labelEvery === 0 ? (
            <text
              key={`label-${p.time}`}
              x={xFor(i)}
              y={HEIGHT - 6}
              fontSize={9}
              textAnchor="middle"
              fill="currentColor"
            >
              {new Date(p.time).toLocaleTimeString([], { hour: "numeric" })}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-xs"
            style={{ background: "var(--primary)", opacity: 0.5 }}
          />
          Precip ({units === "imperial" ? "in" : "mm"})
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-0.5 w-3"
            style={{ background: "#f59e0b" }}
          />
          Temp ({units === "imperial" ? "°F" : "°C"})
        </span>
      </div>
    </div>
  );
}
