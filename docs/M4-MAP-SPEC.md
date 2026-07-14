# M4.M — Zone Map + Weather Forecast

**Status: binding spec.** PM-owned. Engineers implement exactly this; deviations require PM sign-off.

## Goal

A new member-visible **Map** page in `apps/web-next`:

1. An embedded real map (satellite/street tiles) of the property with each irrigation
   zone drawn on it (polygon or pin).
2. **Live animation**: the currently running zone pulses on the map, with zone name and
   remaining time visible.
3. A **weather forecast panel** on the same page: current conditions, a 48-hour hourly
   forecast strip, and the list of upcoming scheduled runs each labeled with a
   prediction — will it water, or will it likely be skipped (rain / forecast / freeze)
   or blocked by rain delay.

## Design decisions (binding)

### Zone geometry

- New nullable column on `zones`: `geometry jsonb` — a GeoJSON `Point` or `Polygon`
  (single ring, 3–100 vertices, valid lon/lat ranges, ≤ 16 KB serialized). `null` =
  zone not placed on the map yet.
- Drizzle migration `0004_*` via `npm run db:generate`. No seed changes.
- Admins place/edit geometry from the map page itself (edit mode). Stored via the
  existing admin-only `PATCH /api/zones/[id]`, extended to accept optional
  `geometry` (validated GeoJSON as above, or `null` to clear). Reject invalid shapes
  with 400 + message.

### Map rendering

- **Library: `leaflet` + `react-leaflet` v5** (React 19 compatible). Client-component
  only — Leaflet touches `window`, so the map component must be loaded with a dynamic
  import, `ssr: false`, inside a client component. Import leaflet's CSS.
- **Base layers**: default **Esri World Imagery** (satellite, keyless,
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
  attribution "Tiles © Esri") with a toggle to **OpenStreetMap** streets
  (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution "© OpenStreetMap
  contributors"). Attribution control must stay visible.
- **Initial view**: bounding box of all placed zone geometries (padded); if none
  placed, center on `weather_settings.latitude/longitude` at zoom 18; if that's null
  too, show the map at a wide default with an overlay hint: "Set your location in
  Weather settings, then place zones here." (admin sees "…place zones in edit mode",
  member sees "Ask an admin to place zones on the map.")
- **Zone rendering**: polygons filled with a per-zone color (stable palette by zone
  id); pins as markers with the zone name. Members see only **enabled** zones (same
  rule as everywhere else). Admins also see disabled zones muted/dashed.
- **Running animation**: the running zone (from live status, below) gets a pulsing
  style — animated fill opacity / halo (CSS keyframes on the SVG path Leaflet renders,
  or an animated circle marker halo for pins) — plus a small always-visible label:
  zone name + `mm:ss` remaining, ticking down client-side between polls. Both manual
  runs (`zones[].active` + `remaining_seconds`) and program/quick runs
  (`program_run.step_zone_id` + `step_remaining_seconds`) must animate.
- **Live status**: reuse the dashboard's pattern — poll `GET /api/status` every 5 s,
  pause when tab hidden, 1 s client countdown tick. Extract the dashboard's polling
  into a shared hook (`src/hooks/use-live-status.ts`) rather than duplicating it;
  dashboard behavior must not change.
- **Edit mode (admin only)**: toggle on the map page. Select a zone from a list →
  either **place pin** (single click) or **draw polygon** (click to add vertices,
  undo-last-point, close/finish, minimum 3 points) → Save (PATCH) / Clear geometry.
  Hand-roll the drawing interaction with react-leaflet event handlers — do **not**
  add leaflet-draw or other plugin deps.

### Weather forecast (executor is the single weather owner — do not fetch Open-Meteo from web-next)

**Executor changes (`apps/api`):**

- Extend the Open-Meteo fetch to `forecast_days=3` (keep `past_days=2`) and retain the
  **hourly series** (time, precip mm, temp °C) on the cached snapshot instead of only
  the three aggregates. Same 30-min cache, 2-h staleness, fail-open semantics. The
  existing skip-decision code paths and their outputs must remain byte-for-byte
  identical (all existing tests keep passing untouched).
- New endpoint **`GET /api/forecast`** returning:

```json
{
  "enabled": true,
  "weather": { "fetched_at": "…", "past24_mm": 1.2, "next6_mm": 0.0, "current_temp_c": 21.4 },
  "hourly": [ { "time": "2026-07-13T14:00:00+00:00", "precip_mm": 0.2, "temp_c": 21.4 } ],
  "upcoming": [
    {
      "program_id": 3,
      "program_name": "Lawn",
      "at": "2026-07-14T06:00:00-04:00",
      "prediction": "watering",
      "note": null
    }
  ]
}
```

- `enabled` mirrors weather-settings enablement. When disabled / no coords / fetch
  failed-stale: `weather: null`, `hourly: []`, and predictions fall back as below.
