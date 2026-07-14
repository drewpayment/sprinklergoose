# M3 Spec — Weather Autonomy

Scope per docs/ROADMAP.md M3: the executor skips scheduled waterings when the
weather says so, transparently, with a one-tap human override. Philosophy carried
over from M2 rulings: automation restrains, humans override, failures water
(never brown the lawn because an API was down).

## Weather source

Open-Meteo (https://api.open-meteo.com/v1/forecast — free, keyless). One request
serves everything: `hourly=precipitation,temperature_2m&past_days=2&forecast_days=2`
at the configured lat/lon. The EXECUTOR owns all weather fetching (autonomy must
not depend on the web app). Cache snapshot in memory; refresh when older than 30
minutes at evaluation time. Timeout 10s, one retry. No API key, no secrets.

## Shared contract

New table (web-next owns migration; executor reads):
```sql
weather_settings (            -- singleton: exactly one row, id always 1
  id                    int PRIMARY KEY CHECK (id = 1),
  enabled               boolean NOT NULL DEFAULT false,
  latitude              double precision,   -- required when enabled
  longitude             double precision,   -- required when enabled
  rain_lookback_mm      double precision NOT NULL DEFAULT 6.0,   -- skip if ≥ mm in past 24h
  forecast_probability  int NOT NULL DEFAULT 70,                 -- reserved M3.1 (see note)
  forecast_lookahead_mm double precision NOT NULL DEFAULT 4.0,   -- skip if ≥ mm forecast next 6h
  freeze_temp_c         double precision NOT NULL DEFAULT 1.0,   -- skip if current temp ≤ °C
  updated_at            timestamptz NOT NULL DEFAULT now()
)
```
Note: Open-Meteo's plain forecast endpoint provides hourly precipitation amounts
(mm), not probability, without extra params — M3 uses forecast *amount*
(`forecast_lookahead_mm` over the next 6h). The `forecast_probability` column is
seeded for a later refinement; UI does not expose it in M3.

Migration also extends `program_runs.status` CHECK with **`skipped_weather`**.
Seed: insert the singleton row (disabled, null lat/lon) — weather is OFF until an
admin configures a location. NOTIFY sprinkler_events fires on settings writes
(existing helper).

## Executor semantics (W1)

- At scheduled fire time, AFTER the rain-delay check (controller rain delay wins;
  order: rain_delay → weather), if weather_settings.enabled and program
  respect_rain_delay is true*, evaluate:
    skip if past-24h precipitation sum ≥ rain_lookback_mm
    OR next-6h precipitation sum ≥ forecast_lookahead_mm
    OR current temperature ≤ freeze_temp_c
  → record run with status `skipped_weather`, note like
    "rain 9.2mm in last 24h (threshold 6.0)" / "forecast 5.1mm next 6h" /
    "freeze guard: -2.1°C", no module commands.
  (*one flag governs both rain-delay and weather deference in M3; renaming the
  UI label to "Skip when rain delay or weather says so" is W2 scope. No schema
  change for this.)
- Run-now IGNORES weather (M2 ruling 1 extends: explicit human intent).
- Weather fetch failure / stale beyond 2h / settings enabled but lat/lon null →
  DO NOT skip; water normally; append note "no weather data" to the run row.
- Snapshot struct: fetched_at, past24_mm, next6_mm, current_temp_c — the values
  used go verbatim into the skip/no-data note (history must show its work).
- Status additions (GET /api/status, additive): `"weather": null | {fetched_at,
  past24_mm, next6_mm, current_temp_c, enabled}` — null when disabled/never fetched.

### W1 acceptance criteria (fake weather source + fake clock throughout)
- [ ] M3.E1 Each skip rule triggers independently at exact thresholds (≥, not >,
      for lookback/lookahead; ≤ for freeze) → skipped_weather row with the
      triggering values in the note.
- [ ] M3.E2 Weather disabled / null coords / fetch failure / stale >2h → watering
      proceeds; failure paths add "no weather data" note; NO skip ever from a
      failure path.
- [ ] M3.E3 Run-now bypasses weather entirely (no fetch even).
- [ ] M3.E4 Rain-delay check ordering: active rain delay yields skipped_rain_delay
      (not skipped_weather) even when weather would also skip.
- [ ] M3.E5 Snapshot cache: ≤1 fetch per 30min under repeated evaluations; NOTIFY
      on settings change forces refetch at next evaluation.
- [ ] M3.E6 Settings changes (enable/thresholds) picked up ≤15s without NOTIFY.
- [ ] M3.E7 All M2 tests stay green (96); N1 untouched.
- [ ] M3.E8 One integration test: real Open-Meteo call for a fixed lat/lon parses
      (marked skippable if offline).

## Web app (W2)

- **Admin → Weather page**: enable toggle; location (lat/lon inputs with a
  "use browser location" button); three threshold fields with plain-language
  labels ("Skip if more than __ mm fell in the last 24 hours"), defaults shown;
  validation (enabled requires coords; sane ranges: lat −90..90, lon −180..180,
  mm 0–100, temp −30..10). Member: page hidden, writes 403 (M1 pattern).
- **History**: `skipped_weather` badge (distinct color) + note displayed;
  **"Water anyway"** button on skipped_weather AND skipped_rain_delay rows —
  creates a run_request for that program (existing mechanism), member+ allowed,
  disabled when the program was since deleted/disabled.
- **Dashboard**: small weather chip when enabled ("24h: 9.2mm · next 6h: 0.3mm")
  from status.weather; tooltip/subtext when a future run may skip is OUT of scope.
- Program editor: relabel respect_rain_delay per W1 note.

### W2 acceptance criteria
- [ ] M3.S1 Settings CRUD admin-only, validation cases above, persisted; NOTIFY
      fires on save.
- [ ] M3.S2 skipped_weather renders with badge + full note; Water-anyway creates
      run_request (verify row + NOTIFY) and shows confirmation; hidden/disabled
      for deleted or disabled programs.
- [ ] M3.S3 Dashboard weather chip renders from status.weather; absent when null.
- [ ] M3.S4 Mobile 390×844 + desktop, light + dark, build + lint clean.
- [ ] M3.S5 Stub executor extended (status.weather + a __control weather state).

## Hardware & environment rules
Development happens in an ISOLATED WORKTREE with NO access to the live stack:
do not touch ports 3000/8000, the real controller, or the shared dev DB
(sprinkler-dev-postgres:5435). Spin up your OWN postgres container (port ≥5437,
unique name, clean up) and stub executor on alternate ports. Live validation
happens later at the PM-run integration gate.

## M3.Q — Quick Run (manual multi-zone)

PO request: "run all zones right now." One action that waters several zones
back-to-back without creating a program. Ships in the M3 PR.

### Design (binding)
An ad-hoc run request rides the EXISTING run_request → scheduler → history
pipeline. No new execution engine, no UI-driven sequencing.

Schema change (web-next owns the drizzle migration):
```sql
ALTER TABLE run_requests ALTER COLUMN program_id DROP NOT NULL;
ALTER TABLE run_requests ADD COLUMN steps jsonb;  -- [{"zone_id":1,"minutes":10}, ...]
ALTER TABLE run_requests ADD CONSTRAINT run_requests_target CHECK (
  (program_id IS NOT NULL AND steps IS NULL) OR
  (program_id IS NULL AND steps IS NOT NULL));
```

Executor: claim_run_requests also reads `steps`. A steps-bearing request is
admitted like run-now (jumps the queue ahead of scheduled items, FIFO among
manual items, same overflow-→-missed rule) as a SYNTHETIC run: program_id NULL,
program_name `Quick run`, initiator = requested_by. Execution goes through the
same `_execute` path (N1 lock/pacing untouched): strictly sequential in payload
order, disabled/unknown zone → `skipped_disabled` and continue, stop-all
cancels run + queue, manual single-zone start cancels it (manual always wins).
Because it is manual intent it BYPASSES rain delay and weather (PM ruling #1
extends to quick runs). History: program_runs row (program_id NULL, name
`Quick run`) + program_run_steps per step — existing history UI renders it.
Malformed payload (empty array, bad zone_id/minutes types, minutes outside
1–240, >20 steps) → log warning, record nothing, never crash the tick.

Web: `POST /api/quick-run` (member+, same auth pattern as program run-now):
body `{steps:[{zone_id,minutes},...]}`; server validates: 1–20 steps, zone_id
must be an ENABLED zone, minutes int 1–240, no duplicate zone_ids; inserts the
run_requests row + NOTIFY sprinkler_events.

UI (dashboard/zones page, member+): a **Quick run** button opening a dialog:
enabled zones as checkboxes (ascending zone order = run order), **Select all**,
ONE shared "minutes per zone" input (default 10, 1–240) applied to every
selected zone (payload stays per-step so per-zone durations can come later).
Submit → confirmation toast; the existing program-run banner shows progress
("Quick run", current zone, countdown) once status reports it.

### Acceptance criteria — executor (M3.Q-E)
- [ ] Q.E1 Steps-bearing request executes zones sequentially in payload order
      via the N1-locked service; program_runs/program_run_steps rows exact
      (program_id NULL, name Quick run, initiator email).
- [ ] Q.E2 Jumps queue ahead of scheduled items, FIFO among manual items;
      bypasses rain delay AND weather even when both would skip.
- [ ] Q.E3 Zone disabled between request and execution → skipped_disabled,
      remaining steps run, run `completed` (skip alone ≠ partial, per M2.E6).
- [ ] Q.E4 Stop-all cancels a quick run (status cancelled, queue cleared);
      manual zone start cancels it first (manual always wins).
- [ ] Q.E5 Claimed ≤5s with NOTIFY / ≤15s poll; malformed payloads (each case
      above) ignored with a warning, tick never crashes, request stays claimed.
- [ ] Q.E6 status.program_run reflects the quick run (name, step position,
      countdown, total_steps); program-based run_requests behave EXACTLY as
      before (regression: full existing suite green).

### Acceptance criteria — web (M3.Q-S)
- [ ] Q.S1 Dialog flow: select zones (+Select all), shared minutes, submit →
      run_requests row with correct steps payload + NOTIFY (verify in DB);
      banner appears when status reports the run (stub start_program_run).
- [ ] Q.S2 Validation: zero zones / minutes 0 or 241 / non-integer rejected
      client-side with clear messages; server 400s on disabled zone, dup
      zone_ids, >20 steps; disabled zones never offered in the dialog.
- [ ] Q.S3 Member can quick-run (member+ like zone start); unauthenticated 401.
- [ ] Q.S4 History lists quick runs: name Quick run, initiator email, expandable
      per-step outcomes.
- [ ] Q.S5 Mobile 390×844 + desktop, light + dark, build + lint clean.

Hardware & environment rules: identical to the section above — isolated
worktree, own postgres (≥5437), stub executor, NEVER the real controller.
