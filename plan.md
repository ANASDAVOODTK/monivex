# Plan: Self-Hosted Server Monitoring Dashboard

Build a single-binary Go backend + Next.js frontend that runs on the user's Ubuntu/Debian server, monitors CPU/RAM/Disk/Network, NVIDIA GPU, processes, systemd services, Docker containers, and tails log files. Real-time via WebSocket, historical data in embedded SQLite, JWT auth, served on LAN.

## Architecture

- **Backend**: Go (single static binary). HTTP server (chi or stdlib) on `:8080`.
  - REST API under `/api/v1/*` for snapshots, history, processes, services, containers, logs.
  - WebSocket at `/ws/metrics` pushes a metrics frame every 1s (configurable).
  - Embeds the Next.js static export via `embed.FS` so one binary serves API + UI.
- **Storage**: SQLite (pure-Go driver `modernc.org/sqlite`) with WAL.
  - `users` table, `metrics_1s` (ring buffer ~24h), `metrics_1m` rollup (~30d).
  - Background rollup goroutine compacts 1s -> 1m every minute.
- **Collectors** (each in its own goroutine, fan-in to a hub):
  - System: `github.com/shirou/gopsutil/v4` (cpu, mem, disk, net, host, process).
  - GPU: `github.com/NVIDIA/go-nvml` bindings (fallback to parsing `nvidia-smi --query-gpu=... --format=csv` if NVML unavailable).
  - Services: `github.com/coreos/go-systemd/v22/dbus` to list units (read-only — no start/stop per user choice).
  - Docker: `github.com/docker/docker/client` against `/var/run/docker.sock`.
  - Logs: `github.com/nxadm/tail` to follow whitelisted files; streamed via WebSocket `/ws/logs?path=...`.
- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + Tremor/Recharts charts + TanStack Query + Zustand (light state) + `next build && next export` static output.
- **Auth**: JWT (HS256, secret from env or generated on first run). bcrypt password hash. First-run setup wizard creates admin user.
- **Access**: LAN only; bind `0.0.0.0:8080`. Optional self-signed TLS via flag. `systemd` unit installs the binary as a service.

## Phases & Steps

### Phase 1 — Repo scaffold & build pipeline
1. Create Go module `server-monitor` with layout: `cmd/server-monitor/`, `internal/{api,auth,collectors,store,ws,config}`, `web/` (Next.js app), `embed.go`.
2. Init Next.js 15 app inside `web/` with Tailwind + shadcn/ui; configure `output: 'export'` so `next build` produces `web/out/`.
3. Add `Makefile` (or `mage`/`task`) targets: `web`, `build` (builds web first then embeds), `run`, `dev` (concurrent: Go on `:8080`, Next on `:3000` proxying `/api` & `/ws`).
4. Add `golangci-lint` config and `eslint`/`prettier` for `web/`.
*Steps 1–4 sequential.*

### Phase 2 — Backend core (parallel with Phase 4 once contracts are agreed)
5. **Config** (`internal/config`): load from `config.yaml` + env (`viper` or stdlib). Fields: bind addr, sample interval, retention, allowed log paths, JWT secret path.
6. **Store** (`internal/store`): SQLite schema migrations (use `goose` or hand-rolled), prepared statements, ring-buffer insert + rollup goroutine.
7. **Auth** (`internal/auth`): user CRUD, bcrypt, JWT issue/verify middleware, first-run admin bootstrap endpoint protected by one-time token printed to stdout.
8. **Collectors** (`internal/collectors`): one interface `Collector { Sample(ctx) (Metric, error) }` + a `Hub` that runs all collectors on a ticker and broadcasts to subscribers (WS + store writer). Implement `system`, `gpu` (NVML with `nvidia-smi` fallback), `docker`, `services`, `processes` (top-N by CPU/RAM, paginated on demand).
9. **API handlers** (`internal/api`): chi router. Endpoints:
   - `POST /api/v1/auth/login`, `POST /api/v1/auth/setup` (first-run).
   - `GET /api/v1/snapshot` — current full state.
   - `GET /api/v1/history?metric=cpu&range=1h` — time-series.
   - `GET /api/v1/processes?sort=cpu&limit=50`.
   - `GET /api/v1/services` (systemd units, filter by active/all).
   - `GET /api/v1/docker/containers`, `GET /api/v1/docker/containers/{id}/stats`.
   - `GET /api/v1/logs/sources` (whitelist), `WS /ws/logs?path=...`.
   - `WS /ws/metrics` — live stream.
10. **Embed UI**: `//go:embed web/out` + fallback file server; serve `index.html` for unknown routes (SPA fallback).
*Steps 5–7 sequential; 8, 9, 10 can run in parallel after 7.*

### Phase 3 — Hardening
11. Rate-limit `/api/v1/auth/*`; CORS only for dev; CSRF not needed for JWT-bearer.
12. Log path whitelist enforced server-side (no arbitrary file reads).
13. Read-only docker/systemd access (no exec, no start/stop) — explicitly disabled in handlers.
14. Optional TLS with self-signed cert generated on first run; `--tls` flag.
15. `systemd` unit file `deploy/server-monitor.service` + install script.

