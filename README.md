# server-monitor

Self-hosted, multi-server monitoring dashboard. One Go binary embeds a Next.js UI, collects local metrics (CPU, RAM, disk, network, NVIDIA GPU, processes, systemd services, Docker), tails log files, and exposes everything over HTTP/WebSocket with SQLite for history.

Run the same binary on every machine you want to monitor. Designate one instance as the **hub**; from its UI you add the others as remote servers (URL + API key) and see them all on one dashboard.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Development setup](#development-setup)
- [Production: single server](#production-single-server)
- [Production: multi-server (hub + agents)](#production-multi-server-hub--agents)
- [Configuration reference](#configuration-reference)
- [Templates (one-click stacks)](#templates-one-click-stacks)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)

---

## Features

- **Real-time metrics over WebSocket** — CPU (overall + per-core), memory, swap, disks, network rates, load averages, NVIDIA GPU (utilization/temp/power/VRAM), top processes, systemd units, Docker containers.
- **History in embedded SQLite** — 1-second samples retained for ~24h (configurable) plus 1-minute rollups for ~30 days.
- **Docker controls** — start/stop/restart, live logs, interactive `exec` over a browser terminal.
- **Log tailing** — follow files on a configured allowlist.
- **PM2 / Node.js** — list, start, stop, restart, and delete PM2 apps.
- **Templates** — one-click Docker Compose stacks (Supabase, Qdrant) with auto-generated secrets and port probing. Multiple isolated deployments per template per host.
- **Multi-server** — one hub aggregates many agents over HTTPS. Agents run the same binary in `mode: agent` — no UI, no aggregator, just local collectors and the read-only API the hub calls.
- **Single static binary** — UI is embedded; no separate web server needed.
- **JWT login** — first-run setup token; password change in the UI.

## Architecture

```
                 ┌─────────── HUB (any instance) ─────────────┐
 Browser ──────▶ │  Next.js UI (embedded)                     │
                 │   /              server list               │
                 │   /servers/[id]  per-server dashboard      │
                 │                                            │
                 │  Go API + WebSockets                       │
                 │   /api/v1/servers          registry CRUD   │
                 │   /api/v1/servers/{id}/*   local | proxy   │
                 │   /ws/servers/{id}/*       local | proxy   │
                 │                                            │
                 │  Aggregator                                │
                 │   maintains one /ws/metrics per remote     │
                 │                                            │
                 │  Collectors + Hub + SQLite (local data)    │
                 └──────────────────────┬──────────────────────┘
                                        │ HTTPS + X-API-Key
                                        ▼
                 ┌─────────── AGENT (same binary) ────────────┐
                 │  Exposes /api/v1/* and /ws/* — same as the │
                 │  hub. Authenticates with API key OR JWT.   │
                 └────────────────────────────────────────────┘
```

Key points:

- **Same binary, two roles.** Pick a role per host with `mode:` in `config.yaml`:
  - `mode: hub` (default) — runs the full dashboard: UI + servers registry + aggregator + local collectors. **You only need ONE of these.**
  - `mode: agent` — headless: only local collectors + the read-only API the hub calls. No UI, no registry, no aggregator. Use this on every machine you only want to monitor — it's the lightweight footprint.
- **Pull-based.** The hub opens a long-lived WebSocket to each agent's `/ws/metrics`. Agents don't need to reach the hub.
- **Per-server API keys.** Each agent issues API keys (revocable, secrets shown once). The hub stores them encrypted with AES-GCM derived from its JWT secret.
- **Static UI.** The Next.js app is exported to plain HTML/JS and embedded into the Go binary via `go:embed`.

---

## Development setup

Requirements:

- Go ≥ 1.22 (Go 1.26 used in CI)
- Node.js ≥ 18 and npm
- Docker (optional, for Docker collector + templates)
- NVIDIA + `nvidia-smi` or NVML (optional, for GPU metrics)

### 1. Install dependencies

```bash
git clone <this repo>
cd server-monitor

# Backend
go mod tidy

# Frontend
cd web && npm install && cd ..
```

### 2. Run with hot reload (two terminals)

```bash
# Terminal A — Next.js dev server on :3000
cd web && npm run dev
#   Proxies /api/* and /ws/* to http://localhost:8080 via next.config.mjs

# Terminal B — Go backend on :8080
go run ./cmd/server-monitor --config ./config.example.yaml
```

Open <http://localhost:3000>. The Go binary will print a **one-time setup token** to its log; use it at `/setup` to create your first admin user.

The dev frontend talks to the dev backend via Next.js rewrites, so cookies and WebSockets work without CORS headaches.

### 3. Production-style build (single binary)

```bash
make build
./bin/server-monitor --config ./config.example.yaml
```

This runs `npm run build` to produce a static export under `web/out/`, copies it into `cmd/server-monitor/web-out/`, and compiles a single Go binary that serves the UI itself on port 8080.

### Make targets

| Target          | What it does                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `make web`      | Build the Next.js static export and copy it under `cmd/server-monitor/`.     |
| `make backend`  | Build the Go binary using whatever is currently in `web-out/`.               |
| `make build`    | `web` + `backend` — produces `bin/server-monitor`.                           |
| `make run`      | `build` and run with `./config.yaml`.                                        |
| `make tidy`     | `go mod tidy`.                                                               |
| `make clean`    | Remove `bin/`, `web/.next`, `web/out`, and `cmd/server-monitor/web-out/`.    |

---

## Production: single server

You can run server-monitor on one host with no remote agents. The dashboard's main page will simply list this one server (named after `hostname`).

### Build + run manually

```bash
make build
sudo install -m 0755 bin/server-monitor /usr/local/bin/server-monitor
sudo install -m 0644 config.example.yaml /etc/server-monitor.yaml
sudo /usr/local/bin/server-monitor --config /etc/server-monitor.yaml
```

### Install as a systemd service (recommended)

```bash
make build
sudo ./deploy/install.sh
```

The script:

1. Creates the `server-monitor` system user.
2. Adds it to the `docker` group if Docker is installed.
3. Installs the binary to `/opt/server-monitor/server-monitor`.
4. Installs a sample config at `/etc/server-monitor/config.yaml` (pointing `data_dir` at `/var/lib/server-monitor`).
5. Installs and enables the systemd unit at `/etc/systemd/system/server-monitor.service`.

Check status and grab the first-run setup token:

```bash
sudo systemctl status server-monitor
sudo journalctl -u server-monitor -n 100        # find the token line
```

Open `http://<host>:8080/setup` and paste the token to create your admin user.

### TLS

For anything beyond localhost, terminate TLS. Two options:

**A. Built-in TLS.** Set in `config.yaml`:

```yaml
server:
  bind: "0.0.0.0:8443"
  tls:
    enabled: true
    cert_file: "/etc/server-monitor/tls.crt"
    key_file: "/etc/server-monitor/tls.key"
```

**B. Reverse proxy** (nginx/Caddy) in front of `127.0.0.1:8080`. Forward both `/api` and `/ws` and don't strip WebSocket upgrade headers.

Caddy example:

```caddy
monitor.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

### Uninstall

```bash
sudo ./deploy/uninstall.sh
```

---

## Production: multi-server (hub + agents)

You can monitor many hosts from one dashboard. Pick one machine as the **hub** (the one you'll log into). All other monitored machines run the same binary as **agents**.

### Step 1 — install the binary everywhere

Follow [Production: single server](#production-single-server) on every machine. Set `data_dir` to a per-host writable path (the systemd installer defaults to `/var/lib/server-monitor`).

Then **set the mode in each `config.yaml`**:

- **Hub host** (the one you'll log into) — `mode: hub` or omit. This is the full dashboard.
- **All other monitored hosts** — `mode: agent`. This is the lightweight role: no UI, no aggregator goroutine, no servers registry. Restart `server-monitor` after the change.

> Only one hub is needed. Running additional hubs wastes resources and is only useful if you want multiple dashboards over the same fleet.

After this, the hub serves the dashboard on port 8080. Each agent serves only `/api/v1/*` and `/ws/*` on its port — opening it in a browser returns a plain JSON response, not a UI.

### Step 2 — generate an API key on each agent

You still need a key per agent so the hub can authenticate. Two ways:

**A. From a one-time hub login on the agent.** Promote the agent to `mode: hub` temporarily, log in, generate the key under **Settings → API keys**, copy it, then switch back to `mode: agent` and restart. Slightly fiddly but works without curl.

**B. With curl on the agent host (recommended for `mode: agent`).** The `/api/v1/api-keys` endpoint requires a JWT — but the very first time, you can still log in using the admin user you set up during single-server install.

```bash
# 1. Log in and capture the JWT cookie
curl -c /tmp/sm.jar -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"YOUR_PASSWORD"}' \
     https://<agent-host>:8080/api/v1/auth/login

# 2. Generate an API key
curl -b /tmp/sm.jar -H 'Content-Type: application/json' \
     -d '{"name":"hub at 10.0.0.5"}' \
     https://<agent-host>:8080/api/v1/api-keys

# Response contains {"id":"ak_xxx", "secret":"sm_xxxxxxxx", ...}
# Copy the secret — it's shown only once.
```

You can revoke keys later: `DELETE /api/v1/api-keys/<id>` (also through the hub UI temporarily, see "A" above). Revocation is immediate.

> Tip: an agent can hold multiple keys (one per hub). Revoking one doesn't affect the others.

### Step 3 — add agents to the hub

On the hub's web UI:

1. Visit `/` (the server list — it shows only the hub as "this" by default).
2. Click **Add server**.
3. Fill:
   - **Name** — display label (`prod-web-1`)
   - **Base URL** — full URL of the agent (`https://10.0.0.5:8443` or `http://10.0.0.5:8080`)
   - **API key** — the secret you copied in step 2
4. Click **Test** to verify the hub can reach the agent and authenticate. The agent's hostname should appear.
5. Click **Save**.

The hub immediately opens a WebSocket to the agent and starts streaming metrics. The new card appears on the list with live CPU/memory/uptime. Click it to drill into the full dashboard for that server.

### How proxying works

When you open `/servers/<id>/processes` on the hub:

- For the **self** server, the hub reads from its in-process Hub directly — same path as a standalone install.
- For a **remote** server, the hub proxies the request to `<base_url>/api/v1/processes` with `X-API-Key`, streams the response back, and reuses a per-server HTTP client.

WebSockets (`/ws/servers/<id>/metrics`, `/ws/servers/<id>/logs`, Docker `exec` and `logs`) are proxied frame-by-frame in both directions.

The hub also caches the latest snapshot from each agent for fast loading of the list page (no per-card round trip).

### Network requirements

| Direction       | Port            | Protocol         |
| --------------- | --------------- | ---------------- |
| Hub → Agent     | Agent's port    | HTTPS + WSS      |
| Browser → Hub   | Hub's port      | HTTPS + WSS      |

Agents do **not** need to reach the hub. Only the hub initiates connections.

### Self-monitoring

The hub also runs all local collectors and appears as `is_self=true` in its own server list. You can't remove the self row through the UI — disable it instead if you don't want it shown.

---

## Configuration reference

Edit `config.yaml` (or `/etc/server-monitor/config.yaml` for the systemd install).

```yaml
mode: "hub"                    # "hub" (full dashboard) or "agent" (headless, for monitored hosts)

server:
  bind: "0.0.0.0:8080"         # listen address
  tls:
    enabled: false
    cert_file: ""
    key_file: ""

data_dir: "./data"             # SQLite + templates live here

metrics:
  sample_interval: 1           # seconds between collector ticks
  persist_interval: 10         # seconds between writes to SQLite
  retention_short: "24h"       # how long to keep 1-second rows
  retention_long: "30d"        # how long to keep 1-minute rollups

processes:
  top_n: 50                    # number of processes returned per sample

logs:
  allowed_paths:               # only these files can be tailed from the UI
    - /var/log/syslog
    - /var/log/nginx/error.log

docker:
  enabled: true
  socket: "/var/run/docker.sock"

gpu:
  enabled: true
  backend: "auto"              # "nvml" (preferred), "nvidia-smi" (fallback), or "auto"

nodejs:
  enabled: true
  pm2_path: ""                 # leave empty to auto-detect on PATH
  allowed_script_prefixes: []  # absolute paths the UI may start with `pm2 start`

templates:
  storage_root: ""             # default: {data_dir}/templates
```

### CLI flags

```text
server-monitor --config <path>     # path to config.yaml (default: ./config.yaml)
```

### Environment

| Var                  | Effect                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| `SM_BACKEND_ORIGIN`  | Used by the Next.js dev server (`web/next.config.mjs`) for API proxying. Default `http://localhost:8080`. |

---

## Templates (one-click stacks)

server-monitor ships a template system that deploys multi-container stacks through Docker Compose. Each deployment is isolated (own compose project, network, volumes, and host ports), so you can run many parallel instances on one host.

**Bundled templates:** Supabase, Qdrant.

**Host requirements:**

- Docker Engine with the `docker compose` plugin (v2) on `PATH`.
- The `server-monitor` user must have access to the Docker socket (the systemd installer adds it to the `docker` group automatically).

**Workflow:**

1. Open a server → **Templates** in the sidebar.
2. Click a template (e.g. Supabase). The deploy form opens with auto-generated defaults: a fresh JWT secret, matching anon/service-role JWTs, random passwords, and host ports probed against existing deployments AND live TCP listeners (so a Supabase already on 3000/8000 won't collide). Override anything you want.
3. Hit **Deploy**. server-monitor renders a `docker-compose.yml` + `.env` into `<storage_root>/<slug>/` and runs `docker compose up -d` in the background. The deployment detail page streams status, port mappings, masked config, and an event log.
4. Manage each deployment with **Start / Stop / Update / Delete**.

**Storage layout:**

- Compose files, `.env`, and support files (e.g. `volumes/kong.yml`) live under `<storage_root>/<slug>/`. Default `storage_root` is `{data_dir}/templates`; override via `templates.storage_root`.
- Postgres data and storage objects live in Docker named volumes (`<slug>_db-data`, `<slug>_storage-data`). They survive container recreates and are removed only when you delete the deployment (which passes `down -v`). For bulk volume data on a separate disk, configure Docker's `data-root`.

**Writing a new template:** implement the `Driver` interface in `internal/templates` (`Definition`, `Validate`, `Render`) and register it in `cmd/server-monitor/main.go`. The frontend renders the form generically from the definition's `fields` and `ports`.

---

## Security notes

- **Default is LAN-only.** Bind to `127.0.0.1` if only localhost should access. For anything else, terminate TLS (built-in or reverse proxy).
- **JWT secret** is auto-generated on first run and stored in SQLite under the `settings` table. Don't ship the same `data_dir` between hosts.
- **API keys** are stored encrypted at rest (AES-GCM with a per-install key derived from the JWT secret). Plaintext is shown once at creation.
- **Self-signed certs are accepted** by the hub when talking to agents (LAN deployments commonly use them). Don't expose agents to the public internet without proper certs and firewalling.
- **Docker exec / control endpoints** require auth; arbitrary file reads are restricted to `logs.allowed_paths`.
- **Templates** only let registered drivers write to `<storage_root>/<slug>/`. User-provided env values pass through the driver's `Validate`.
- **Revoke promptly.** If you suspect a key is compromised, revoke it on the agent's Settings page. The hub will fail next reconnect and surface an `agent rejected the api key` error on the affected card.

---

## Troubleshooting

**"warming up" on `/api/v1/snapshot`** — the Hub hasn't completed its first sample. Wait 1–2 seconds.

**Hub card shows "disconnected"** — the hub couldn't reach the agent or the API key is wrong/revoked. Click the card to see `last_error`. Common causes:

- Agent process is down → `systemctl status server-monitor` on the agent.
- Wrong base URL (`http://` vs `https://`, wrong port) → edit and re-test from the hub UI.
- TLS cert untrusted → agents use self-signed certs by default; the hub already skips verification on outbound calls. If you've put a reverse proxy in front, ensure the upgrade headers are forwarded.
- API key revoked → generate a new one on the agent and update on the hub.

**"unauthorized" on every request** — your `sm_token` cookie expired (12h lifetime). Log in again.

**WebSocket terminal stuck on "Connecting"** — typically a reverse-proxy not forwarding `Upgrade`/`Connection` headers. With Caddy this works out of the box; with nginx you need:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 600s;
```

**GPU metrics missing** — verify `nvidia-smi` works as the `server-monitor` user. Set `gpu.backend: "nvidia-smi"` if NVML isn't picked up.

**Docker containers not showing** — the `server-monitor` user needs access to `/var/run/docker.sock` (membership in the `docker` group, then restart the service).

**Deep-linking to `/servers/<id>/...` returns the server list** — the SPA handler is supposed to serve the matching pre-rendered HTML (`servers/_/...html`) for any unknown `<id>`. If it doesn't, you're probably running an older build before that fix. Run `make build` again.

**Lost setup token** — if you didn't capture it on first run and have no users yet, stop the service, delete `<data_dir>/monitor.db`, and restart. A new token is printed.

---

## Repository layout

```
cmd/server-monitor/        main.go (boot), embed.go (UI embed), web-out/ (static export)
internal/
  aggregator/              long-lived WS clients to remote agents
  api/                     HTTP router + per-server handlers + proxy helper
  auth/                    JWT + API key auth, middleware
  collectors/              gopsutil / NVML / Docker / systemd collectors
  config/                  YAML config loader
  hub/                     local sample loop, broadcast, persist, rollup
  metrics/                 snapshot types
  nodejs/                  PM2 manager
  servers/                 hub-side server registry (encrypted API keys)
  store/                   SQLite store (users, settings, metrics, servers, api_keys, deployments)
  templates/               template registry, service, drivers (supabase, qdrant)
  ws/                      WebSocket handlers + WS proxy helper
web/
  app/
    page.tsx               server list
    servers/[id]/...       per-server pages (overview, processes, docker, gpu, logs, templates, ...)
    settings/              hub-level settings + API keys
  components/              UI components (sidebar, topbar, dashboard shell, ...)
  lib/                     api client, ws client, zustand store, types
deploy/                    systemd unit + install/uninstall scripts
config.example.yaml        sample config
Makefile                   build orchestration
```
