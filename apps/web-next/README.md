# Sprinkler — web-next

Next.js (App Router, TS strict) + shadcn/ui + Tailwind + Better Auth + Drizzle.
The M1 replacement for the Vite PWA: auth (admin/member), dashboard, zone
config, user management. See `docs/M1-SPEC.md` and `docs/API.md`.

## Architecture notes

- **Server boundary:** the executor REST API (`EXECUTOR_URL`) is called only
  from route handlers (`src/app/api/*`) after a Better Auth session check.
  The browser never learns the executor address.
- **Zones table** (`src/db/schema.ts`) is the shared contract with the
  executor: app-owned `name`/`enabled` per station (1–7). Zone rename and
  enable/disable write this table only — the executor's PATCH rename endpoint
  is not used by this app. A row must exist for all 7 stations; the executor
  treats a missing row as disabled.
- **Authorization matrix** (enforced server-side, not just hidden UI):
  members view status, start/stop enabled zones, view rain delay; admins
  additionally set rain delay, rename/enable/disable zones, and manage users.
  Public registration is disabled — the seeded admin creates all accounts.

## Local development

Prereqs: Node >= 20, Docker.

```sh
# 1. Dev Postgres (repo root). Host port defaults to 5435 — the spec's 5433
#    is occupied on the primary dev machine. Override: SPRINKLER_DB_PORT=...
docker compose -f ../../docker-compose.dev.yml up -d

# 2. Environment
cp .env.example .env    # then fill in BETTER_AUTH_SECRET, ADMIN_*

# 3. Install, migrate, seed (idempotent; creates admin + zones 1-7,
#    zones 6-7 disabled)
npm install
npm run db:migrate
npm run seed

# 4. A fake executor for write flows — NEVER point dev at real hardware
#    for zone starts (EXECUTOR_URL in .env defaults to the stub's port 8899)
npm run stub-executor &

# 5. Dev server
npm run dev             # http://localhost:3000, sign in with ADMIN_EMAIL
```

Stop everything: kill the two dev processes, then
`docker compose -f ../../docker-compose.dev.yml down` (the named volume
`sprinkler-pgdata` keeps your data).

### Scripts

| script | purpose |
|---|---|
| `npm run dev` / `build` / `start` | the usual Next.js trio |
| `npm run lint` | ESLint |
| `npm run db:generate` | new Drizzle migration from schema changes |
| `npm run db:migrate` | apply migrations |
| `npm run seed` | initial admin (ADMIN_EMAIL/ADMIN_PASSWORD) + zones 1–7 |
| `npm run stub-executor` | fake executor on 127.0.0.1:8899 (docs/API.md) |

The stub also has a dev-only `POST /__control {"reachable": false}` to
simulate the controller going unreachable (offline banner testing).

## Environment variables

| var | notes |
|---|---|
| `DATABASE_URL` | Postgres, e.g. `postgres://sprinkler:sprinkler@localhost:5435/sprinkler` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | public app URL (`http://localhost:3000` in dev) |
| `TRUSTED_ORIGINS` | comma-separated origins allowed to call auth endpoints; defaults to `http://localhost:3000,http://127.0.0.1:3000` when unset. In production, set to the real `scheme://host[:port]` users hit (e.g. the ingress hostname) |
| `EXECUTOR_URL` | executor base URL; server-side only |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | consumed by `npm run seed` only |

## Production

```sh
npm run build                     # or:
docker build -t rainbird-web-next .
```

Multi-stage Dockerfile, Next standalone output, runs as non-root on :3000.
Kubernetes manifests: `deploy/k8s/web-next.yaml` (+ secret in
`deploy/k8s/secret.example.yaml`). Run `db:migrate`/`seed` against the
cluster DB from a checkout — the image doesn't run migrations itself.
