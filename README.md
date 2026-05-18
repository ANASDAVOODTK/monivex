# server-monitor

Self-hosted, multi-server monitoring dashboard. One Go binary embeds a Next.js UI, collects local metrics (CPU, RAM, disk, network, NVIDIA GPU, processes, systemd services, Docker), tails log files, and exposes everything over HTTP/WebSocket with SQLite for history.

Run the same binary on every machine you want to monitor. Designate one instance as the **hub**; from its UI you add the others as remote servers (URL + API key) and see them all on one dashboard.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Run with Docker (recommended)](#run-with-docker-recommended)
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

- **Two binaries, same packages.** Build whichever fits each host:
  - `server-monitor` — the **hub**: UI + servers registry + aggregator + templates + collectors. **You only need ONE of these** on the network.
  - `server-monitor-agent` — the **agent**: same functionality as the hub minus the UI, the servers registry, and the aggregator. It still has docker exec, container start/stop, log tailing, PM2 controls, template deploys — all the things the hub proxies to it. Install this on every machine you only want to monitor.
  - Don't want to build two binaries? Run `server-monitor` everywhere and set `mode: "agent"` in each agent's `config.yaml` — same runtime behavior, just a larger binary.
- **Pull-based.** The hub opens a long-lived WebSocket to each agent's `/ws/metrics`. Agents don't need to reach the hub.
- **One-line pairing.** Run `server-monitor-agent pair <url>` on the agent, paste the resulting `sm://...` token into the hub's **Add server** form — that's it. The token wraps URL + API key in one string.
- **Per-server API keys.** Each agent issues API keys (revocable, secrets shown once). The hub stores them encrypted with AES-GCM derived from its JWT secret.
- **Static UI.** The Next.js app is exported to plain HTML/JS and embedded into the Go binary via `go:embed`.

---

## Run with Docker (recommended)

One image — `anasdavoodtk/server-monitor` — runs as either a hub or an agent. Pick the right compose file, set your host's docker GID, and `docker compose up -d`.

### Hub host (the one you log into)

Save this as `docker-compose.yml` on the host:

```yaml
services:
  server-monitor:
    image: anasdavoodtk/server-monitor:latest
    container_name: server-monitor-hub
    restart: unless-stopped
    environment:
      SM_MODE: hub
      SM_BIND: 0.0.0.0:8080
      SM_LOG_PATHS: /host/var/log/syslog,/host/var/log/auth.log
    ports:
      - "8080:8080"
    volumes:
      - ./data:/var/lib/server-monitor
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /var/log:/host/var/log:ro
    group_add:
      - "999"   # <-- replace with: getent group docker | cut -d: -f3
```

Then:

```bash
# Find your host's docker GID and put it in group_add above
getent group docker | cut -d: -f3

docker compose up -d
docker compose logs -f server-monitor      # grab the first-run setup token
```

Open <http://your-host:8080/setup>, paste the token, create the admin user. Done.

### Every monitored host (agent)

```yaml
services:
  server-monitor:
    image: anasdavoodtk/server-monitor:latest
    container_name: server-monitor-agent
    restart: unless-stopped
    environment:
      SM_MODE: agent
      SM_BIND: 0.0.0.0:8090
    ports:
      - "8090:8090"
    volumes:
      - ./data:/var/lib/server-monitor
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /var/log:/host/var/log:ro
    group_add:
      - "999"   # <-- getent group docker | cut -d: -f3
```

```bash
docker compose up -d
docker compose logs server-monitor | head -40
```

The log shows an `sm://...` line — paste it into the hub UI's **Add server** form. That's it.

### Env vars the entrypoint accepts

| Variable             | Default                                | Notes                                                  |
| -------------------- | -------------------------------------- | ------------------------------------------------------ |
| `SM_MODE`            | `hub`                                  | `hub` or `agent`.                                      |
| `SM_BIND`            | `0.0.0.0:8080`                         | Listen address inside the container.                   |
| `SM_DATA_DIR`        | `/var/lib/server-monitor`              | Matches the volume mount.                              |
| `SM_DOCKER_SOCKET`   | `/var/run/docker.sock`                 | Where the agent finds the host's docker socket.        |
| `SM_TEMPLATES_ROOT`  | `/var/lib/server-monitor/templates`    | Where rendered compose files live.                     |
| `SM_LOG_PATHS`       | empty                                  | Comma-separated allowlist for `/logs` page.            |
| `SM_TLS_CERT` / `SM_TLS_KEY` | empty                          | Paths inside the container to PEM files.               |
| `HOST_PROC/SYS/ETC`  | `/host/proc` etc.                      | Set automatically; matches the mounts above.           |

Want a real config file instead of env vars? Mount one at `/etc/server-monitor/config.yaml` — the entrypoint detects it and skips its env-driven template.

### What works inside Docker

✅ CPU/RAM/disk/network/process metrics (via the `/host/proc` + `/host/sys` mounts).
✅ Docker page + container start/stop/restart, exec terminal, container logs (via the socket mount).
✅ Templates — Supabase, Qdrant — image ships the `docker` CLI + compose plugin.
✅ Log tailing for anything under the `/var/log` bind mount.
✅ Multi-server: hub talks to agents over HTTP/WebSocket exactly like the binary install.
❌ systemd services collector — DBus isn't proxied into the container. The page renders empty.

### Push your own image

```bash
docker login
make docker IMAGE=youruser/server-monitor TAG=v0.1.0
make docker-push IMAGE=youruser/server-monitor TAG=v0.1.0
# Produces youruser/server-monitor:v0.1.0 AND youruser/server-monitor:latest
```

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

### 4. Multi-server in development (hub + local agent)

Exercise the full hub/agent flow on one machine — no remote hosts needed.

**A. Start the hub** (frontend + backend, normal dev flow):

```bash
# Terminal A — Next.js on :3000 (proxies /api and /ws to :8080)
cd web && npm run dev

# Terminal B — hub backend on :8080
go run ./cmd/server-monitor --config ./config.example.yaml
```

Complete the first-run setup at <http://localhost:3000/setup>. The hub's server list shows one card (itself).

**C. Start a second instance as the agent** on port :8090, with its own data dir. Bind to `0.0.0.0` so the URL the agent prints is reachable from any browser/process on your LAN (works fine for same-host too):

```bash
mkdir -p ./data-agent
cat > ./config.agent.yaml <<EOF
mode: agent
server:
  bind: "0.0.0.0:8090"
data_dir: "./data-agent"
logs:
  allowed_paths: []
docker:
  enabled: true
EOF

# Terminal C
go run ./cmd/server-monitor-agent --config ./config.agent.yaml
```

The agent **prints a pairing token on first boot**, e.g.:

```
=================================================================
Agent first-run — paste this into the hub's 'Add server' form:

  sm://eyJ2IjoxLCJ1cmwiOiJodHRwOi8vMTcyLjE4LjIwMS43Mjo4MDkwIi...

Agent URL:   http://172.18.201.72:8090
...
=================================================================
```

**D. Add it on the hub UI**: open <http://localhost:3000>, click **Add server**, paste the `sm://...` line, **Save**. Done. The hub starts streaming the agent's snapshot within ~1s; clicking the card opens its dashboard.

To reset: stop terminal C, `rm -rf data-agent`. To re-pair without a fresh data dir, run `go run ./cmd/server-monitor-agent pair http://<your-ip>:8090 --config ./config.agent.yaml` and paste that token.

> Tip: the agent's `mode: agent` config also works with the full hub binary, so you can use `go run ./cmd/server-monitor` for both instances and just point them at different config files.

### Make targets

| Target          | What it does                                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| `make web`      | Build the Next.js static export and copy it under `cmd/server-monitor/`.     |
| `make backend`  | Build the **hub** Go binary using whatever is currently in `web-out/`.       |
| `make build`    | `web` + `backend` — produces `bin/server-monitor` (the hub).                 |
| `make agent`    | Build the headless **agent** binary `bin/server-monitor-agent` (everything the hub does minus the UI / registry / aggregator). |
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

### Step 1 — pick a binary per role

The repo builds two binaries from the same packages. Use whichever fits each host:

| Binary                   | Built with        | Role | Includes        |
| ------------------------ | ----------------- | ---- | --------------- |
| `server-monitor`         | `make build`      | Hub  | UI + servers registry + aggregator + templates + collectors |
| `server-monitor-agent`   | `make agent`      | Agent (recommended for monitored hosts) | **Everything the hub has, minus the UI / registry / aggregator.** Still supports docker controls + exec, log tailing, PM2, template deploys — all the things the hub proxies to an agent. |

Install one **hub** somewhere (your dashboard host), then install the **agent** on every machine you want to monitor:

```bash
# On the hub host
make build
sudo ./deploy/install.sh                       # systemd, full dashboard on :8080

# On every other host you want monitored
make agent
sudo install -m 0755 bin/server-monitor-agent /usr/local/bin/
sudo install -m 0644 config.example.yaml /etc/server-monitor.yaml
# Optional: write a systemd unit pointing at the agent binary
sudo /usr/local/bin/server-monitor-agent --config /etc/server-monitor.yaml
```

> Don't have time to build the slim binary? **Alternative:** install the full `server-monitor` on every host and set `mode: "agent"` in each agent's `config.yaml`. Same runtime behavior — just a larger binary. Restart `server-monitor` after the change.

After this, the hub serves the dashboard on port 8080. Each agent serves only `/api/v1/*` and `/ws/*` on its port — opening it in a browser returns a plain JSON response, not a UI.

### Step 2 — enroll each agent in the hub

This is just **copy a line, paste it once**. On the agent's first boot you'll see something like this in its log:

```
=================================================================
Agent first-run — paste this into the hub's 'Add server' form:

  sm://eyJ2IjoxLCJ1cmwiOiJodHRwOi8vMTAuMC4wLjU6ODA4MCIsImtleSI6InNtX...

Agent URL:   http://10.0.0.5:8080
Key name:    bootstrap-prod-web-1-20260517-150405
(This token is printed once. Run `server-monitor-agent pair` later
 to mint another.)
=================================================================
```

Then on the hub's web UI:

1. Visit `/`.
2. Click **Add server**.
3. Paste the `sm://...` line into the **Pairing string** box.
4. Click **Save**.

The hub opens a WebSocket to the agent and the new card appears with live CPU/memory/uptime. Click it for the full dashboard.

The URL is detected automatically from the agent's `bind` setting:

- `bind: "0.0.0.0:8080"` → the agent picks its primary outbound LAN IP (recommended for multi-host setups).
- `bind: "<hostname>:8080"` → uses that hostname.
- `bind: "127.0.0.1:8080"` or `localhost:…` → **auto-upgraded** to `0.0.0.0:<port>` with a notice in the log. Agents have to be reachable from the hub, and binding to loopback is almost always leftover dev config. Pin a real non-loopback host in the bind value to silence the notice.

> If you missed the line (lost the log, journal rotated, etc.) just run
> `server-monitor-agent pair http://<agent-host>:8080` on the agent to mint a fresh one. The old key keeps working unless you revoke it.

> Need to rotate? Run `pair` for a new token, then revoke the old key under the hub's **Settings → API keys** (or `DELETE /api/v1/api-keys/{id}` against the agent).

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

**Docker containers not showing / "permission denied while trying to connect to the docker API" inside the container** — the container's `monitor` user (uid 1000) doesn't have permission on the bind-mounted `/var/run/docker.sock`. Fix:

```bash
# On the host:
getent group docker | cut -d: -f3        # prints e.g. 988

# In your compose file, set:
#   group_add:
#     - "988"
docker compose up -d
```

The Docker page will show the original error inline with the fix steps if it ever happens again.

**Docker containers not showing / "permission denied" on the bare-metal install** — the user running server-monitor isn't in the host `docker` group. The Docker page in the UI now shows this error directly with the fix, but the steps are:

```bash
# Replace <user> with whoever runs the agent. With the systemd installer it's
# "server-monitor"; with `go run` during development it's your login user.
sudo usermod -aG docker <user>

# Make the new group membership active without logging out:
newgrp docker
docker ps                # should now succeed

# Restart the agent so it picks up the new group:
sudo systemctl restart server-monitor      # or kill+restart your dev process
```

This same fix also resolves template deploys that fail with `unable to get image '...': permission denied while trying to connect to the docker API` — templates shell out to `docker compose` and need the exact same socket access.

**Deep-linking to `/servers/<id>/...` returns the server list** — the SPA handler is supposed to serve the matching pre-rendered HTML (`servers/_/...html`) for any unknown `<id>`. If it doesn't, you're probably running an older build before that fix. Run `make build` again.

**Lost setup token** — if you didn't capture it on first run and have no users yet, stop the service, delete `<data_dir>/monitor.db`, and restart. A new token is printed.

---

## Repository layout

```
cmd/server-monitor/        hub main.go (boot), embed.go (UI embed), web-out/ (static export)
cmd/server-monitor-agent/  slim agent main.go — no UI, no templates, no aggregator
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
