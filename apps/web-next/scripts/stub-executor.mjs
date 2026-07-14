/**
 * Tiny stand-in for the real executor (docs/API.md + docs/M2-SPEC.md) so
 * write flows can be developed and tested WITHOUT touching live irrigation
 * hardware.
 *
 *   node scripts/stub-executor.mjs [port]   (default 8899)
 *
 * Extra dev-only endpoint: POST /__control with any of:
 *   {"reachable": false}            simulate cached/unreachable status
 *   {"rain_sensor": true}           toggle the rain sensor
 *   {"next_scheduled": {"program_name": "Lawn", "at": "2026-07-13T10:00:00Z"}}
 *   {"next_scheduled": null}
 *   {"start_program_run": {"run_id": 1, "program_name": "Lawn",
 *     "steps": [{"zone_id": 1, "seconds": 90}, {"zone_id": 3, "seconds": 60}]}}
 *                                   simulate a program run: steps advance and
 *                                   step_remaining_seconds decrements in real
 *                                   time; the active step's zone shows active.
 *   {"program_run": null}           cancel the simulated run
 *   {"weather": {"past24_mm": 9.2, "next6_mm": 0.3, "current_temp_c": 18.5}}
 *                                   M3: set the status.weather snapshot
 *                                   (fetched_at defaults to now, enabled to
 *                                   true; pass any field to override).
 *   {"weather": null}               M3: weather disabled / never fetched
 *   {"forecast": {"enabled": true, "weather": {...}, "hourly": [...],
 *     "upcoming": [{"program_id":3,"program_name":"Lawn",
 *       "at":"2026-07-14T06:00:00-04:00","prediction":"watering","note":null}]}}
 *                                   M4.M: set the GET /api/forecast body
 *                                   verbatim (docs/M4-MAP-SPEC.md); missing
 *                                   fields default to enabled:false,
 *                                   weather:null, hourly:[], upcoming:[].
 *   {"forecast": null}              M4.M: reset to the disabled default
 *   {"reachable": false}            (existing) also makes GET /api/forecast
 *                                   respond 503, so the web route's 502
 *                                   degraded-panel path is exercisable
 *                                   without killing this process.
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 8899);

const state = {
  rainDelay: 0,
  rainSensor: false,
  reachable: true,
  cachedAt: null,
  // 7 stations; active tracked via endsAt (ms epoch) on at most one zone.
  zones: Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    name: `Zone ${i + 1}`,
    endsAt: null,
  })),
  // M2: {run_id, program_name, steps: [{zone_id, seconds}], startedAt}.
  programRun: null,
  // M2: {program_name, at} (ISO) | null.
  nextScheduled: null,
  // M3: {fetched_at, past24_mm, next6_mm, current_temp_c, enabled} | null.
  weather: null,
  // M4.M: GET /api/forecast body (docs/M4-MAP-SPEC.md) | null (disabled default).
  forecast: null,
};

const DEFAULT_FORECAST = {
  enabled: false,
  weather: null,
  hourly: [],
  upcoming: [],
};

const now = () => Date.now();
const activeZone = () =>
  state.zones.find((z) => z.endsAt !== null && z.endsAt > now());

/**
 * Walk elapsed wall time through the simulated run's steps. Returns the
 * status.program_run shape, or null when the run finished (and clears it).
 */
function programRunStatus() {
  const run = state.programRun;
  if (!run) return null;
  let elapsed = (now() - run.startedAt) / 1000;
  for (let i = 0; i < run.steps.length; i++) {
    if (elapsed < run.steps[i].seconds) {
      return {
        run_id: run.run_id,
        program_name: run.program_name,
        step_position: i,
        step_zone_id: run.steps[i].zone_id,
        step_remaining_seconds: Math.max(1, Math.round(run.steps[i].seconds - elapsed)),
        total_steps: run.steps.length,
      };
    }
    elapsed -= run.steps[i].seconds;
  }
  state.programRun = null; // run finished
  return null;
}

