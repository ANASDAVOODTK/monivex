# server-monitor

Self-hosted server monitoring dashboard. Single Go binary that embeds a Next.js UI. Monitors CPU, RAM, disk, network, NVIDIA GPU, processes, systemd services, Docker containers, and tails log files. Real-time over WebSocket; historical data in embedded SQLite.

## Quick start (development)

```bash
# 1. Backend deps
go mod tidy

# 2. Frontend deps
cd web && npm install && cd ..

# 3. Run both with hot reload (in two terminals)
cd web && npm run dev          # http://localhost:3000 (proxies /api and /ws -> :8080)
go run ./cmd/server-monitor    # http://localhost:8080
```

## Production build

```bash
make build && ./bin/server-monitor --config ./config.yaml
```

On first run, the binary prints a one-time setup token. Open `http://<host>:8080/setup` and use it to create the admin user.

## Install as a systemd service

```bash
sudo ./deploy/install.sh
sudo systemctl status server-monitor
```

## Configuration

See [config.example.yaml](config.example.yaml).

## Templates (one-click stacks)

server-monitor ships a template system that deploys multi-container stacks
through Docker Compose. The first template is **Supabase**; deployments are
fully isolated (own compose project, network, volumes and host ports), so 10+
parallel Supabase instances on one host are supported.

Requirements on the host:

- Docker Engine with the `docker compose` plugin (v2) on `PATH`.
- The `server-monitor` user must have access to the Docker socket.

Workflow:

1. Open **Templates** in the sidebar.
2. Click a template (e.g. Supabase). The deploy form opens with auto-generated
   defaults: a fresh JWT secret, matching anon/service-role JWTs, random
   passwords, and host ports that have been probed against existing
   deployments AND live TCP listeners on the host (so a Supabase already
   running on 3000/8000 will not collide). Override anything you want;
   regenerate secrets and probe for free ports from the form actions.
3. Hit **Deploy**. server-monitor renders a `docker-compose.yml` + `.env` into
   `<storage_root>/<slug>/` and runs `docker compose up -d` in the
   background. The deployment detail page streams status changes, port
   mappings, masked config and an event log.
4. Manage each deployment with **Start / Stop / Update / Delete** from the
   table or detail page.

Storage layout:

- Compose files, `.env`, and support files (e.g. `volumes/kong.yml`) live
  under `<storage_root>/<slug>/`. The default for `storage_root` is
  `{data_dir}/templates` but you can move it to a dedicated disk via
  `templates.storage_root` in `config.yaml`.
- Postgres data and Supabase storage objects live in Docker named volumes
  (`<slug>_db-data`, `<slug>_storage-data`). They survive container
  recreates and are removed only when you delete the deployment (which
  passes `down -v`). To put bulk volume data on a different disk, configure
  Docker's `data-root` rather than the template storage root.

Reusable architecture:

- New templates plug into `internal/templates.Registry` by implementing the
  `Driver` interface (`Definition`, `Validate`, `Render`).
- Persistence (deployments, env, events) is local SQLite via `internal/store`.
- Lifecycle is orchestrated by `internal/templates.Service` using the Docker
  Compose CLI.
- The frontend renders any template form generically from the driver
  Definition's `fields` and `ports`.

## Security notes

- LAN-only by default. Bind to `127.0.0.1` if you only want localhost.
- Service start/stop and `docker exec` are gated by auth; arbitrary file reads
  are restricted to the `logs.allowed_paths` whitelist.
- Template deployments execute `docker compose` against compose files
  rendered from drivers into `{data_dir}/templates/<slug>/`. Only registered
  drivers can write to that location; user-provided env values are sanitized
  by the driver's `Validate`.
- JWT secret is auto-generated on first run and stored in the data directory.
