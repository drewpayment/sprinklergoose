import { NextResponse, type NextRequest } from "next/server";
import { getSession, jsonError, unauthorized } from "@/lib/session";
import type { GeocodeResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "sprinklergoose/1.0 (self-hosted irrigation app)";
const TIMEOUT_MS = 10_000;
const MIN_Q_LEN = 3;
const MAX_Q_LEN = 200;

interface NominatimResult {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

/**
 * Location search (docs/M4-MAP-SPEC.md "Wayfinding" — W9): session-required
 * proxy to Nominatim so the server (not the browser) sets a descriptive
 * User-Agent per Nominatim's usage policy. Never called client-side
 * directly. On upstream failure/timeout, respond 502 so the map's search
 * control can show a degraded "search unavailable" state instead of
 * crashing.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_Q_LEN || q.length > MAX_Q_LEN) {
    return jsonError(
      422,
      `q must be between ${MIN_Q_LEN} and ${MAX_Q_LEN} characters`,
    );
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("q", q);

  const acceptLanguage = request.headers.get("accept-language") ?? undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return jsonError(502, "location search unavailable");
  }
  if (!res.ok) {
    return jsonError(502, "location search unavailable");
  }

  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    return jsonError(502, "location search unavailable");
  }

  const results: GeocodeResult[] = (body as NominatimResult[])
    .map((r) => {
      const displayName =
        typeof r.display_name === "string" ? r.display_name : null;
      const lat =
        typeof r.lat === "string" || typeof r.lat === "number"
          ? Number(r.lat)
          : null;
      const lon =
        typeof r.lon === "string" || typeof r.lon === "number"
          ? Number(r.lon)
          : null;
      if (displayName === null || lat === null || lon === null) return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { display_name: displayName, lat, lon };
    })
    .filter((r): r is GeocodeResult => r !== null);

  return NextResponse.json(results);
}
