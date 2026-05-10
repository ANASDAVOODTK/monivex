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
make build      # builds web/out/, then go binary with embedded UI
./bin/server-monitor --config ./config.yaml
```

On first run, the binary prints a one-time setup token. Open `http://<host>:8080/setup` and use it to create the admin user.

## Install as a systemd service

```bash
sudo ./deploy/install.sh
sudo systemctl status server-monitor
```

## Configuration

See [config.example.yaml](config.example.yaml).

## Security notes

- LAN-only by default. Bind to `127.0.0.1` if you only want localhost.
- Read-only: no service start/stop, no `docker exec`, no arbitrary file reads.
- Log file access is restricted to the `logs.allowed_paths` whitelist.
- JWT secret is auto-generated on first run and stored in the data directory.
