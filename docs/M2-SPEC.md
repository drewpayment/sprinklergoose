# M2 Spec — App-Owned Scheduling

Scope per docs/ROADMAP.md M2. The controller's own programs are never used; the
app schedules, the executor executes. Two parallel workstreams:
- **W1**: executor scheduler engine (`apps/api`)
- **W2**: schedules/history UI + CRUD (`apps/web-next`)

Timezone: all program times are LOCAL wall times. Env `SCHEDULE_TIMEZONE`
(executor) default `America/Detroit`; DST handled via zoneinfo (a 2:30 AM
program on a spring-forward night runs at 3:30; document, don't agonize).

## Shared contract: schema (web-next owns migration; executor reads/writes as noted)

```sql
programs (
  id            serial PRIMARY KEY,
  name          varchar(60) NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  start_times   time[] NOT NULL,          -- local wall times, ≥1 entry
  day_type      text NOT NULL CHECK (day_type IN ('days_of_week','interval')),
  days_of_week  int[],                    -- 0=Mon..6=Sun, required iff days_of_week
  interval_days int,                      -- ≥1, required iff interval
  anchor_date   date,                     -- required iff interval
  respect_rain_delay boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
)
program_steps (
  id serial PRIMARY KEY,
  program_id int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  position   int NOT NULL,                -- 0-based, contiguous
  zone_id    int NOT NULL REFERENCES zones(id),
  minutes    int NOT NULL CHECK (minutes BETWEEN 1 AND 240),
  UNIQUE (program_id, position)
)
run_requests (                            -- "Run now": web writes, executor claims
  id           serial PRIMARY KEY,
  program_id   int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  requested_by text NOT NULL,             -- user email
  created_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz                -- set by executor
)
program_runs (                            -- history: executor writes, web reads
  id            serial PRIMARY KEY,
  program_id    int REFERENCES programs(id) ON DELETE SET NULL,
  program_name  varchar(60) NOT NULL,     -- denormalized, survives deletes
  scheduled_for timestamptz,              -- null for run-now
  initiator     text NOT NULL,            -- 'schedule' | user email
  status        text NOT NULL CHECK (status IN
                ('running','completed','partial','failed','cancelled',
                 'skipped_rain_delay','missed')),
  started_at    timestamptz,
  finished_at   timestamptz,
  note          text
)
program_run_steps (
  id         serial PRIMARY KEY,
  run_id     int NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
  position   int NOT NULL,
  zone_id    int NOT NULL,
  zone_name  varchar(40) NOT NULL,        -- denormalized
  planned_minutes int NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  outcome    text CHECK (outcome IN
             ('completed','cancelled','failed','skipped_disabled'))
)
```

Change signaling: after any write to programs/program_steps/run_requests, web-next
executes `NOTIFY sprinkler_events`. Executor LISTENs on that channel AND polls
every 15s as fallback (NOTIFY is an optimization, never a dependency).

## Execution semantics (W1 — the heart of M2)

- Scheduler tick ≤5s. An enabled program is DUE at each (day-rule match ×
  start_time). Dedupe per (program_id, occurrence timestamp) — restarts must not
  double-fire (persist last-evaluated watermark or derive from program_runs).
- Occurrence >10 min in the past at evaluation (executor was down): record a
  `missed` run row, do not water.
- Rain delay: at fire time, if program.respect_rain_delay and controller rain
  delay > 0 → record `skipped_rain_delay` row (note includes days), no watering.
- Run: steps strictly sequential in position order through the EXISTING
  RainbirdService (N1 lock/pacing untouched). Per step: disabled/missing zone →
  `skipped_disabled`, continue; start failure after 1 retry → `failed`, continue
  to next step, run ends `partial` (or `failed` if every step failed). All steps
  ok → `completed`. Between steps, stop is NOT required (starting the next zone
  switches; hardware runs one zone at a time) but issue stop_irrigation after
  the final step's duration elapses.
- Queueing: one run active at a time. A due program while another runs → FIFO
  queue (collapse duplicate occurrences of the same program). Run-now requests
  jump the queue. Queue cap 5; overflow → `missed` with note.
- Cancellation: the executor's POST /api/zones/stop (any source: app stop-all,
  member, admin) cancels the active run (status `cancelled`, in-flight step
  `cancelled`) AND clears the queue. A manual ZONE start while a program runs
  also cancels the program run first (manual always wins), then starts the zone.
- Run-now: executor claims unclaimed run_requests (≤5s via NOTIFY, ≤15s worst
  case), initiator = requested_by.
- Autonomy: everything above works with the web app stopped (DB only).
- Status: GET /api/status gains `"program_run": null | {run_id, program_name,
  step_position, step_zone_id, step_remaining_seconds, total_steps}` and
  `"next_scheduled": null | {program_name, at}` (ISO, next 7 days horizon).

