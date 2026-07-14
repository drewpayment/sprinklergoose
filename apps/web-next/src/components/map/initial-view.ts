// Initial map view (docs/M4-MAP-SPEC.md "Initial view"): bbox of placed
// zone geometries (padded); else weather_settings lat/lon at zoom 18; else
// a wide default with an overlay hint. Pure so it's easy to unit-reason
// about; the Leaflet component just renders whichever variant this returns.

import type { ZoneMapView } from "@/lib/types";

export type LatLngTuple = [number, number];

export type InitialView =
  | { kind: "bounds"; bounds: [LatLngTuple, LatLngTuple] }
  | { kind: "center"; center: LatLngTuple; zoom: number; hint: boolean };

/** Wide, zoomed-out world view used when there's nothing to center on. */
const WORLD_DEFAULT: LatLngTuple = [20, 0];
const WORLD_ZOOM = 2;
const PLACED_ZOOM = 18;

function geometryPoints(zone: ZoneMapView): LatLngTuple[] {
  if (!zone.geometry) return [];
  if (zone.geometry.type === "Point") {
    const [lon, lat] = zone.geometry.coordinates;
    return [[lat, lon]];
  }
  return zone.geometry.coordinates[0].map(
    ([lon, lat]) => [lat, lon] as LatLngTuple,
  );
}

export function computeInitialView(
  zones: ZoneMapView[],
  fallbackCenter: { lat: number; lon: number } | null,
): InitialView {
  const points = zones.flatMap(geometryPoints);

  if (points.length > 0) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const [lat, lon] of points) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
    // Pad so single-point / tiny-area bboxes still show surrounding
    // context, and so markers/polygon edges aren't flush against the frame.
    const latPad = Math.max((maxLat - minLat) * 0.3, 0.001);
    const lonPad = Math.max((maxLon - minLon) * 0.3, 0.001);
    return {
      kind: "bounds",
      bounds: [
        [minLat - latPad, minLon - lonPad],
        [maxLat + latPad, maxLon + lonPad],
      ],
    };
  }

  if (fallbackCenter) {
    return {
      kind: "center",
      center: [fallbackCenter.lat, fallbackCenter.lon],
      zoom: PLACED_ZOOM,
      hint: false,
    };
  }

  return { kind: "center", center: WORLD_DEFAULT, zoom: WORLD_ZOOM, hint: true };
}
