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

/**
 * Home anchor marker (docs/M4-MAP-SPEC.md wayfinding — W8): a round badge
 * with a house glyph, deliberately not the teardrop zone-pin shape so it's
 * never confused with a zone at the weather-settings location.
 */
export function createHomeIcon(): L.DivIcon {
  return L.divIcon({
    className: "home-pin-wrapper",
    html: `<span class="home-pin" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 11.5L12 4l9 7.5" stroke="white" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1v-9" stroke="white" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    tooltipAnchor: [0, -20],
  });
}

/**
 * "You are here" dot for the locate-me control (temporary, never
 * persisted — paired with a Leaflet Circle for the accuracy radius).
 */
export function createLocateDotIcon(): L.DivIcon {
  return L.divIcon({
    className: "locate-dot-wrapper",
    html: `<span class="locate-dot-halo" aria-hidden="true"></span><span class="locate-dot" aria-hidden="true"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/** Dismissable pin for a selected search result (temporary, never persisted). */
export function createSearchResultIcon(): L.DivIcon {
  return L.divIcon({
    className: "zone-pin-wrapper",
    html: `<svg class="search-result-pin" width="26" height="35" viewBox="0 0 26 35" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 22 13 22s13-12.3 13-22C26 5.8 20.2 0 13 0z" fill="#e11d48" stroke="white" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="4.5" fill="white"/>
    </svg>`,
    iconSize: [26, 35],
    iconAnchor: [13, 35],
    tooltipAnchor: [0, -32],
  });
}
