#!/usr/bin/env bash
# Install server-monitor on a Linux host as a systemd service.
# Run as root. Run from the repo root after `make build`.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo $0)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_SRC="$REPO_DIR/bin/server-monitor"
CFG_SRC="$REPO_DIR/config.example.yaml"

if [[ ! -f "$BIN_SRC" ]]; then
  echo "Binary not found at $BIN_SRC. Run 'make build' first." >&2
  exit 1
fi

# 1. User
if ! id -u server-monitor >/dev/null 2>&1; then
  useradd --system --home /var/lib/server-monitor --shell /usr/sbin/nologin server-monitor
fi

# 2. Add to docker group if docker socket exists
if getent group docker >/dev/null 2>&1; then
  usermod -aG docker server-monitor || true
fi

# 3. Directories
install -d -o server-monitor -g server-monitor /var/lib/server-monitor
install -d -o root -g root /etc/server-monitor
install -d -o root -g root /opt/server-monitor

# 4. Binary
install -m 0755 -o root -g root "$BIN_SRC" /opt/server-monitor/server-monitor

# 5. Config (don't overwrite existing)
if [[ ! -f /etc/server-monitor/config.yaml ]]; then
  install -m 0644 -o root -g root "$CFG_SRC" /etc/server-monitor/config.yaml
  # Point data_dir at /var/lib/server-monitor
  sed -i 's|^data_dir:.*|data_dir: "/var/lib/server-monitor"|' /etc/server-monitor/config.yaml
fi

# 6. Systemd unit
install -m 0644 -o root -g root "$REPO_DIR/deploy/server-monitor.service" /etc/systemd/system/server-monitor.service

# 7. Enable + start
systemctl daemon-reload
systemctl enable --now server-monitor

echo
echo "Installed. Check status with:"
echo "  sudo systemctl status server-monitor"
echo "  sudo journalctl -u server-monitor -f      # see the first-run setup token"
echo
echo "Then open http://<this-host>:8080 in a browser."
