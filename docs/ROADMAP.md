# Sprinkler v2 Roadmap — "The app owns everything"

Product owner direction (2026-07-12): the controller is a dumb actuator. Schedules,
zone config, weather intelligence, users — all owned, stored, and executed by the
app. Hosting: homelab k8s only (PO decision — Vercel considered and dropped).
Stack: Next.js + shadcn/ui + Better Auth, homelab Postgres.

## The architecture decision (PO-approved 2026-07-12)

**Two services, one cluster, one database:**

- **App — Next.js (App Router) on homelab k8s.** The entire product surface: Better
  Auth (admin/member roles), schedule & zone CRUD via server actions, dashboard,
  weather config, history views. Talks to homelab Postgres (existing instance) —
  the single source of truth for all app-owned state.
- **Executor — the existing FastAPI service (kept; PO asked about going all-Node
  with node-rainbird, decision below).** Sole owner of module communication
  (LAN + static ARP + single-client invariants). Gains the **scheduler engine**:
  reads schedule definitions from the same Postgres (poll ~15s or LISTEN/NOTIFY),
  ticks locally, fires zone commands, writes run history rows back. Web-app
  deploys/restarts never interrupt a watering run.

**Why the executor stays Python/pyrainbird rather than "just Next.js":**
pyrainbird is the maintained reference implementation of the reverse-engineered
protocol (powers Home Assistant; model quirk tables, pacing, backoff); node-rainbird
is a thin, stale port. And hardware invariants (exactly one instance, serialized
access, uninterruptible scheduler tick) don't belong inside a web app's process
lifecycle. Revisit only if the executor ever needs features Python can't serve.

**No sync protocol:** with both services in-cluster on one Postgres, schedule sync
is just… reading the database. This deleted the cloud↔home sync design from the
earlier Vercel-hosted draft of this roadmap.

## Answered product questions

- **"Can the controller report unconfigured zones?"** Only partially: it reports 7
  available stations (base + expansion module slots) but NOT which have valves
  wired. So zone enablement is app-owned config: admin marks zones 6–7 (and any
  other) disabled; disabled zones are hidden from members, locked in every UI, and
  the executor refuses to start them (defense in depth — see zone 2 incident).
- **Weather source:** Open-Meteo (free, no API key, hourly precipitation history +
  forecast by lat/lon) as primary; NWS (api.weather.gov) as a US fallback option.

## Milestones

### M1 — Platform foundation (build the new house before moving furniture)
Next.js (App Router) app in `apps/web-next` with shadcn/ui, containerized for
homelab k8s. Better Auth (email/password + passkeys; roles: admin, member).
Homelab Postgres + Drizzle (new `sprinkler` database). Port the existing dashboard
(F1–F5 parity) calling the executor API server-side — same UAC as v1, re-verified.
**Zone config ships here**: enable/disable + rename move into the app DB; executor
enforces disabled zones.
- UAC highlights: member can start/stop enabled zones only; admin manages zones;
  disabled zones untouchable end-to-end (API + UI + executor); unauthenticated
  users see nothing but a login page; v1 UAC F1–F4 re-pass through the new stack.
- Explicitly NOT here: schedules, weather. Old Vite PWA retired at end of M1.

### M2 — App-owned scheduling (the core ask)
Schedule model: a **program** = name, enabled flag, start time(s), day rules
(days-of-week or every-N-days), ordered steps [(zone, minutes), …], and
"respect rain delay" flag. Stored in Postgres; edited in the app; executor picks
up changes from the DB within 15s; executor runs programs step-by-step (zones are
sequential — hardware runs one at a time), tracks state, writes run history
(per-step actual start/end, outcome, initiator).
- UAC highlights: program fires within 60s of its scheduled time with the Next.js
  app scaled to zero — executor autonomy proof; overlapping programs queue,
  never interleave; "Run now" from the app; manual Stop All cancels the running
  program and logs it; history shows who/what/why for every liter of water.
- Includes: rain-delay days honored (existing controller concept moves app-side).

### M3 — Weather autonomy (the fun part)
Open-Meteo integration keyed to home lat/lon. Skip rules evaluated at program
fire time by the EXECUTOR (autonomy must not depend on the cloud): skip if
(a) measured rain in trailing window exceeds threshold (e.g. ≥6mm/24h),
(b) precipitation probability in the next N hours exceeds threshold, or
(c) temperature below freeze guard. Every skip is a first-class history event
("Skipped: 9mm rain in last 24h") with a one-tap "water anyway" override that
runs the program immediately. Weather snapshot cached locally so a weather-API
outage degrades to "no skips" (water rather than brown the lawn), never blocks.
- UAC highlights: simulated rainy forecast → skip event logged + visible in app;
  weather API unreachable → program runs normally with a "no weather data" note;
  thresholds admin-configurable with sane defaults.

### M4 — Polish & ops
Push notifications (schedule ran / skipped / controller offline >1h), watering
history charts, per-zone monthly totals, seasonal adjust (%, applied to program
durations), audit trail UI, executor self-monitoring (module reachability alerts).

## Build order & rationale

M1 first even though M2 is the marquee feature: building scheduling UI on the Vite
app means building it twice, and auth must exist before schedules have an "owner".
M2 before M3: weather skips are modifiers on scheduled runs — nothing to skip
until schedules exist. M4 is continuous garnish.

## Migration/testing notes

- The v1 Vite PWA remains the reference implementation until M1 UAC passes.
- Executor API grows versioned additions (zone enablement check, schedule sync,
  history push); existing v1 endpoints unchanged during M1.
- Live-hardware QA rules (standing, learned the wet way): zone 1 only, watch
  teardown, and never run a zone the PO is sitting in.
