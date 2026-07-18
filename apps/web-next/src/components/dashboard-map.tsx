"use client";

// The dashboard "Plan" view — a Modernist top-down site plan generated from the
// zone list, used as the spatial half of the Split. It stays in sync with the
// control column: the running zone glows red with its countdown, the selected
// zone gets a dashed-red outline, and tapping a parcel selects that zone (the
// list below is the primary, keyboard-accessible control — the plan is the
// spatial companion, per the handoff). The real satellite view is the "Aerial"
// toggle (the existing Leaflet map).

import { cn } from "@/lib/utils";

export interface PlanZone {
  id: number;
  name: string;
  enabled: boolean;
  active: boolean;
}

const VIEW_W = 360;
const VIEW_H = 224;
const PAD = 12;
const GAP = 8;
const STREET = 20;
const COLS = 3;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function DashboardMap({
  zones,
  selectedZoneId,
  runningZoneId,
  runningCountdown,
  onSelect,
  className,
}: {
  zones: PlanZone[];
  selectedZoneId: number | null;
  runningZoneId: number | null;
  runningCountdown: string | null;
  onSelect: (id: number) => void;
  className?: string;
}) {
  const total = zones.length + 1; // + house cell
  const rows = Math.max(2, Math.ceil(total / COLS));
  const gridW = VIEW_W - PAD * 2;
  const gridH = VIEW_H - PAD * 2 - STREET - 6;
  const cellW = (gridW - GAP * (COLS - 1)) / COLS;
  const cellH = (gridH - GAP * (rows - 1)) / rows;
  const houseIndex = Math.floor(rows / 2) * COLS + 1; // middle-ish, center column

  const cellRect = (index: number) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    return {
      x: PAD + col * (cellW + GAP),
      y: PAD + row * (cellH + GAP),
    };
  };

  // Place zones into cells, skipping the reserved house cell.
  const placed: { zone: PlanZone; x: number; y: number }[] = [];
  let cell = 0;
  for (const zone of zones) {
    if (cell === houseIndex) cell++;
    const { x, y } = cellRect(cell);
    placed.push({ zone, x, y });
    cell++;
  }
  const house = cellRect(houseIndex);

  return (
    <div className={cn("border-2 border-border", className)}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" className="block">
        {/* ground + street strip */}
        <rect
          x="0"
          y="0"
          width={VIEW_W}
          height={VIEW_H}
          fill="var(--color-surface)"
        />
        <rect
          x="0"
          y={VIEW_H - STREET}
          width={VIEW_W}
          height={STREET}
          fill="color-mix(in srgb, var(--color-ink) 15%, transparent)"
        />
        <line
          x1="0"
          y1={VIEW_H - STREET / 2}
          x2={VIEW_W}
          y2={VIEW_H - STREET / 2}
          stroke="var(--color-bg)"
          strokeWidth="2"
          strokeDasharray="11 9"
        />

        {/* house */}
        <rect
          x={house.x}
          y={house.y}
          width={cellW}
          height={cellH}
          fill="color-mix(in srgb, var(--color-ink) 26%, transparent)"
        />
        <text
          x={house.x + cellW / 2}
          y={house.y + cellH / 2 + 3}
          textAnchor="middle"
          fill="var(--color-bg)"
          fontWeight="800"
          fontSize="8.5"
          letterSpacing="0.1em"
        >
          HOUSE
        </text>

        {/* zone parcels */}
        {placed.map(({ zone, x, y }) => {
          const running = zone.id === runningZoneId;
          const selected = zone.id === selectedZoneId && !running;
          const interactive = zone.enabled;
          return (
            <g
              key={zone.id}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={
                interactive
                  ? `Select ${zone.name}${running ? " (running)" : ""}`
                  : undefined
              }
              onClick={interactive ? () => onSelect(zone.id) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(zone.id);
                      }
                    }
                  : undefined
              }
              style={{
                cursor: interactive ? "pointer" : "default",
                opacity: zone.enabled ? 1 : 0.45,
                outline: "none",
              }}
            >
              <rect
                className={running ? "pulse-dot" : undefined}
                x={x}
                y={y}
                width={cellW}
                height={cellH}
                fill={
                  running
                    ? "color-mix(in srgb, var(--color-accent) 26%, transparent)"
                    : "color-mix(in srgb, var(--color-ink) 8%, transparent)"
                }
                stroke={
                  running || selected
                    ? "var(--color-accent)"
                    : "var(--color-divider)"
                }
                strokeWidth={running || selected ? 2.5 : 1.5}
                strokeDasharray={selected ? "7 5" : undefined}
              />
              <text
                x={x + 8}
                y={y + cellH - 8}
                fill={
                  selected ? "var(--color-accent)" : "var(--color-ink)"
                }
                fontWeight={running || selected ? 800 : 600}
                fontSize="10.5"
              >
                {truncate(zone.name, 12)}
                {selected ? " ◂" : ""}
              </text>
              {/* running countdown pill */}
              {running && runningCountdown && (
                <>
                  <rect
                    x={x + 6}
                    y={y + 6}
                    width="52"
                    height="20"
                    fill="var(--color-accent)"
                  />
                  <text
                    x={x + 12}
                    y={y + 20}
                    fill="#fff"
                    fontWeight="800"
                    fontSize="12"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {runningCountdown}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
