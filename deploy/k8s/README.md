# Sprinkler — Kubernetes deployment

Plain manifests, namespace `rainbird`. Apply in order:

```sh
kubectl apply -f namespace.yaml
kubectl -n rainbird create secret generic rainbird-credentials \
  --from-literal=RAINBIRD_PASSWORD='<password>'   # or edit secret.example.yaml
kubectl -n rainbird create secret generic rainbird-web-next \
  --from-literal=DATABASE_URL='postgres://user:pass@host:5432/sprinkler' \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  --from-literal=BETTER_AUTH_URL='https://<public-hostname>' \
  --from-literal=TRUSTED_ORIGINS='https://<public-hostname>' \
  --from-literal=EXECUTOR_URL='http://rainbird-api:8000'
kubectl apply -f arp-pinner.yaml -f api.yaml -f web.yaml -f web-next.yaml
```

Before first start of web-next (and after each schema change), run from a
checkout of `apps/web-next` pointed at the cluster database:

```sh
DATABASE_URL=... npm run db:migrate
DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed  # first time only
```

Notes:

- **api runs exactly 1 replica** (`strategy: Recreate`). The LNK WiFi module is
  single-client; two pods talking to it will crash it.
- **arp-pinner is required.** The module never answers broadcast ARP, so every
  node needs a permanent neighbor entry (`ip neigh replace ... nud permanent`),
  refreshed every 60s. Set the `IFACE` env var to your node's LAN interface.
- Zone names persist on the `rainbird-api-data` PVC (mounted at `/app/data`)
  for the legacy v1 stack; the new app owns zone config in Postgres.
- **web-next** (M1) has Better Auth — point ingress at Service
  `rainbird-web-next:80`. `TRUSTED_ORIGINS` must list every real
  `scheme://host[:port]` origin users hit (i.e. the ingress hostname —
  same value as `BETTER_AUTH_URL`, plus any aliases); requests from any
  other browser Origin are rejected with 403 `INVALID_ORIGIN` before
  credentials are checked. When unset it falls back to localhost dev
  defaults, which will lock everyone out in production. The executor (`rainbird-api:8000`) is called only
  server-side by web-next via `EXECUTOR_URL`; do not expose it publicly.
- **web** (legacy Vite PWA, no auth) remains until M1 UAC passes, LAN/Tailscale
  only; it is retired at end of M1.