### Phase 4 — Frontend (parallel with Phase 2 after step 9 contracts exist)
16. **Layout & shell**: sidebar nav (Overview, Processes, Services, Docker, Logs, Settings), top bar with hostname/uptime, dark/light toggle.
17. **Auth flow**: `/login` page + `/setup` first-run page; store JWT in `httpOnly` cookie issued by backend; client uses cookie automatically.
18. **Live metrics hook**: `useMetricsSocket()` opens `/ws/metrics`, feeds Zustand store; TanStack Query hydrates initial state from `/snapshot`.
19. **Overview dashboard**: KPI cards (CPU%, RAM, Disk, Net I/O, GPU%, VRAM, GPU temp), 60s sparkline + 1h/24h/7d range selector backed by `/history`.
20. **GPU panel**: per-GPU cards with utilization, memory, temp, power, processes using GPU.
21. **Processes table**: TanStack Table with sort/filter, top 50 by CPU/RAM.
22. **Services panel**: systemd units list, status badges, search.
23. **Docker panel**: containers grid with live CPU/RAM per container, status, image.
24. **Logs viewer**: pick from whitelisted sources, virtualized list with autoscroll + pause + search highlight; WebSocket stream.
25. **Settings**: sample interval, retention, theme, change password.
*Steps 16–17 sequential; 18 then 19–25 mostly parallel.*

### Phase 5 — Packaging
26. GitHub Actions: build matrix `linux/amd64` + `linux/arm64`, embed `web/out`, release tarball + `.deb` (via `nfpm`).
27. README with install one-liner + screenshots.

## Relevant files (to be created)
- [cmd/server-monitor/main.go](cmd/server-monitor/main.go) — entrypoint, flag parsing, wires hub + api + store.
- [internal/collectors/system.go](internal/collectors/system.go), [gpu.go](internal/collectors/gpu.go), [docker.go](internal/collectors/docker.go), [services.go](internal/collectors/services.go).
- [internal/collectors/hub.go](internal/collectors/hub.go) — fan-in/broadcast.
- [internal/store/sqlite.go](internal/store/sqlite.go) + migrations under `internal/store/migrations/`.
- [internal/api/router.go](internal/api/router.go), `handlers_*.go`.
- [internal/auth/jwt.go](internal/auth/jwt.go), [users.go](internal/auth/users.go).
- [internal/ws/hub.go](internal/ws/hub.go) + handlers for `/ws/metrics`, `/ws/logs`.
- [embed.go](embed.go) — `//go:embed web/out` static FS.
- [web/app/(dash)/page.tsx](web/app/(dash)/page.tsx) overview, plus pages under `(dash)/processes`, `services`, `docker`, `logs`, `settings`.
- [web/lib/ws.ts](web/lib/ws.ts), [web/lib/api.ts](web/lib/api.ts), [web/store/metrics.ts](web/store/metrics.ts).
- [deploy/server-monitor.service](deploy/server-monitor.service), [deploy/install.sh](deploy/install.sh).

## Verification
1. `go test ./...` for collectors with mock samples and store roundtrips.
2. `make run` then `curl -u admin http://localhost:8080/api/v1/snapshot` returns valid JSON containing CPU/RAM/GPU sections.
3. `wscat -c ws://localhost:8080/ws/metrics` (with auth cookie/header) prints a frame every 1s.
4. Open `http://<server-lan-ip>:8080` from another LAN device, log in, see live charts updating; unplug network briefly and confirm reconnect logic.
5. `nvidia-smi` matches values shown in GPU panel within tolerance.
6. `docker stats` matches the Docker panel container metrics.
7. `journalctl -u server-monitor -f` shows clean shutdown on `systemctl stop server-monitor`.
8. Lighthouse audit on dashboard ≥ 90 perf, ≥ 95 a11y.

## Decisions
- Stack: **Go (chi + gopsutil + NVML + go-systemd + docker client) + Next.js 15 (App Router, static export) + Tailwind + shadcn/ui + Tremor/Recharts**.
- Storage: **embedded SQLite** (`modernc.org/sqlite`, pure Go — no CGO) with 1s ring + 1m rollup. Avoids running a separate Prometheus/InfluxDB.
- Single binary deployment via `embed.FS`.
- **Read-only**: no service start/stop, no `docker exec`, no arbitrary file reads. Logs limited to a whitelist.
- **Excluded** (per answers): email/Discord alerts, service control actions, public-internet hardening beyond LAN basics.

## Further Considerations
1. **Auth model**: single admin vs. multiple users with roles? Recommend **single admin for v1**; add roles later only if needed.
2. **Sampling rate**: default 1s WS push is smooth but ~86k rows/day per metric. Recommend **1s live + 10s persisted to `metrics_1s` + 1m rollup**, retention 24h/30d. Configurable.
3. **GPU library**: prefer **NVML bindings** for accuracy and lower overhead; fall back to `nvidia-smi` parsing if NVML init fails (e.g., older drivers).
