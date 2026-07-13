# Sprinkler — Local Rain Bird Controller App

## Vision

Replace the Rain Bird mobile app with a fast, reliable, 100% local web app for the
family's ESP-Me irrigation controller. No cloud dependency, no account, no ads —
open the app, water the lawn.

## Users

- **Drew** (admin): manages zones, schedules, homelab deployment.
- **Family members**: "run the back yard for 10 minutes" — zero learning curve.

## Hardware & environment constraints (non-negotiable)

- Controller: Rain Bird ESP-Me fw 2.9, 7 zones, LNK WiFi module at `192.168.86.173`
  (MAC `4c:a1:61:01:05:15`), local API password set in the Rain Bird app (used as an
  AES key, never sent on wire; provided to the executor via RAINBIRD_PASSWORD).
- The module **ignores broadcast ARP** — any host talking to it needs a static
  neighbor entry. In k8s this is a node-level concern (DaemonSet in `deploy/`).
- The module is **single-client**: exactly one in-flight request, ~100ms pacing
  between commands, exponential backoff on failure. The backend is the only thing
  that ever talks to the module; all clients talk to the backend.
- First request after idle takes ~2s (module wakes from power-save). Sustained
  polling keeps it responsive.
- Deployment target: Talos k8s homelab (`hoytlabs`), single replica.

## MVP features & acceptance criteria

### F1 — Controller status dashboard
The home screen shows controller state at a glance.

**UAC:**
- [ ] F1.1 Given the module is reachable, the dashboard shows model name ("ESP-Me"),
      firmware, and all 7 zones within 8s of first load (allows wake latency);
      subsequent refreshes ≤3s.
- [ ] F1.2 A currently running zone is visually distinct and shows estimated time
      remaining (backend-tracked; controller doesn't report it).
- [ ] F1.3 Rain sensor state and active rain delay (if >0 days) are visible.
- [ ] F1.4 If the module is unreachable, a clear "Controller offline" banner appears
      (no blank screens, no stack traces) and the UI retries automatically.

### F2 — Manual zone control
The core daily-use feature.

**UAC:**
- [ ] F2.1 Each zone has a Start action with duration presets (5/10/15/30 min) and
      custom input (1–240 min).
- [ ] F2.2 After starting a zone, the UI reflects "running" within 5s, and the
      controller actually reports that zone active (verified via API).
- [ ] F2.3 A running zone can be stopped; "Stop all watering" is one tap from the
      dashboard. All zones idle within 5s of stopping.
- [ ] F2.4 Starting zone B while zone A runs is accepted (controller switches);
      UI reflects the change.

### F3 — Rain delay
- [ ] F3.1 User can view and set rain delay 0–14 days; setting 0 clears it.
- [ ] F3.2 The value persists (re-read from controller, not client state) after
      page refresh.

### F4 — Zone naming
- [ ] F4.1 Zones can be renamed (e.g. "Front beds", "Back lawn"); names persist
      across backend restarts (file-backed, volume-mounted in k8s).
- [ ] F4.2 Names appear everywhere zones appear.

### F5 — PWA
- [ ] F5.1 App is installable (valid manifest, service worker, icons); passes
      Chrome installability checks.
- [ ] F5.2 Mobile-first layout: all F1–F4 actions comfortably usable at 390×844;
      also clean at desktop widths.
- [ ] F5.3 Respects light/dark color scheme.

## Non-functional requirements

- [ ] N1 Backend serializes ALL module communication (one in-flight request,
      ≥100ms spacing) — enforced in code, unit-tested.
- [ ] N2 Zone commands are never queued silently: if the module is unreachable the
      API returns an error the UI surfaces.
- [ ] N3 No auth in v1 — LAN/Tailscale-only deployment, documented as such.
- [ ] N4 No telemetry, no external calls except to the module.
- [ ] N5 Backend exposes /healthz for k8s probes (does NOT hit the module).

## Out of scope for MVP (v1.1+ backlog)

- Schedule/program read & edit (protocol support on fw 2.9 needs a spike).
- Watering history/log.
- Weather-aware skip suggestions.
- Multi-controller support.
- Auth for remote exposure.

## Architecture

- `apps/api` — FastAPI + pyrainbird backend. Owns the module exclusively.
- `apps/web` — Vite + React + TS PWA. Talks only to the backend REST API.
- `deploy/k8s` — namespace, api+web Deployments, Services, arp-pinner DaemonSet.
- API contract: `docs/API.md` (source of truth for both apps).
