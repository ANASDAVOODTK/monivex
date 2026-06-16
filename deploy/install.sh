#!/usr/bin/env bash
# Install Monivex on a Linux host as a systemd service.
#
# Run as root from the repo root (after `make build`):
#
#   sudo ./deploy/install.sh            # install as hub (default)
#   sudo ./deploy/install.sh --agent    # install as agent (headless)
#
# The agent install just sets `mode: agent` and `bind: 0.0.0.0:8090` in the
# generated config so a hub elsewhere can reach this host.

set -euo pipefail

MODE="hub"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) MODE="agent"; shift ;;
    --hub)   MODE="hub";   shift ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo $0 $*)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_SRC="$REPO_DIR/bin/server-monitor"
CFG_SRC="$REPO_DIR/config.example.yaml"

if [[ ! -f "$BIN_SRC" ]]; then
  cat >&2 <<EOF
Binary not found at $BIN_SRC.

Build it first:

  cd $REPO_DIR
  make build
  sudo ./deploy/install.sh ${MODE:+--$MODE}
EOF
  exit 1
fi

echo "==> Installing Monivex as a systemd service (mode: $MODE)"

# 1. System user
if ! id -u server-monitor >/dev/null 2>&1; then
  useradd --system --home /var/lib/server-monitor --shell /usr/sbin/nologin server-monitor
  echo "    created user 'server-monitor'"
fi

# 2. docker group membership (only matters if Docker is installed)
if getent group docker >/dev/null 2>&1; then
  usermod -aG docker server-monitor || true
  echo "    added server-monitor to 'docker' group"
fi

# 3. Directories
install -d -o server-monitor -g server-monitor /var/lib/server-monitor
install -d -o root -g root /etc/server-monitor
install -d -o root -g root /opt/server-monitor

# 4. Binary
install -m 0755 -o root -g root "$BIN_SRC" /opt/server-monitor/server-monitor
echo "    installed /opt/server-monitor/server-monitor"

# 5. Config (don't clobber an existing one — but always print where it lives)
if [[ ! -f /etc/server-monitor/config.yaml ]]; then
  install -m 0644 -o root -g root "$CFG_SRC" /etc/server-monitor/config.yaml
  sed -i 's|^data_dir:.*|data_dir: "/var/lib/server-monitor"|' /etc/server-monitor/config.yaml
  if grep -q '^mode:' /etc/server-monitor/config.yaml; then
    sed -i "s|^mode:.*|mode: \"$MODE\"|" /etc/server-monitor/config.yaml
  else
    sed -i "1i mode: \"$MODE\"" /etc/server-monitor/config.yaml
  fi
  if [[ "$MODE" == "agent" ]]; then
    # Agents listen on :8090 by default so a hub on :8080 can coexist if both
    # ever land on the same box.
    sed -i 's|^\(\s*bind:\).*|\1 "0.0.0.0:8090"|' /etc/server-monitor/config.yaml
  fi
  echo "    wrote /etc/server-monitor/config.yaml"
else
  echo "    kept existing /etc/server-monitor/config.yaml"
fi

# 6. Systemd unit
install -m 0644 -o root -g root "$REPO_DIR/deploy/server-monitor.service" /etc/systemd/system/server-monitor.service

# 7. Enable + start
systemctl daemon-reload
systemctl enable --now server-monitor

# 8. Read the token straight from the journal so the operator doesn't have to
#    pipe-grep anything. We wait up to ~10s for the binary to print it.
PORT="$(awk -F'[":]+' '/^\s*bind:/ {print $(NF-1) }' /etc/server-monitor/config.yaml)"
PORT="${PORT:-8080}"
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-<this-host>}"

# Disable errexit + pipefail inside the polling loop: it's *expected* that grep
# returns non-zero on the first few iterations (the token may not be in the
# journal yet). Without this, `set -euo pipefail` from the top of the script
# would abort the install on the first miss.
set +e
set +o pipefail

TOKEN=""
for _ in $(seq 1 20); do   # 20 × 0.5s = 10s ceiling
  sleep 0.5
  JOURNAL="$(journalctl -u server-monitor -n 300 --no-pager 2>/dev/null)"
  if [[ "$MODE" == "hub" ]]; then
    # The setup banner is:
    #   one-time token:
    #     <48-char hex>
    TOKEN="$(printf '%s\n' "$JOURNAL" | awk '/one-time token:/ {getline; print}' \
             | tr -d ' \t\r' | grep -E '^[a-f0-9]{40,}$' | tail -1)"
  else
    # The agent prints a self-contained sm://... line.
    TOKEN="$(printf '%s\n' "$JOURNAL" | grep -oE 'sm://[A-Za-z0-9_-]+' | tail -1)"
  fi
  [[ -n "$TOKEN" ]] && break
done

set -e
set -o pipefail

echo
if [[ "$MODE" == "hub" ]]; then
  if [[ -n "$TOKEN" ]]; then
    echo "==> Hub installed."
    echo
    echo "    Open the dashboard:   http://$HOST_IP:$PORT/setup"
    echo "    One-time setup token: $TOKEN"
    echo
    echo "    (Paste the token at /setup, create an admin user, you're in.)"
  else
    echo "==> Hub installed."
    echo
    echo "    The service is up but no setup token was found in the last 10s of logs."
    echo "    Either setup is already complete, or the binary hasn't logged yet:"
    echo "      sudo journalctl -u server-monitor -n 100 --no-pager"
    echo
    echo "    Open:  http://$HOST_IP:$PORT/"
  fi
else
  if [[ -n "$TOKEN" ]]; then
    echo "==> Agent installed."
    echo
    echo "    Paste this into the hub's 'Add server' form:"
    echo
    echo "    $TOKEN"
    echo
    echo "    Agent URL: http://$HOST_IP:$PORT"
  else
    echo "==> Agent installed."
    echo
    echo "    No fresh pairing token in the last 10s of logs. To mint one now:"
    echo "      sudo -u server-monitor /opt/server-monitor/server-monitor pair http://$HOST_IP:$PORT"
    echo "    Or check existing logs:"
    echo "      sudo journalctl -u server-monitor -n 100 --no-pager"
  fi
fi
echo
echo "Useful commands:"
echo "  sudo systemctl status server-monitor"
echo "  sudo journalctl -u server-monitor -f"
echo "  sudo make uninstall                          # remove cleanly"
