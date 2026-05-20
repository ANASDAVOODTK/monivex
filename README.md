# Monivex

**Self-hosted fleet monitoring, Docker control, and one-click app + LLM deployment — in a single Go binary.**

[![Docker Pulls](https://img.shields.io/docker/pulls/anasdavoodtk/monivex?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/anasdavoodtk/monivex)
[![Docker Image](https://img.shields.io/docker/image-size/anasdavoodtk/monivex/latest?logo=docker&label=image%20size)](https://hub.docker.com/r/anasdavoodtk/monivex)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-repo-181717?logo=github)](https://github.com/ANASDAVOODTK/server-monitor)
![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)

Monivex is one Go binary that embeds a Next.js dashboard. It collects local metrics (CPU, RAM, disk, network, NVIDIA GPU, processes, systemd services, Docker), tails log files, deploys containerized apps and LLMs, and exposes everything over HTTP/WebSocket with SQLite for history.

Run the same binary on every machine you want to monitor. Designate one instance as the **hub** — from its dashboard you add the others as remote servers and watch the whole fleet on one screen.

<p align="center">
  <img src="screenshots/sct-1.png" alt="Monivex operations dashboard" width="900">
</p>

---

## Contents

- [Highlights](#highlights)
- [Features](#features)
- [Architecture](#architecture)
- [Quick start with Docker](#quick-start-with-docker)
- [Install from source](#install-from-source)
- [Production deployment](#production-deployment)
- [Configuration](#configuration)
- [App templates](#app-templates)
- [LLM models (vLLM)](#llm-models-vllm)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Project layout](#project-layout)

---

## Highlights

- **One binary, whole fleet.** No agents to compile separately, no external database, no message broker. Drop the binary (or container) on each host and pair it to the hub with a single copy-paste token.
- **Live everything.** Per-core CPU, memory, disks, network rates, GPU, processes, systemd units and Docker containers stream over WebSocket and persist to embedded SQLite.
- **Operate, don't just watch.** Start/stop/restart containers, open an interactive `exec` terminal in the browser, tail logs, manage PM2 apps.
- **One-click stacks.** Deploy Supabase, Qdrant, or your own pasted Compose file as isolated projects — auto-generated secrets, port probing, lifecycle controls.
- **Deploy LLMs.** A dedicated **LLM Models** tab serves any HuggingFace model through vLLM behind an OpenAI-compatible API, with a ~30-model preset catalog curated from [recipes.vllm.ai](https://recipes.vllm.ai/).

## Features

- **Real-time metrics over WebSocket** — CPU (overall + per-core), memory, swap, disks, network rates, load averages, NVIDIA GPU (utilization / temp / power / VRAM), top processes, systemd units, Docker containers.
- **History in embedded SQLite** — 1-second samples retained for ~24h (configurable) plus 1-minute rollups for ~30 days.
- **Docker controls** — start / stop / restart, live logs, interactive `exec` over a browser terminal.
- **Log tailing** — follow files on a configured allowlist.
- **PM2 / Node.js** — list, start, stop, restart, and delete PM2 apps.
- **App templates** — one-click Docker Compose stacks (Supabase, Qdrant, or a custom pasted Compose file) with auto-generated secrets and port probing. Multiple isolated deployments per template per host. The Supabase template ships optional **scheduled backups**.
- **LLM deployment** — a separate **LLM Models** section deploys vLLM inference servers from a preset catalog or fully manual config; stock images or build-on-host for bleeding-edge dependencies.
- **Multi-server** — one hub aggregates many agents over HTTPS. Agents run the same binary in `mode: agent` — no UI, no aggregator, just local collectors and the read-only API the hub calls.
- **Single static binary** — the UI is embedded; no separate web server needed.
- **JWT login** — first-run setup token; password change in the UI.

<p align="center">
  <img src="screenshots/scn-3.png" alt="Monivex Docker container fleet" width="900">
</p>

## Architecture

<p align="center">
  <img src="screenshots/architecture.png" alt="Monivex hub and agent architecture" width="660">
</p>

Key points:

- **Two roles, same packages.** The repo builds two binaries:
  - **Hub** (`server-monitor`) — UI + servers registry + aggregator + templates + collectors. **You only need ONE of these** on the network.
  - **Agent** (`server-monitor-agent`) — same functionality minus the UI, registry, and aggregator. It still has Docker exec, container control, log tailing, PM2 controls and template deploys — everything the hub proxies to it. Install this on every machine you only want to monitor.
  - Don't want two binaries? Run the hub everywhere and set `mode: "agent"` in each agent's `config.yaml` — same runtime behavior, larger binary. The single Docker image (`anasdavoodtk/monivex`) does exactly this via the `SM_MODE` variable.
- **Pull-based.** The hub opens a long-lived WebSocket to each agent's `/ws/metrics`. Agents never need to reach the hub.
- **One-line pairing.** Each agent prints an `sm://...` token on first boot — paste it into the hub's **Add server** form. The token wraps URL + API key in one string.
- **Per-server API keys.** Each agent issues revocable API keys (secrets shown once). The hub stores them encrypted with AES-GCM derived from its JWT secret.
- **Static UI.** The Next.js app is exported to plain HTML/JS and embedded into the Go binary via `go:embed`.

---

## Quick start with Docker

The published image — [`anasdavoodtk/monivex`](https://hub.docker.com/r/anasdavoodtk/monivex) — runs as either a hub or an agent. Pick the matching compose file, set your host's Docker GID, and `docker compose up -d`.

### Hub host (the one you log into)

Save this as `docker-compose.yml`:

```yaml
services:
  monivex:
    image: anasdavoodtk/monivex:latest
    container_name: monivex-hub
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
# Find your host's Docker GID and put it in group_add above
getent group docker | cut -d: -f3

docker compose up -d
docker compose logs -f monivex      # grab the first-run setup token
```

Open `http://<your-host>:8080/setup`, paste the token, create the admin user. Done.

> A ready-made `docker-compose.hub.yml` ships in this repo if you'd rather not copy the YAML.

### Every monitored host (agent)

```yaml
services:
  monivex:
    image: anasdavoodtk/monivex:latest
    container_name: monivex-agent
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
docker compose logs monivex | head -40
```

The log prints an `sm://...` line — paste it into the hub UI's **Add server** form. That's it. (Repo file: `docker-compose.agent.yml`.)

### Environment variables

The container's entrypoint translates these into a config file. Mount your own at `/etc/server-monitor/config.yaml` to bypass them entirely.

| Variable                     | Default                             | Notes                                            |
| ---------------------------- | ----------------------------------- | ------------------------------------------------ |
| `SM_MODE`                    | `hub`                               | `hub` or `agent`.                                |
| `SM_BIND`                    | `0.0.0.0:8080`                      | Listen address inside the container.             |
| `SM_DATA_DIR`                | `/var/lib/server-monitor`           | Matches the volume mount.                        |
| `SM_DOCKER_SOCKET`           | `/var/run/docker.sock`              | Where the agent finds the host's Docker socket.  |
| `SM_TEMPLATES_ROOT`          | `/var/lib/server-monitor/templates` | Where rendered Compose files live.               |
| `SM_LOG_PATHS`               | empty                               | Comma-separated allowlist for the Logs page.     |
| `SM_TLS_CERT` / `SM_TLS_KEY` | empty                               | Paths inside the container to PEM files.         |
| `HOST_PROC` / `SYS` / `ETC`  | `/host/proc` etc.                   | Set automatically; matches the mounts above.     |

### What works inside Docker

| | |
|---|---|
| ✅ | CPU / RAM / disk / network / process metrics (via the `/host/proc` + `/host/sys` mounts) |
| ✅ | Docker page + container start/stop/restart, exec terminal, container logs (via the socket mount) |
| ✅ | App templates — Supabase, Qdrant, Custom — the image ships the `docker` CLI + Compose plugin |
| ✅ | LLM Models — vLLM deploys (needs an NVIDIA GPU + container toolkit on the host) |
| ✅ | Log tailing for anything under the `/var/log` bind mount |
| ✅ | Multi-server — the hub talks to agents exactly like a binary install |
| ❌ | systemd services collector — DBus isn't proxied into the container, so the page renders empty |

---

## Install from source

### Requirements

- **Go ≥ 1.25**
- **Node.js ≥ 20** and npm (the UI is built with Next.js 16)
- Docker (optional — for the Docker collector, templates and LLM deploys)
- NVIDIA + `nvidia-smi` or NVML (optional — for GPU metrics and vLLM)

### 1. Clone and install dependencies

```bash
git clone https://github.com/ANASDAVOODTK/server-monitor.git
cd server-monitor

go mod tidy                       # backend
cd web && npm install && cd ..    # frontend
```

### 2. Run with hot reload (two terminals)

```bash
# Terminal A — Next.js dev server on :3000
cd web && npm run dev
#   Proxies /api/* and /ws/* to http://localhost:8080 via next.config.mjs

# Terminal B — Go backend on :8080
go run ./cmd/server-monitor --config ./config.example.yaml
```

Open `http://localhost:3000`. The Go binary prints a **one-time setup token** to its log — use it at `/setup` to create the first admin user. The dev frontend reaches the dev backend through Next.js rewrites, so cookies and WebSockets work without CORS headaches.

### 3. Production-style build (single binary)

```bash
make build
./bin/server-monitor --config ./config.example.yaml
```

This runs `npm run build` to produce a static export under `web/out/`, copies it into `cmd/server-monitor/web-out/`, and compiles one Go binary that serves the UI itself on port 8080.

### 4. Multi-server in development (hub + local agent)

Exercise the full hub/agent flow on one machine — no remote hosts needed.

**A. Start the hub** (frontend + backend, normal dev flow):

```bash
cd web && npm run dev                                       # Terminal A — :3000
go run ./cmd/server-monitor --config ./config.example.yaml  # Terminal B — :8080
```

Complete first-run setup at `http://localhost:3000/setup`. The server list shows one card (the hub itself).

**B. Start a second instance as the agent** on `:8090` with its own data dir:

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

go run ./cmd/server-monitor-agent --config ./config.agent.yaml   # Terminal C
```

The agent prints a pairing token on first boot:

```
=================================================================
Agent first-run — paste this into the hub's 'Add server' form:

  sm://eyJ2IjoxLCJ1cmwiOiJodHRwOi8vMTcyLjE4LjIwMS43Mjo4MDkwIi...

Agent URL:   http://172.18.201.72:8090
=================================================================
```

**C. Add it on the hub UI**: open `http://localhost:3000`, click **Add server**, paste the `sm://...` line, **Save**. The hub streams the agent's snapshot within ~1s.

To reset: stop Terminal C and `rm -rf data-agent`. To re-pair without a fresh data dir, run `go run ./cmd/server-monitor-agent pair http://<your-ip>:8090 --config ./config.agent.yaml`.

### Make targets

| Target         | What it does                                                                         |
| -------------- | ------------------------------------------------------------------------------------ |
| `make web`     | Build the Next.js static export and copy it under `cmd/server-monitor/`.              |
| `make backend` | Build the **hub** binary using whatever is currently in `web-out/`.                  |
| `make build`   | `web` + `backend` — produces `bin/server-monitor` (the hub).                         |
| `make agent`   | Build the headless **agent** binary `bin/server-monitor-agent`.                       |
| `make run`     | `build` and run with `./config.yaml`.                                                |
| `make docker`  | Build the Docker image (multi-stage — compiles UI + Go binary inside the image).      |
| `make tidy`    | `go mod tidy`.                                                                       |
| `make clean`   | Remove `bin/`, `web/.next`, `web/out`, and `cmd/server-monitor/web-out/`.             |

---

## Production deployment

### Single server

Monivex runs fine on one host with no remote agents — the dashboard simply lists that one server.

```bash
make build
sudo ./deploy/install.sh
```

The installer:

1. Creates the `server-monitor` system user.
2. Adds it to the `docker` group if Docker is installed.
3. Installs the binary to `/opt/server-monitor/server-monitor`.
4. Installs a sample config at `/etc/server-monitor/config.yaml` (`data_dir` → `/var/lib/server-monitor`).
5. Installs and enables the systemd unit `/etc/systemd/system/server-monitor.service`.

Check status and grab the first-run setup token:

```bash
sudo systemctl status server-monitor
sudo journalctl -u server-monitor -n 100        # find the token line
```

Open `http://<host>:8080/setup` and paste the token. Uninstall with `sudo ./deploy/uninstall.sh`.

### TLS

For anything beyond localhost, terminate TLS.

**A. Built-in TLS** — in `config.yaml`:

```yaml
server:
  bind: "0.0.0.0:8443"
  tls:
    enabled: true
    cert_file: "/etc/server-monitor/tls.crt"
    key_file: "/etc/server-monitor/tls.key"
```

**B. Reverse proxy** (Caddy / nginx) in front of `127.0.0.1:8080`. Forward `/api` and `/ws`, and don't strip WebSocket upgrade headers.

```caddy
monitor.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

### Multi-server (hub + agents)

Pick one machine as the **hub** (your dashboard). Every other monitored machine runs an **agent**.

```bash
# On the hub host
make build
sudo ./deploy/install.sh                       # systemd, full dashboard on :8080

# On every monitored host
make agent
sudo install -m 0755 bin/server-monitor-agent /usr/local/bin/
sudo install -m 0644 config.example.yaml /etc/server-monitor.yaml
sudo /usr/local/bin/server-monitor-agent --config /etc/server-monitor.yaml
```

> Short on time? Install the full hub binary everywhere and set `mode: "agent"` in each agent's `config.yaml` — same runtime behavior, larger binary.

**Enroll each agent.** On an agent's first boot the log prints:

```
=================================================================
Agent first-run — paste this into the hub's 'Add server' form:

  sm://eyJ2IjoxLCJ1cmwiOiJodHRwOi8vMTAuMC4wLjU6ODA4MCIsImtleSI6InNtX...

Agent URL:   http://10.0.0.5:8080
=================================================================
```

On the hub UI: visit `/`, click **Add server**, paste the `sm://...` line, **Save**. The hub opens a WebSocket and the card appears with live metrics.

The agent's URL is derived from its `bind` setting:

- `bind: "0.0.0.0:8080"` → the agent picks its primary outbound LAN IP (recommended).
- `bind: "<hostname>:8080"` → uses that hostname.
- `bind: "127.0.0.1:8080"` → **auto-upgraded** to `0.0.0.0:<port>` (loopback isn't reachable from the hub).

Missed the token? Run `server-monitor-agent pair http://<agent-host>:8080` on the agent to mint a fresh one — the old key keeps working until you revoke it under the hub's **Settings → API keys**.

### How proxying works

When you open `/servers/<id>/processes` on the hub:

- For the **self** server, the hub reads from its in-process Hub directly.
- For a **remote** server, the hub proxies the request to `<base_url>/api/v1/processes` with `X-API-Key`, streams the response back, and reuses a per-server HTTP client.

WebSockets (`/ws/servers/<id>/metrics`, `/logs`, Docker `exec` and `logs`) are proxied frame-by-frame both ways. The hub also caches the latest snapshot from each agent so the list page loads without per-card round trips.

### Network requirements

| Direction     | Port         | Protocol    |
| ------------- | ------------ | ----------- |
| Hub → Agent   | Agent's port | HTTPS + WSS |
| Browser → Hub | Hub's port   | HTTPS + WSS |

Agents do **not** need to reach the hub. Only the hub initiates connections.

---

## Configuration

Edit `config.yaml` (or `/etc/server-monitor/config.yaml` for the systemd install).

```yaml
mode: "hub"                    # "hub" (full dashboard) or "agent" (headless)

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

**CLI:** `server-monitor --config <path>` (default `./config.yaml`).

**Env:** `SM_BACKEND_ORIGIN` — used by the Next.js dev server for API proxying (default `http://localhost:8080`).

---

## App templates

Monivex deploys multi-container stacks through Docker Compose. Each deployment is isolated — its own Compose project, network, volumes and host ports — so you can run many parallel instances on one host.

**Bundled templates:**

| Template     | What it deploys                                                                       |
| ------------ | ------------------------------------------------------------------------------------- |
| **Supabase** | Full self-hosted Supabase stack (Studio, Postgres, GoTrue, PostgREST, Realtime, Storage, Kong). Auto-generated JWT secret, anon/service keys and passwords. Optional **scheduled backups**. |
| **Qdrant**   | Self-hosted Qdrant vector database with a generated API key.                          |
| **Custom**   | Paste your own `docker-compose.yml` and `.env` — deployed and managed with the same lifecycle as the built-in templates. |

**Host requirements:** Docker Engine with the `docker compose` plugin (v2) on `PATH`, and the running user with access to the Docker socket (the systemd installer handles the `docker` group automatically).

**Workflow:**

1. Open a server → **Templates** in the sidebar.
2. Pick a template. The deploy form opens with auto-generated defaults: fresh secrets and host ports probed against existing deployments **and** live TCP listeners. Override anything.
3. Hit **Deploy**. Monivex renders a `docker-compose.yml` + `.env` into `<storage_root>/<slug>/` and runs `docker compose up -d` in the background. The detail page streams status, ports, masked config and an event log.
4. Manage each deployment with **Start / Stop / Update / Delete**.

**Custom templates** — the **Custom** card accepts a free-form Compose file (validated as YAML with a non-empty `services:` map) plus an optional `.env` block. Same isolation, port handling and lifecycle as the built-ins — handy for anything without a dedicated driver.

**Supabase backups** — the Supabase deploy form has a **Backup** section (`backup_enabled`, `backup_schedule`, `backup_keep_days`). When enabled, two sidecars run on a cron schedule: a Postgres `pg_dump` and a tarball of the Storage / Studio file volumes, both written under the deployment workdir. The deployment page shows a **Backups** panel listing every artifact with size and timestamp.

**Storage layout** — Compose files, `.env` and support files live under `<storage_root>/<slug>/` (default `{data_dir}/templates`). Data lives in Docker named volumes that survive recreates and are removed only when you delete the deployment.

**Writing a new template** — implement the `Driver` interface in `internal/templates` (`Definition`, `Validate`, `Render`) and register it in `cmd/server-monitor/main.go`. The frontend renders the form generically from the definition's `fields` and `ports`.

---

## LLM models (vLLM)

The **LLM Models** sidebar tab deploys large language models through [vLLM](https://docs.vllm.ai/) behind an OpenAI-compatible API — each model an isolated Docker Compose project with the same Start / Stop / Update / Delete lifecycle as templates.

<p align="center">
  <img src="screenshots/scn-2.png" alt="Monivex vLLM model deployment form" width="900">
</p>

- **Preset catalog** — ~30 models curated from the community recipes at [recipes.vllm.ai](https://recipes.vllm.ai/) (DeepSeek, GLM, Gemma 4, Qwen, Llama, Mistral, MiniMax, Kimi, GPT-OSS, Nemotron and more). Pick **Provider → Model → Configuration** and the launch flags, context length and environment pre-fill from the recipe.
- **GPUs picker** — choose how many GPUs to shard across; it sets `--tensor-parallel-size` independently of the recipe's hardware target.
- **Custom provider** — a `Custom` option in the provider list gives a fully manual form for any model not in the catalog.
- **Image strategy** — use a stock vLLM image (`:latest` / `:nightly` / a pinned tag), or list extra pip packages and Monivex builds a small image on the host (e.g. `transformers` from `main`).
- **GPU host required** — an NVIDIA GPU with the container toolkit installed. Weights are cached on a host directory so restarts are fast.

Deploying a model writes a `docker-compose.yml` (and optional `Dockerfile`) just like a template, exposes the API on a host port, and streams status on the deployment page.

---

## Security

- **LAN-first.** Bind to `127.0.0.1` if only localhost should reach Monivex. For anything else, terminate TLS (built-in or reverse proxy).
- **JWT secret** is auto-generated on first run and stored in SQLite. Don't ship the same `data_dir` between hosts.
- **API keys** are stored encrypted at rest (AES-GCM with a per-install key derived from the JWT secret). Plaintext is shown once at creation.
- **Self-signed certs are accepted** by the hub when talking to agents (LAN deployments commonly use them). Don't expose agents to the public internet without proper certs and firewalling.
- **Docker exec / control endpoints** require auth; arbitrary file reads are restricted to `logs.allowed_paths`.
- **Templates** only let registered drivers write to `<storage_root>/<slug>/`; user-provided values pass through the driver's `Validate`.
- **Revoke promptly.** If a key is compromised, revoke it on the agent's Settings page — the hub surfaces an `agent rejected the api key` error on the affected card.

---

## Troubleshooting

**"warming up" on `/api/v1/snapshot`** — the Hub hasn't completed its first sample. Wait 1–2 seconds.

**Hub card shows "disconnected"** — the hub couldn't reach the agent or the API key is wrong/revoked. Click the card for `last_error`. Common causes: agent process down, wrong base URL (`http` vs `https`, wrong port), or a revoked key.

**"unauthorized" on every request** — your `sm_token` cookie expired (12h lifetime). Log in again.

**WebSocket terminal stuck on "Connecting"** — a reverse proxy not forwarding `Upgrade` / `Connection` headers. With nginx:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 600s;
```

**GPU metrics missing** — verify `nvidia-smi` works as the running user. Set `gpu.backend: "nvidia-smi"` if NVML isn't picked up.

**Docker containers not showing / "permission denied" connecting to the Docker API** — the running user can't read the socket.

```bash
# Inside Docker: find the host's docker GID and add it to compose's group_add.
getent group docker | cut -d: -f3

# Bare metal: add the service user to the docker group.
sudo usermod -aG docker <user>      # systemd installer user is "server-monitor"
sudo systemctl restart server-monitor
```

The same fix resolves template / LLM deploys failing with `permission denied while trying to connect to the docker API` — they shell out to `docker compose` and need identical socket access.

**Lost setup token** — if you have no users yet, stop the service, delete `<data_dir>/monitor.db`, and restart. A fresh token is printed.

---

## Contributing

Contributions are welcome — issues, bug reports and pull requests.

1. Fork and clone the repo, then follow [Install from source](#install-from-source).
2. Backend: keep `go build ./...`, `go vet ./...` and `go test ./...` green.
3. Frontend: keep `npx tsc --noEmit`, `npm run lint` and `npm run build` green.
4. Keep changes focused and describe the "why" in the PR.

Good first contributions: new app-template drivers, additional vLLM model presets, collector improvements, and docs.

## License

Monivex is released under the **MIT License** — see [`LICENSE`](LICENSE).

## Project layout

```
cmd/server-monitor/        hub main.go (boot), embed.go (UI embed), web-out/ (static export)
cmd/server-monitor-agent/  slim agent main.go — no UI, no registry, no aggregator
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
  templates/               template registry + service + drivers (supabase, qdrant, vllm, custom)
  ws/                      WebSocket handlers + WS proxy helper
web/
  app/
    page.tsx               server list
    servers/[id]/...       per-server pages (overview, processes, docker, gpu, logs,
                           templates, llm, terminal, ...)
    settings/              hub-level settings + API keys
  components/              UI components (sidebar, topbar, dashboard shell, ...)
  lib/                     api client, ws client, zustand store, types, vllm presets
deploy/                    systemd unit + install/uninstall scripts + Docker entrypoint
docker-compose.hub.yml     hub Compose file
docker-compose.agent.yml   agent Compose file
Dockerfile                 multi-stage image build
config.example.yaml        sample config
Makefile                   build orchestration
```

---

<p align="center">
  Built with Go and Next.js ·
  <a href="https://github.com/ANASDAVOODTK/server-monitor">GitHub</a> ·
  <a href="https://hub.docker.com/r/anasdavoodtk/monivex">Docker Hub</a>
</p>