### W1 acceptance criteria
- [ ] M2.E1 Due program fires within 60s of its occurrence (fake-clock unit test
      + one real-tick integration test with seconds-away occurrence).
- [ ] M2.E2 Steps run sequentially via the N1-locked service; existing 44 tests
      stay green; no concurrent module commands in any scheduler path.
- [ ] M2.E3 Stop-all during a run → run `cancelled`, queue cleared, history rows
      correct. Manual zone start during a run cancels the run then starts.
- [ ] M2.E4 respect_rain_delay + delay>0 → `skipped_rain_delay` row, no module
      start commands issued.
- [ ] M2.E5 run_request claimed and watering started ≤5s (with NOTIFY) in
      integration test with real Postgres container.
- [ ] M2.E6 Disabled-zone step skipped, remaining steps run, run `partial`
      only if a step failed (skips alone still `completed` — note the skip).
- [ ] M2.E7 Program create/edit/disable picked up ≤15s without NOTIFY.
- [ ] M2.E8 Full scheduler cycle passes with only Postgres running (no web app).
- [ ] M2.E9 Executor restart mid-schedule: no double-fire, no lost history
      (running row finalized as `cancelled` with note on startup).
- [ ] M2.E10 status program_run/next_scheduled accurate (unit-tested).

## W2 — UI (apps/web-next)

Authorization: programs CRUD admin-only; members view schedules, view history,
and may "Run now" enabled programs (they can already start zones). All enforced
server-side per M1 pattern.

- **Schedules page** (admin edit / member read): program list (name, enabled
  switch, human-readable rule "Mon/Wed/Fri · 6:00 AM · 3 zones · 45 min total",
  next-occurrence preview); editor: name, day rule (days-of-week picker OR every-
  N-days + anchor), multiple start times, ordered steps (zone select of ENABLED
  zones, minutes, add/remove/reorder), respect-rain-delay toggle. Validation
  mirrors DB constraints; duplicate start times rejected; ≥1 step, ≥1 time.
- **Run now** button per program (member+): POST creates run_request + NOTIFY;
  UI confirms and dashboard reflects the run when status shows it.
- **History page** (member+): reverse-chron runs — status badge, program name,
  initiator ("schedule" vs user), scheduled vs actual time, expandable per-step
  detail (zone, planned vs actual, outcome). Filter: program, status. Paginated.
- **Dashboard additions**: "Next: Front Beds · tomorrow 6:00 AM" chip; during a
  program run, a banner (program name, current step zone + countdown from
  status.program_run, "Stop everything" = existing stop-all).
- NOTIFY: emit `NOTIFY sprinkler_events` after program/step/run_request writes
  (drizzle raw SQL is fine).

### W2 acceptance criteria
- [ ] M2.S1 Admin creates the PO's real-world program (e.g. "Lawn — Mon/Wed/Fri
      6:00 AM, zones 1,3,4,5 × 15 min") entirely through UI; DB rows match spec.
- [ ] M2.S2 Editor validation: no steps / no times / dup times / minutes 0 or
      241 / interval without anchor all rejected with clear messages.
- [ ] M2.S3 Member: schedules read-only (no editor affordances; server rejects
      writes 403), Run now works, history visible.
- [ ] M2.S4 Run-now round trip: button → run_request row + NOTIFY (verified in
      stub/integration), banner appears when status reports the run.
- [ ] M2.S5 History renders all statuses incl. skipped_rain_delay + missed with
      distinct badges; step expansion shows outcomes.
- [ ] M2.S6 Dashboard next-run chip matches executor's next_scheduled.
- [ ] M2.S7 Disabled zones not offered in step editor; a program whose step's
      zone was later disabled shows a warning icon on the schedules page.
- [ ] M2.S8 Mobile 390×844 + desktop, light + dark, `npm run build` clean.

## PM rulings (post-W1, binding for QA)
1. Run-now IGNORES rain delay (explicit human intent); scheduled runs respect it.
2. Manual zone start cancels the active program run but DEFERS (not clears) the
   queue until the manual run elapses; stop-all clears everything.
3. Collapsed-duplicate and queue-overflow occurrences record as `missed` with
   distinguishing notes.
4. Unreadable rain delay at fire time → water anyway (never brown the lawn on a
   sensor/config failure); a dead controller surfaces as failed/partial steps.
5. Known accepted gap: a crash in the claim→insert window can lose a run-now
   request (scheduled occurrences are fully crash-safe via the watermark).

## Hardware rules (unchanged from M1, mandatory)
Executor on :8000 is REAL hardware. Engineers: GETs only; all write-flow work
against stubs/fakes (extend scripts/stub-executor.mjs with the new status
fields). Live watering only at the QA gate: ZONE 1 ONLY, PO warned first.
Zones 2–5 never started by agents; 6–7 stay disabled.
```
