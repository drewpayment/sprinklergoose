# API Contract — rainbird-api v1

Base URL: `http://<host>:8000`. All bodies JSON. Errors follow FastAPI default shape
`{"detail": "..."}` with appropriate 4xx/5xx status; module-unreachable maps to
**503** with `detail: "controller unreachable"`.

## GET /healthz
Liveness only — never touches the module.
```json
{"status": "ok"}
```

## GET /api/status
One call drives the whole dashboard. Backend may serve cached static fields
(model/firmware/serial cached at startup) but `zones[].active`, `rain_*` are live.
```json
{
  "controller": {"model": "ESP-Me", "firmware": "2.9", "serial": "4769753604227727360"},
  "zones": [
    {"id": 1, "name": "Front beds", "active": true, "remaining_seconds": 420},
    {"id": 2, "name": "Zone 2", "active": false, "remaining_seconds": null}
  ],
  "rain_sensor_active": false,
  "rain_delay_days": 0,
  "reachable": true
}
```
`remaining_seconds` is a backend estimate (start time + requested duration); null
when zone idle or start unknown (e.g. started by the physical dial).
`cached_at` is always present at top level: `null` when the response is live.
If the module is unreachable: `reachable: false`, zones served from last-known
cache with `active` values as of `cached_at` (ISO timestamp), HTTP 200. If
unreachable before any cache exists (cold start): 503 "controller unreachable" —
clients treat 503 like `reachable: false`.

## POST /api/zones/{id}/start
Body: `{"minutes": 10}` — int, 1–240. 422 on validation error, 404 unknown zone.
Response 200:
```json
{"active_zones": [3]}
```

## POST /api/zones/stop
Stops all irrigation. Response 200: `{"active_zones": []}`

This is the only stop primitive (there is no per-zone stop): the ESP-Me runs one
manual zone at a time, so a UI "Stop" on the running zone maps to stop-all.

## PATCH /api/zones/{id}
Body: `{"name": "Back lawn"}` — 1–40 chars. Persists to zone-names store.
Response 200: the updated zone object.

## GET /api/rain-delay
```json
{"days": 0}
```

## PUT /api/rain-delay
Body: `{"days": 2}` — int, 0–14. Response 200: `{"days": 2}`

## Config (env vars)
- `RAINBIRD_HOST` (default `192.168.86.173`)
- `RAINBIRD_PASSWORD` (required)
- `ZONE_NAMES_FILE` (default `./data/zone_names.json`)
- `CORS_ORIGINS` (comma-separated, default `*` — LAN-only deployment)
