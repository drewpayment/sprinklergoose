"use client";

// The dashboard "Plan" view — a Modernist top-down site plan, used as the
// spatial half of the Split. It stays in sync with the control column: the
// running zone glows red with its countdown, the selected zone gets a
// dashed-red outline, and tapping a parcel selects that zone (the list below
// is the primary, keyboard-accessible control — the plan is the spatial
// companion, per the handoff). The real satellite view is the "Aerial"
// toggle (the existing Leaflet map).
//
// When zones have been placed on the real map (pins / drawn boundaries, plus
// the weather-settings home anchor), the plan is projected from that
// geometry so it mirrors the actual yard orientation. Zones that haven't
// been placed yet fall back to the generated grid.

import { cn } from "@/lib/utils";
import type { ZoneGeometry } from "@/lib/types";

export interface PlanZone {
  id: number;
  name: string;
  enabled: boolean;
  active: boolean;
  geometry?: ZoneGeometry | null;
}

const VIEW_W = 360;
const VIEW_H = 224;
const PAD = 12;
const GAP = 8;
const STREET = 20;
const COLS = 3;

// Geo mode: padding inside the viewBox so fixed-size glyphs (pin parcels,
// the home block) at the layout's edge don't clip.
const GEO_PAD = 34;
const PIN_W = 52;
const PIN_H = 34;
const HOME_W = 46;
const HOME_H = 30;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

type XY = [number, number];

interface GeoZone {
  zone: PlanZone;
  /** Projected polygon ring, or null for a pin (fixed-size parcel). */
  outline: XY[] | null;
  center: XY;
}

interface GeoLayout {
  homeXY: XY | null;
  zones: GeoZone[];
}

/**
 * Project placed zones + home into the SVG viewBox: equirectangular
 * (lon scaled by cos(lat) so shapes keep their real proportions), fitted and
 * centered. Positions and shapes come from the map; glyph sizes stay fixed.
 */
