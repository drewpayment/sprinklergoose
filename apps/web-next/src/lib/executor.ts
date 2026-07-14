import "server-only";
import type {
  ActiveZonesResponse,
  ExecutorStatus,
  ForecastResponse,
  RainDelayResponse,
} from "./types";

/**
 * Server-side client for the executor REST API (docs/API.md).
 * EXECUTOR_URL is never exposed to the browser; every caller of this module
 * is a route handler that has already checked the Better Auth session.
 */

const TIMEOUT_MS = 5000;

export class ExecutorError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ExecutorError";
  }
}

function baseUrl(): string {
  return process.env.EXECUTOR_URL ?? "http://127.0.0.1:8000";
}

async function executorFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Network error / timeout — treat like the API's 503 contract.
    throw new ExecutorError(503, "controller unreachable");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body && typeof body.detail === "string"
        ? body.detail
        : `executor error ${res.status}`;
    throw new ExecutorError(res.status, detail);
  }
  return body as T;
}

export const executor = {
  status: () => executorFetch<ExecutorStatus>("/api/status"),
  startZone: (id: number, minutes: number) =>
    executorFetch<ActiveZonesResponse>(`/api/zones/${id}/start`, {
      method: "POST",
      body: JSON.stringify({ minutes }),
    }),
  stopAll: () =>
    executorFetch<ActiveZonesResponse>("/api/zones/stop", { method: "POST" }),
  getRainDelay: () => executorFetch<RainDelayResponse>("/api/rain-delay"),
  setRainDelay: (days: number) =>
    executorFetch<RainDelayResponse>("/api/rain-delay", {
      method: "PUT",
      body: JSON.stringify({ days }),
    }),
  // M4.M weather forecast (docs/M4-MAP-SPEC.md) — the executor is the single
  // weather owner; web-next never calls Open-Meteo directly.
  forecast: () => executorFetch<ForecastResponse>("/api/forecast"),
};