- `hourly`: UTC ISO timestamps, now → +48 h.
- `upcoming`: occurrences of **enabled** programs in the next 48 h (every start time,
  sorted ascending, max 20), `at` in the executor's local timezone with offset —
  same convention as `next_scheduled`.
- `prediction` ∈ `watering | skip_rain | skip_forecast | skip_freeze | rain_delay |
  unknown`, decided per occurrence time `T`, mirroring the live skip logic and its
  precedence:
  1. If `program.respect_rain_delay` is false → `watering`, note
     `"ignores rain delay and weather"`.
  2. If controller rain delay is active and `T` falls inside it (now + N days) →
     `rain_delay`. Use the cached rain-delay value; do not add module traffic beyond
     what status polling already does.
  3. Weather rules, same thresholds/order/comparison operators as the live decision:
     `past24(T)` = precip sum over `(T−24h, T]`, `next6(T)` = sum over `(T, T+6h]`,
     `temp(T)` = newest hourly bucket ≤ T, all computed from the retained hourly
     series (past + forecast). Notes use the same wording style as live skip notes.
  4. No usable weather data → `unknown` (never guess), note `"no weather data"` — but
     rules 1–2 still apply without weather.
- Unit tests: prediction precedence, window sums at boundary edges, timezone/DST
  handling, disabled-weather fallback, respect_rain_delay=false, cap at 20, and the
  endpoint's response shape. Use the existing fake clock / fake WeatherSource
  patterns. Deterministic, no network.

**Web changes (`apps/web-next`):**

- New route **`GET /api/forecast`**: session-required (member+), server-side proxy to
  `EXECUTOR_URL/api/forecast`, `dynamic = "force-dynamic"`, no caching. On executor
  unreachable → 502 JSON, the page shows a degraded panel (map still works).
- Forecast panel on the map page (below the map on mobile 390×844, beside it on
  `md:`): current conditions (temp, rain past 24 h, next 6 h), a 48-h strip chart —
  hand-rolled SVG bars for hourly precip with a temp line, no chart library — and the
  upcoming-runs list with badges: green "Watering", amber "Likely skip — rain/
  forecast/freeze" (with the note), blue "Rain delay", muted "No weather data".
  Refresh forecast every 5 min while visible.
- `api-client.ts`: add `getForecast()`; extend `updateZone` for geometry.
- Nav: add "Map" link in the `(app)` layout for all signed-in users.
- **Stub executor** (`scripts/stub-executor.mjs`): implement `GET /api/forecast` with
  scriptable state via `POST /__control {"forecast": {...}}` (and keep existing
  behaviors). QA drives running-zone animation via the existing
  `{"start_program_run": …}` control.

### Non-goals (M4.M)

- No per-zone weather, no wind rules, no probability rule (still reserved), no
  multi-property support, no offline tile caching, no editing programs from the map.

## Acceptance criteria

Executor (pytest, all green alongside the existing suite):
- **E1** `GET /api/forecast` shape exactly as specified; `hourly` spans ≤ 48 h.
- **E2** Prediction precedence: respect_rain_delay=false → watering; rain delay window
  → rain_delay; then skip_rain / skip_forecast / skip_freeze; ties broken by the same
  order as live `_decide`.
- **E3** Window math verified at edges (bucket exactly at T, T+6h, T−24h).
- **E4** Weather disabled / stale / no coords → `unknown` predictions, `hourly: []`,
  rules 1–2 still applied; endpoint never 500s for missing weather.
- **E5** Existing tests pass unmodified (no behavior change to live skip decisions).

Web (QA via agent-browser on the sandbox, mobile 390×844 + desktop, light + dark;
`npm run build` and `npm run lint` clean):
- **W1** Map page renders with satellite default + OSM toggle + visible attribution.
- **W2** Admin edit mode: place a pin, draw a ≥3-vertex polygon, save, reload —
  geometry persists; clear works; member gets 403 on geometry PATCH and sees no edit UI.
- **W3** With a stubbed program run active, the corresponding zone visibly pulses and
  shows name + ticking remaining time; animation stops when the run ends.
- **W4** Forecast panel shows current conditions, 48-h strip, and upcoming runs with
  correct badges for at least: watering, skip_forecast, rain_delay, unknown (scripted
  through the stub).
- **W5** Member sees only enabled zones on the map; admin sees disabled ones muted.
- **W6** Empty states: no geometries + no location → hint overlay; executor down →
  map works, forecast panel shows degraded state.
- **W7** Dashboard unchanged (polling hook extraction is invisible).

## Environment rules (unchanged from M3, binding)

Work only in this worktree. Never touch real hardware, ports 3000/8000, or
`sprinkler-dev-postgres` (5435). Web sandbox: own postgres container (unique name,
port ≥ 5438), stub executor on ≥ 8902, dev server on 3101. Executor tests:
FakeController/fake WeatherSource only; throwaway postgres for PG integration tests.
Never commit secrets.
