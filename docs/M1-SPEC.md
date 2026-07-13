# M1 Spec — Platform Foundation

Scope per docs/ROADMAP.md M1. Two workstreams, parallel:
- **W1**: new Next.js app `apps/web-next` (replaces the Vite PWA at end of M1)
- **W2**: executor zone-enablement enforcement (small, `apps/api`)

## Shared contract: the `zones` table

Owned/migrated by the web app (Drizzle), read by the executor. Postgres:

```sql
zones (
  id         integer PRIMARY KEY,        -- controller station id, 1..7
  name       varchar(40) NOT NULL,       -- display name
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
)
```

Seed: zones 1–5 enabled ("Zone N" defaults), zones 6–7 **disabled** (unwired).
Zone names move from the executor's JSON file to this table; the executor's
PATCH /api/zones/{id} rename endpoint is now unused by the new app (kept for
back-compat until the Vite app retires).

## W1 — apps/web-next

**Stack:** Next.js (App Router, TS strict) + shadcn/ui + Tailwind + Better Auth
(email/password; roles `admin`/`member` via admin plugin; registration disabled,
initial admin seeded by script from env) + Drizzle + node-postgres against a
local dev Postgres (docker compose file at repo root: `docker-compose.dev.yml`,
postgres:16, named volume, port 5433 to avoid clashes). Dark/light per system.
Self-hosted fonts only (next/font). PWA-lite: manifest + icons (reuse v1 icon
set) so it installs to a phone home screen; full offline SW is out of scope.

**Server boundary:** the executor API (`EXECUTOR_URL`, default
http://127.0.0.1:8000) is called ONLY server-side (route handlers / server
actions). The browser never talks to the executor. Every server call checks the
Better Auth session and role first.

**Authorization matrix:**
| Action | member | admin |
|---|---|---|
| View dashboard/status | ✅ | ✅ |
| Start/stop **enabled** zones | ✅ | ✅ |
| Rain delay view | ✅ | ✅ |
| Rain delay set | ❌ | ✅ |
| Zone rename/enable/disable | ❌ | ✅ |
| User management (create member, set role, disable user) | ❌ | ✅ |

**Pages:** sign-in; dashboard (port of v1: status header, zone cards with
presets 5/10/15/30 + custom 1–240, running zone countdown from
remaining_seconds, stop-all bar, rain sensor/delay chips, offline banner,
5s polling paused when hidden); admin → zones (rename, enable/disable with
"unwired zone" hint); admin → users. shadcn components throughout; mobile-first
390×844; keep the v1 app's calm feel — it set the design bar.

**Data flow for zones:** dashboard merges executor live status (active,
remaining_seconds) with DB zone config (name, enabled). Disabled zones: hidden
for members, shown greyed with a "disabled" badge for admins, no start controls.

### W1 acceptance criteria
- [ ] M1.A1 Unauthenticated request to any page → sign-in; API/server actions
      reject without session (verified by direct HTTP probe).
- [ ] M1.A2 `npm run seed` creates admin from ADMIN_EMAIL/ADMIN_PASSWORD env +
      seeds zones table; admin signs in successfully.
- [ ] M1.A3 Admin creates a member account from the users page; member signs in;
      member sees no admin nav/actions and server-side rejects admin calls
      (403), not just hidden buttons.
- [ ] M1.A4 Member starts an enabled zone (UI reflects running ≤5s) and stops it.
- [ ] M1.A5 Member cannot see zones 6–7; admin sees them greyed; enabling zone 6
      makes it appear for members within one poll cycle.
- [ ] M1.A6 Rain delay: member sees value, cannot edit; admin edits 0–14.
- [ ] M1.A7 Zone rename by admin propagates to member dashboard.
- [ ] M1.P1 v1 parity: first load ≤8s / refresh ≤3s; countdown ticks; offline
      banner + auto-retry when executor unreachable; custom duration validation
      (rejects 0/300); light+dark; clean at 390×844 and desktop.
- [ ] M1.D1 `docker compose -f docker-compose.dev.yml up -d` + documented steps
      (migrate, seed, dev) yield a working local stack — README in apps/web-next.
- [ ] M1.D2 Production build passes; Dockerfile builds (multi-stage, standalone
      output); deploy/k8s updated: web-next Deployment/Service + Secret refs
      (DATABASE_URL, EXECUTOR_URL, BETTER_AUTH_SECRET…).

## W2 — executor zone enforcement (apps/api)

Optional `DATABASE_URL` env (asyncpg). When set: before `irrigate_zone`, check
`zones.enabled` (cache ≤5s); disabled → **403** `{"detail": "zone disabled"}`;
unknown id still 404. `GET /api/status` zones gain `"enabled": bool` (true for
all when no DB configured — back-compat). DB unreachable → fail-safe: refuse
starts with 503 (never water on unknown config), status served with enabled from
last cache. Unit tests with a fake DB layer; existing 23 tests stay green.

### W2 acceptance criteria
- [ ] M1.E1 With DB: start of disabled zone → 403 even via direct curl.
- [ ] M1.E2 Without DATABASE_URL: behavior identical to v1 (all tests pass).
- [ ] M1.E3 Status includes accurate `enabled`; flips within 5s of DB change.
- [ ] M1.E4 DB down: starts refused 503; status still served.

## Hardware rules for all M1 work
Executor at 127.0.0.1:8000 is connected to REAL hardware. Engineers: read-only
(GET status/rain-delay). No zone starts, no writes — build/write flows are
verified against stubs/fakes. Live watering happens only in the QA phase, zone 1
only, PO warned first. Zone 2 is occupied by the product owner.
