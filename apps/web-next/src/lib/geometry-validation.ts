// Server-side validation of zone map geometry writes (docs/M4-MAP-SPEC.md).
// Mirrors weather-validation.ts's shape: a pure function the PATCH route
// calls on every write. UI hiding is not enforcement.

import type { ZoneGeometry } from "@/db/schema";

export type GeometryValidationResult =
  | { ok: true; value: ZoneGeometry | null }
  | { ok: false; detail: string };

const err = (detail: string): GeometryValidationResult => ({
  ok: false,
  detail,
});

export const GEOMETRY_LIMITS = {
  polygonVertices: { min: 3, max: 100 },
  maxSerializedBytes: 16 * 1024,
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
} as const;

function isValidLonLat(v: unknown): v is [number, number] {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [lon, lat] = v;
  return (
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    lon >= GEOMETRY_LIMITS.longitude.min &&
    lon <= GEOMETRY_LIMITS.longitude.max &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= GEOMETRY_LIMITS.latitude.min &&
    lat <= GEOMETRY_LIMITS.latitude.max
  );
}

/**
 * Validate an untrusted `geometry` field from a PATCH /api/zones/[id] body.
 * Accepts a GeoJSON Point, a single-ring Polygon (3-100 vertices), or null
 * (clears the placement). Rejects anything else with a 400-worthy message.
 */
export function validateZoneGeometry(body: unknown): GeometryValidationResult {
  if (body === null) return { ok: true, value: null };
  if (!body || typeof body !== "object") return err("invalid geometry");

  const serialized = JSON.stringify(body);
  if (serialized.length > GEOMETRY_LIMITS.maxSerializedBytes) {
    return err(
      `geometry must serialize to at most ${GEOMETRY_LIMITS.maxSerializedBytes} bytes`,
    );
  }

  const g = body as { type?: unknown; coordinates?: unknown };

  if (g.type === "Point") {
    if (!isValidLonLat(g.coordinates)) {
      return err("Point coordinates must be [lon, lat] within valid ranges");
    }
    return {
      ok: true,
      value: { type: "Point", coordinates: g.coordinates as [number, number] },
    };
  }

  if (g.type === "Polygon") {
    if (!Array.isArray(g.coordinates) || g.coordinates.length !== 1) {
      return err("Polygon must have exactly one ring");
    }
    const ring = g.coordinates[0];
    if (!Array.isArray(ring)) {
      return err("Polygon ring must be an array of [lon, lat] pairs");
    }
    // Accept both a closed ring (first === last) and an open one; store open
    // (Leaflet round-trips open rings; GeoJSON strictly wants closed ones,
    // but validating vertex count on the *distinct* points keeps the 3-100
    // rule intuitive for the admin drawing on the map).
    const closed =
      ring.length > 1 &&
      Array.isArray(ring[0]) &&
      Array.isArray(ring[ring.length - 1]) &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1];
    const distinctCount = closed ? ring.length - 1 : ring.length;
    if (
      distinctCount < GEOMETRY_LIMITS.polygonVertices.min ||
      distinctCount > GEOMETRY_LIMITS.polygonVertices.max
    ) {
      return err(
        `Polygon must have ${GEOMETRY_LIMITS.polygonVertices.min}-${GEOMETRY_LIMITS.polygonVertices.max} vertices`,
      );
    }
    if (!ring.every(isValidLonLat)) {
      return err("Polygon vertices must be [lon, lat] within valid ranges");
    }
    return {
      ok: true,
      value: {
        type: "Polygon",
        coordinates: [ring as [number, number][]],
      },
    };
  }

  return err("geometry must be a GeoJSON Point, Polygon, or null");
}
