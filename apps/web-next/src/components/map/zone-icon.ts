// Hand-rolled pin icon (no default Leaflet marker images — those need
// bundler asset config that fights Next.js). Client-only: only ever
// imported from leaflet-map.tsx, which is itself loaded with `ssr: false`.

import L from "leaflet";

export function createZoneIcon(
  color: string,
  opts: { muted?: boolean; pulsing?: boolean } = {},
): L.DivIcon {
  const { muted = false, pulsing = false } = opts;
  const halo = pulsing
    ? `<span class="zone-pin-halo" style="background:${color}" aria-hidden="true"></span>`
    : "";
  return L.divIcon({
    className: "zone-pin-wrapper",
    html: `${halo}<svg class="zone-pin${muted ? " zone-pin-muted" : ""}" width="26" height="35" viewBox="0 0 26 35" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 22 13 22s13-12.3 13-22C26 5.8 20.2 0 13 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="4.5" fill="white"/>
    </svg>`,
    iconSize: [26, 35],
    iconAnchor: [13, 35],
    tooltipAnchor: [0, -32],
  });
}

/** Small dot used for draft/preview vertices while drawing a polygon. */
export function createVertexIcon(): L.DivIcon {
  return L.divIcon({
    className: "zone-vertex-wrapper",
    html: `<span class="zone-vertex-dot" aria-hidden="true"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}