function computeGeoLayout(
  placed: PlanZone[],
  home: { lat: number; lon: number } | null,
): GeoLayout {
  const raw: XY[] = []; // [lon, lat]
  for (const z of placed) {
    const g = z.geometry!;
    if (g.type === "Point") raw.push([g.coordinates[0], g.coordinates[1]]);
    else for (const [lon, lat] of g.coordinates[0]) raw.push([lon, lat]);
  }
  if (home) raw.push([home.lon, home.lat]);

  const latAvg = raw.reduce((s, [, lat]) => s + lat, 0) / raw.length;
  const kx = Math.cos((latAvg * Math.PI) / 180);
  const xs = raw.map(([lon]) => lon * kx);
  const ys = raw.map(([, lat]) => -lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  const availW = VIEW_W - GEO_PAD * 2;
  const availH = VIEW_H - GEO_PAD * 2;
  // Everything at one spot (a single pin, no home) has no extent to fit.
  const degenerate = w < 1e-9 && h < 1e-9;
  const scale = degenerate
    ? 0
    : Math.min(availW / Math.max(w, 1e-9), availH / Math.max(h, 1e-9));
  const ox = GEO_PAD + (availW - w * scale) / 2 - minX * scale;
  const oy = GEO_PAD + (availH - h * scale) / 2 - minY * scale;
  const project = ([lon, lat]: XY): XY =>
    degenerate
      ? [VIEW_W / 2, VIEW_H / 2]
      : [lon * kx * scale + ox, -lat * scale + oy];

  return {
    homeXY: home ? project([home.lon, home.lat]) : null,
    zones: placed.map((z) => {
      const g = z.geometry!;
      if (g.type === "Point") {
        return {
          zone: z,
          outline: null,
          center: project([g.coordinates[0], g.coordinates[1]]),
        };
      }
      const pts = g.coordinates[0].map(([lon, lat]) => project([lon, lat]));
      const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
      const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
      return { zone: z, outline: pts, center: [cx, cy] };
    }),
  };
}

function ZoneGlyphs({
  geo,
  selectedZoneId,
  runningZoneId,
  runningCountdown,
  onSelect,
}: {
  geo: GeoLayout;
  selectedZoneId: number | null;
  runningZoneId: number | null;
  runningCountdown: string | null;
  onSelect: (id: number) => void;
}) {
  return (
    <>
      {geo.homeXY && (
        <g>
          <rect
            x={geo.homeXY[0] - HOME_W / 2}
            y={geo.homeXY[1] - HOME_H / 2}
            width={HOME_W}
            height={HOME_H}
            fill="color-mix(in srgb, var(--color-ink) 26%, transparent)"
          />
          <text
            x={geo.homeXY[0]}
            y={geo.homeXY[1] + 3}
            textAnchor="middle"
            fill="var(--color-bg)"
            fontWeight="800"
            fontSize="8"
            letterSpacing="0.1em"
          >
            HOME
          </text>
        </g>
      )}

      {geo.zones.map(({ zone, outline, center: [cx, cy] }) => {
        const running = zone.id === runningZoneId;
        const selected = zone.id === selectedZoneId && !running;
        const fill = running
          ? "color-mix(in srgb, var(--color-accent) 26%, transparent)"
          : "color-mix(in srgb, var(--color-ink) 8%, transparent)";
        const stroke =
          running || selected ? "var(--color-accent)" : "var(--color-divider)";
        const strokeWidth = running || selected ? 2.5 : 1.5;
        const strokeDasharray = selected ? "7 5" : undefined;
        return (
          <g
            key={zone.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${zone.name}${running ? " (running)" : ""}`}
            onClick={() => onSelect(zone.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(zone.id);
              }
            }}
            style={{ cursor: "pointer", outline: "none" }}
          >
            {outline ? (
              <polygon
                className={running ? "pulse-dot" : undefined}
                points={outline.map((p) => p.join(",")).join(" ")}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeLinejoin="round"
              />
            ) : (
              <rect
                className={running ? "pulse-dot" : undefined}
                x={cx - PIN_W / 2}
                y={cy - PIN_H / 2}
                width={PIN_W}
                height={PIN_H}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
              />
            )}
            <text
              x={cx}
              y={cy + 3.5}
              textAnchor="middle"
              fill={selected ? "var(--color-accent)" : "var(--color-ink)"}
              fontWeight={running || selected ? 800 : 600}
              fontSize="10.5"
            >
              {truncate(zone.name, 12)}
              {selected ? " ◂" : ""}
            </text>
            {running && runningCountdown && (
              <>
                <rect
                  x={cx - 26}
                  y={cy - (outline ? 34 : PIN_H / 2 + 26)}
                  width="52"
                  height="20"
                  fill="var(--color-accent)"
                />
                <text
                  x={cx - 20}
                  y={cy - (outline ? 20 : PIN_H / 2 + 12)}
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
    </>
  );
}

export function DashboardMap({
  zones,
  home,
  selectedZoneId,
  runningZoneId,
  runningCountdown,
  onSelect,
  className,
}: {
  zones: PlanZone[];
  home?: { lat: number; lon: number } | null;
  selectedZoneId: number | null;
  runningZoneId: number | null;
  runningCountdown: string | null;
  onSelect: (id: number) => void;
  className?: string;
}) {
  const placed = zones.filter((z) => z.geometry != null);
  const geo =
    placed.length > 0 ? computeGeoLayout(placed, home ?? null) : null;

  if (geo) {
    return (
      <div className={cn("border-2 border-border", className)}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" className="block">
          <rect
            x="0"
            y="0"
            width={VIEW_W}
            height={VIEW_H}
            fill="var(--color-surface)"
          />
          <ZoneGlyphs
            geo={geo}
            selectedZoneId={selectedZoneId}
            runningZoneId={runningZoneId}
            runningCountdown={runningCountdown}
            onSelect={onSelect}
          />
        </svg>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Fallback: nothing placed on the real map yet — generated site plan.
  // ------------------------------------------------------------------
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
  const gridPlaced: { zone: PlanZone; x: number; y: number }[] = [];
  let cell = 0;
  for (const zone of zones) {
    if (cell === houseIndex) cell++;
    const { x, y } = cellRect(cell);
    gridPlaced.push({ zone, x, y });
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
        {gridPlaced.map(({ zone, x, y }) => {
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