function zoneStatus() {
  const run = programRunStatus();
  return state.zones.map((z) => {
    // A simulated program run drives its current step's zone.
    if (run && z.id === run.step_zone_id) {
      return {
        id: z.id,
        name: z.name,
        active: true,
        remaining_seconds: run.step_remaining_seconds,
      };
    }
    const active = z.endsAt !== null && z.endsAt > now();
    return {
      id: z.id,
      name: z.name,
      active,
      remaining_seconds: active ? Math.round((z.endsAt - now()) / 1000) : null,
    };
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = null;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString() || "null");
  } catch {
    /* ignore */
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`${req.method} ${path}${body ? " " + JSON.stringify(body) : ""}`);

  // Dev-only control endpoint.
  if (req.method === "POST" && path === "/__control") {
    if (typeof body?.reachable === "boolean") {
      state.reachable = body.reachable;
      state.cachedAt = body.reachable ? null : new Date().toISOString();
    }
    if (typeof body?.rain_sensor === "boolean") state.rainSensor = body.rain_sensor;
    if ("next_scheduled" in (body ?? {})) {
      state.nextScheduled = body.next_scheduled ?? null;
    }
    if ("weather" in (body ?? {})) {
      // M3: null clears; an object sets the snapshot with sane defaults.
      state.weather =
        body.weather === null
          ? null
          : {
              fetched_at: body.weather.fetched_at ?? new Date().toISOString(),
              past24_mm: body.weather.past24_mm ?? 0,
              next6_mm: body.weather.next6_mm ?? 0,
              current_temp_c: body.weather.current_temp_c ?? 20,
              enabled: body.weather.enabled ?? true,
            };
    }
    if ("program_run" in (body ?? {}) && body.program_run === null) {
      state.programRun = null;
    }
    if ("forecast" in (body ?? {})) {
      // M4.M: null resets to the disabled default; an object is stored
      // verbatim (missing top-level fields fall back to the defaults) so QA
      // can script exact predictions/badges through the endpoint's shape.
      state.forecast =
        body.forecast === null
          ? null
          : {
              enabled: body.forecast.enabled ?? DEFAULT_FORECAST.enabled,
              weather:
                "weather" in body.forecast
                  ? body.forecast.weather
                  : DEFAULT_FORECAST.weather,
              hourly: Array.isArray(body.forecast.hourly)
                ? body.forecast.hourly
                : DEFAULT_FORECAST.hourly,
              upcoming: Array.isArray(body.forecast.upcoming)
                ? body.forecast.upcoming
                : DEFAULT_FORECAST.upcoming,
            };
    }
    if (body?.start_program_run) {
      const r = body.start_program_run;
      const steps = Array.isArray(r.steps) ? r.steps : [];
      if (
        steps.length === 0 ||
        !steps.every(
          (s) => Number.isInteger(s?.zone_id) && Number.isInteger(s?.seconds) && s.seconds > 0,
        )
      ) {
        return json(res, 422, {
          detail: "start_program_run needs steps: [{zone_id, seconds}, ...]",
        });
      }
      for (const z of state.zones) z.endsAt = null;
      state.programRun = {
        run_id: Number.isInteger(r.run_id) ? r.run_id : 1,
        program_name: String(r.program_name ?? "Program"),
        steps: steps.map((s) => ({ zone_id: s.zone_id, seconds: s.seconds })),
        startedAt: now(),
      };
    }
    return json(res, 200, {
      ok: true,
      state: {
        reachable: state.reachable,
        program_run: programRunStatus(),
        next_scheduled: state.nextScheduled,
      },
    });
  }

  if (req.method === "GET" && path === "/healthz") {
    return json(res, 200, { status: "ok" });
  }

  if (req.method === "GET" && path === "/api/status") {
    return json(res, 200, {
      controller: { model: "ESP-Me (stub)", firmware: "2.9", serial: "0000" },
      zones: zoneStatus(),
      rain_sensor_active: state.rainSensor,
      rain_delay_days: state.rainDelay,
      reachable: state.reachable,
      cached_at: state.cachedAt,
      program_run: programRunStatus(),
      next_scheduled: state.nextScheduled,
      weather: state.weather,
    });
  }

  // M4.M: unlike other GETs (which serve cached/last-known state while
  // unreachable), /api/forecast has no cache concept here — treat
  // `reachable: false` as a hard failure so QA can exercise the web route's
  // 502-degraded-panel path via the existing control, without a real
  // network outage.
  if (req.method === "GET" && path === "/api/forecast") {
    if (!state.reachable) return json(res, 503, { detail: "controller unreachable" });
    return json(res, 200, state.forecast ?? DEFAULT_FORECAST);
  }

  if (!state.reachable && path.startsWith("/api/") && req.method !== "GET") {
    return json(res, 503, { detail: "controller unreachable" });
  }

  const startMatch = path.match(/^\/api\/zones\/(\d+)\/start$/);
  if (req.method === "POST" && startMatch) {
    const id = Number(startMatch[1]);
    const zone = state.zones.find((z) => z.id === id);
    if (!zone) return json(res, 404, { detail: "unknown zone" });
    const minutes = body?.minutes;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      return json(res, 422, { detail: "minutes must be 1-240" });
    }
    // One manual zone at a time, like the ESP-Me. Manual always wins:
    // starting a zone cancels a simulated program run (M2 semantics).
    state.programRun = null;
    for (const z of state.zones) z.endsAt = null;
    zone.endsAt = now() + minutes * 60_000;
    return json(res, 200, { active_zones: [id] });
  }

  if (req.method === "POST" && path === "/api/zones/stop") {
    // Stop-all cancels the simulated program run too (M2 semantics).
    state.programRun = null;
    for (const z of state.zones) z.endsAt = null;
    return json(res, 200, { active_zones: [] });
  }

  const patchMatch = path.match(/^\/api\/zones\/(\d+)$/);
  if (req.method === "PATCH" && patchMatch) {
    const zone = state.zones.find((z) => z.id === Number(patchMatch[1]));
    if (!zone) return json(res, 404, { detail: "unknown zone" });
    const name = body?.name;
    if (typeof name !== "string" || name.length < 1 || name.length > 40) {
      return json(res, 422, { detail: "invalid name" });
    }
    zone.name = name;
    const active = zone.endsAt !== null && zone.endsAt > now();
    return json(res, 200, {
      id: zone.id,
      name: zone.name,
      active,
      remaining_seconds: active ? Math.round((zone.endsAt - now()) / 1000) : null,
    });
  }

  if (path === "/api/rain-delay") {
    if (req.method === "GET") return json(res, 200, { days: state.rainDelay });
    if (req.method === "PUT") {
      const days = body?.days;
      if (!Number.isInteger(days) || days < 0 || days > 14) {
        return json(res, 422, { detail: "days must be 0-14" });
      }
      state.rainDelay = days;
      return json(res, 200, { days });
    }
  }

  json(res, 404, { detail: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`stub executor listening on http://127.0.0.1:${PORT}`);
  void activeZone;
});
