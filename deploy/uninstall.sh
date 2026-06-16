#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run as root" >&2; exit 1; fi

systemctl disable --now server-monitor || true
rm -f /etc/systemd/system/server-monitor.service
systemctl daemon-reload
rm -rf /opt/server-monitor

echo "Removed binary and unit. Config in /etc/server-monitor and data in /var/lib/server-monitor are kept."
echo "Remove them manually if you no longer need them:"
echo "  sudo rm -rf /etc/server-monitor /var/lib/server-monitor"
echo "  sudo userdel server-monitor"
