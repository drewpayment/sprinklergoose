# sprinklergoose

A self-hosted replacement for the Rain Bird mobile app. It talks to a Rain Bird
ESP-Me irrigation controller over the local network — no Rain Bird cloud
account, no app-store app, no internet dependency to water the lawn. Zones,
schedules, run history, rain delay, and weather-aware skipping all live in
your own Postgres database and run on your own Kubernetes cluster.

It exists because the Rain Bird app is a cloud-tethered wrapper around a
controller that's sitting on your own LAN. sprinklergoose keeps the
convenience (schedules, a phone-friendly UI, "just run zone 3 for 10
minutes") and throws out the phone-home part: every request, every schedule
tick, and every drop of water is decided by code you run yourself.

## Features

- **Zones** — enable/disable and rename each of the controller's 7 stations
  (some may be unwired expansion slots); disabled zones are hidden from
  members and locked everywhere, enforced both in the UI and by the backend.
- **Programs (schedules)** — name, one or more start times, a day rule
  (specific days of the week, or every N days from an anchor date), and an
  ordered list of zone/duration steps. The app owns scheduling entirely —
  the controller's own onboard programs are never used.
- **Manual run** — start or stop any enabled zone on demand from the
  dashboard.
- **Quick Run** — an ad-hoc, multi-zone manual run ("water everything right
  now") without creating a saved program: pick zones, one shared duration,
  go.
- **Run history** — every scheduled run, run-now, and Quick Run is logged
  with per-step outcomes (completed / failed / cancelled / skipped), start
  and end times, and who or what initiated it.
- **Rain delay** — view and set a 0–14 day rain delay, read from and written
  to the controller itself.
- **Weather-based skip autonomy** — using free/keyless Open-Meteo data,
  scheduled programs can automatically skip when it's already rained
  recently, more rain is imminent, or it's below freezing — each skip is
  logged with the numbers that triggered it, plus a one-tap "water anyway"
  override.
- **Roles** — `admin` (manages zones, programs, users, rain delay, weather
  settings) and `member` (views status/history, starts zones, runs programs
  and Quick Run). Public registration is disabled; the seeded admin creates
  every other account.

## Architecture

Two services share one Postgres database, deployed as two separate
Kubernetes workloads:

```
                    ┌─────────────────────────────┐
   browser  ──────▶ │   web-next (Next.js)         │
                    │   - UI (App Router)          │
                    │   - REST route handlers      │
                    │   - Better Auth (admin/member│
                    │   - Drizzle ORM               │
                    └───────────────┬───────────────┘
                                    │
                     ┌──────────────┴──────────────┐
                     │                              │
          direct REST calls               reads/writes + LISTEN/NOTIFY
        (live status, manual                          │
         start/stop, rain delay)                      ▼
                     │                     ┌─────────────────────────┐
                     │                     │        Postgres          │
                     │                     │  zones, programs,        │
                     │                     │  run_requests,           │
                     │                     │  program_runs/steps,     │
                     │                     │  weather_settings        │
                     │                     └────────────┬─────────────┘
                     │                                  │
                     │                     polls (≤15s) / LISTENs
                     ▼                                  ▼
          ┌─────────────────────────────────────────────────────┐
          │              api — the "executor" (FastAPI)          │
          │  - claims due programs & run_requests                │
          │  - scheduler engine, rain-delay + weather skip rules  │
          │  - the ONLY client of the Rain Bird module            │
          │  - serialized access: 1 in-flight command, ≥100ms     │
          │    spacing, exponential backoff                       │
          └───────────────────────────┬────────────────────────────┘
                                       │  local HTTP (Rain Bird's
                                       │  AES/SIP-coded LAN protocol,
                                       │  via pyrainbird)
                                       ▼
                    ┌───────────────────────────────┐
                    │  Rain Bird ESP-Me controller   │
                    │  + LNK WiFi module (LAN-only)  │
                    └───────────────────────────────┘
```

Postgres is the seam between the two services — not a REST call. web-next
writes rows (programs, run_requests) and the executor reads/claims them; the
executor writes run history back that web-next just reads. This means the
executor's scheduler keeps running (and a program keeps watering on
schedule) even if web-next is down, scaled to zero, or mid-deploy.

The executor is the **sole client** of the LNK WiFi module by design: the
module is single-client hardware and will misbehave under concurrent
access, so nothing else — not the browser, not another pod — is allowed to
talk to it directly. In Kubernetes the executor's Service is ClusterIP-only
(never exposed outside the cluster) and runs at exactly one replica; it has
no auth of its own because the only thing that can reach it is web-next's
server-side code inside the cluster network.

## How a run actually happens

There are two paths into the executor, both funneling through the same
module-facing service underneath:

1. **Immediate (direct REST)** — the dashboard's manual zone start/stop and
   rain-delay controls call the executor's REST API directly from web-next
   server code (`EXECUTOR_URL`), and the result is reflected in the UI
   within seconds.
2. **Queued (via Postgres)** — scheduled programs, "Run now", and Quick Run
   all go through `run_requests`:
   - web-next inserts a row (a program run-now, or a Quick Run's ad-hoc
     zone/duration list) and fires `NOTIFY sprinkler_events`.
   - The executor's scheduler claims due programs and unclaimed
     `run_requests` — reacting to `NOTIFY` within seconds, or via a ≤15s
     poll as a fallback that never depends on `NOTIFY` firing.
   - **Priority:** manual requests (run-now, Quick Run) jump the queue ahead
     of scheduled occurrences; a manual single-zone start always cancels an
     in-progress program run first. Rain delay and weather-skip rules apply
     only to *scheduled* program occurrences — explicit human intent (run
     now, Quick Run) always waters, bypassing both.
   - Steps run strictly in order through the same serialized,
     single-client-safe module service used by the immediate path.
   - Every step's outcome, and the run as a whole, is written to
     `program_runs` / `program_run_steps` — this is what powers the History
     page, including skip reasons like "rain 9.2mm in last 24h" or "freeze
     guard: -2.1°C".

## Repo layout

| Path | What it is |
|---|---|
| `apps/web-next` | Current UI: Next.js (App Router) + shadcn/ui + Tailwind + Better Auth + Drizzle. Owns auth, zone/program config, history views, and the shared Postgres schema/migrations. |
| `apps/api` | The "executor": FastAPI service, sole owner of Rain Bird module communication (via `pyrainbird`), scheduler engine, weather-skip evaluation. |
| `apps/web` | **Legacy** — the original Vite + React PWA (v1, no auth, LAN/Tailscale-only). Superseded by `apps/web-next`; kept only until fully retired. |
| `deploy/k8s` | Kubernetes manifests: namespace, `api`/`web`/`web-next` Deployments+Services, the `arp-pinner` DaemonSet, example Secrets. |
| `docs/` | Living specs: `PRODUCT.md` (original v1 vision), `ROADMAP.md` (the v2 architecture decision + milestones), `M1-SPEC.md`/`M2-SPEC.md`/`M3-SPEC.md` (per-milestone specs and acceptance criteria), `API.md` (executor REST contract). |
| `docker-compose.dev.yml` | Dev-only Postgres for `apps/web-next` local development. |
| `.github/workflows/docker.yml` | CI: builds and pushes container images to GHCR on push to `main`. |

> Note: `docs/PRODUCT.md` describes the original v1 (`apps/web`) vision,
> including "no auth in v1" — that was true for the retired Vite app only.
> `docs/ROADMAP.md` is the current source of truth for the app-owns-everything
> v2 architecture (`web-next` + `api`) described in this README.

## Local development

Prerequisites: Node ≥ 20, Docker, and (for the executor) Python ≥ 3.12 with
[uv](https://docs.astral.sh/uv/).

### web-next (UI)

```sh
# 1. Dev Postgres (repo root)
docker compose -f docker-compose.dev.yml up -d

# 2. Configure
cd apps/web-next
cp .env.example .env    # fill in BETTER_AUTH_SECRET, ADMIN_EMAIL/PASSWORD

# 3. Install, migrate, seed (creates the admin + zones 1-7, 6-7 disabled)
npm install
npm run db:migrate
npm run seed

# 4. Stub executor for write-flow development — NEVER point local dev at
#    real hardware for zone starts
npm run stub-executor &

# 5. Dev server
npm run dev              # http://localhost:3000
```

The stub executor (`scripts/stub-executor.mjs`) fakes the executor's REST
surface on `127.0.0.1:8899` and exposes a dev-only
`POST /__control {"reachable": false}` to simulate the controller going
offline for banner/retry testing. Full script/env-var reference lives in
`apps/web-next/README.md`.

### api (executor)

```sh
cd apps/api
uv sync
RAINBIRD_HOST=127.0.0.1 RAINBIRD_PASSWORD=dev uv run pytest
```

Tests run against a `FakeController` (no real hardware, no network) for
almost everything. A handful of scheduler integration tests spin up a
throwaway, uniquely-named Postgres container on a free local port to
exercise `NOTIFY`/poll claiming end-to-end against real SQL, and clean up
after themselves; they're skipped automatically if Docker isn't available.
The suite never opens a connection to a real controller.

**Never point a local dev instance of the executor at real hardware** unless
you are deliberately doing hardware QA (see Hardware notes below) — the spec
convention across milestones has been read-only GETs during development,
live zone starts reserved for a supervised QA pass.

## Deployment

CI (`.github/workflows/docker.yml`) builds and pushes three images to GHCR
on every push to `main` that touches `apps/api` or `apps/web-next`:

- `ghcr.io/<owner>/sprinklergoose-api` — the executor
- `ghcr.io/<owner>/sprinklergoose-web` — the web-next app (Next.js
  standalone runtime image)
- `ghcr.io/<owner>/sprinklergoose-bootstrap` — same build, `bootstrap`
  target: runs Drizzle migrations + the idempotent seed script against
  `DATABASE_URL`, then exits

Each image is tagged both `:latest` and `:<git-sha>`.

Actual cluster deployment is GitOps, driven from a separate infrastructure
repo: bumping the image tag pins there is what ships a release. ArgoCD syncs
the change, and a PostSync hook Job runs the `bootstrap` image (migrations +
seed) against the cluster database before the app rolls out. This repo's
`deploy/k8s/` holds the plain Kubernetes manifests (namespace, Deployments,
Services, Secret templates, the `arp-pinner` DaemonSet) that the GitOps repo
references — see `deploy/k8s/README.md` for the manual `kubectl apply`
sequence and notes (single-replica executor, why `arp-pinner` exists, and
the exact `TRUSTED_ORIGINS`/ingress requirements for Better Auth).

## Configuration

No real values, passwords, hosts, or IPs belong in this file — copy the
`.env.example` files and fill them in locally, or use `deploy/k8s/secret.example.yaml`
as the template for cluster Secrets. The Rain Bird module's local-API
password should exist only in your secret store — never in a file that's
committed anywhere.

### `apps/api` (executor)

| Variable | Purpose |
|---|---|
| `RAINBIRD_HOST` | LAN IP of the LNK WiFi module (defaults to a placeholder in code — set this to your module's IP). |
| `RAINBIRD_PASSWORD` | The module's local-API password, set in the Rain Bird app and used as an AES key for the LAN protocol. Required. Never log or commit it. |
| `ZONE_NAMES_FILE` | Path to the legacy zone-names JSON store (v1 back-compat only; `web-next` owns zone names in Postgres now). |
| `CORS_ORIGINS` | Comma-separated allowed origins (default `*` — this service is never exposed outside the cluster/LAN anyway). |
| `DATABASE_URL` | Optional Postgres DSN. Unset = v1 behavior (no scheduler, every zone treated as enabled). Set = zone-enablement enforcement **and** the M2/M3 scheduler engine turn on. |
| `SCHEDULE_TIMEZONE` | IANA timezone for evaluating program wall-clock times (default `America/Detroit`); DST handled via `zoneinfo`. |

### `apps/web-next`

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string — the shared database with the executor. |
| `BETTER_AUTH_SECRET` | Better Auth session/cookie signing secret (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | The public URL users reach the app on. |
| `TRUSTED_ORIGINS` | Comma-separated origins allowed to call Better Auth endpoints; anything else gets a 403. Must list every real hostname/alias users hit in production. |
| `EXECUTOR_URL` | Base URL of the executor's REST API. Server-side only — the browser never learns this address. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Consumed only by `npm run seed` to create the initial admin account. |

## Hardware notes

- Controller: Rain Bird **ESP-Me**, firmware 2.9, 7 physical stations (some
  may be unwired expansion slots — that's why zone enablement is app-owned
  config, not something the controller can report).
- Talks over the LAN via the **LNK WiFi module**, using Rain Bird's
  AES/SIP-coded local protocol (via the `pyrainbird` library, the same
  reference implementation used by Home Assistant).
- The module is **single-client**: it can only sustain one in-flight
  request at a time, with pacing (≥100ms) between commands and exponential
  backoff on failure. Firmware 2.9 does not expose enough of the onboard
  scheduling protocol to be usable, which is why schedules are entirely
  app/executor-owned instead of written to the controller.
- The module **ignores broadcast ARP**. Any host that talks to it —
  including every Kubernetes node the executor pod might land on — needs a
  static/permanent ARP (neighbor) entry, or a DHCP reservation, or the
  module will simply be unreachable. In this cluster that's handled by the
  `arp-pinner` DaemonSet in `deploy/k8s/`.
- First request after a period of idle can take ~2s (the module wakes from
  power-save); sustained polling keeps it responsive. The executor accounts
  for this — don't be surprised by a slow first status call.

---

Shipped milestones: M1 (platform foundation — auth, zones, dashboard parity),
M2 (app-owned scheduling), M3 (weather autonomy + Quick Run). See
`docs/ROADMAP.md` for what's next.
