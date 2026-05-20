#!/bin/sh
# Translate a handful of SM_* environment variables into a minimal
# /etc/server-monitor/config.yaml, then exec server-monitor.
#
# If the user mounts their own /etc/server-monitor/config.yaml, this script
# leaves it alone and just execs the binary.
#
# Recognised env (with defaults set in the Dockerfile):
#   SM_MODE              hub | agent              (default hub)
#   SM_BIND              listen address           (default 0.0.0.0:8080)
#   SM_DATA_DIR          persistent data dir      (default /var/lib/server-monitor)
#   SM_DOCKER_SOCKET     docker socket path       (default /var/run/docker.sock)
#   SM_TEMPLATES_ROOT    templates storage root   (default /var/lib/server-monitor/templates)
#   SM_LOG_PATHS         comma-separated paths to allow log-tailing on
#   SM_TLS_CERT          PEM path; enables HTTPS when set with SM_TLS_KEY
#   SM_TLS_KEY           PEM path
#
# Anything more advanced — mount a real config.yaml at /etc/server-monitor/config.yaml.

set -eu

CFG=/etc/server-monitor/config.yaml

if [ ! -f "$CFG" ]; then
  mkdir -p /etc/server-monitor

  TLS_BLOCK="    enabled: false"
  if [ -n "${SM_TLS_CERT:-}" ] && [ -n "${SM_TLS_KEY:-}" ]; then
    TLS_BLOCK="    enabled: true
    cert_file: \"${SM_TLS_CERT}\"
    key_file: \"${SM_TLS_KEY}\""
  fi

  LOG_BLOCK=""
  if [ -n "${SM_LOG_PATHS:-}" ]; then
    OLDIFS=$IFS
    IFS=,
    for p in $SM_LOG_PATHS; do
      p_trimmed=$(echo "$p" | sed -e 's/^ *//' -e 's/ *$//')
      [ -z "$p_trimmed" ] && continue
      LOG_BLOCK="${LOG_BLOCK}
    - \"${p_trimmed}\""
    done
    IFS=$OLDIFS
  fi

  cat > "$CFG" <<EOF
mode: "${SM_MODE}"
server:
  bind: "${SM_BIND}"
  tls:
${TLS_BLOCK}
data_dir: "${SM_DATA_DIR}"
docker:
  enabled: true
  socket: "${SM_DOCKER_SOCKET}"
templates:
  storage_root: "${SM_TEMPLATES_ROOT}"
logs:
  allowed_paths:${LOG_BLOCK}
EOF

  echo "entrypoint: generated $CFG (mode=$SM_MODE bind=$SM_BIND data_dir=$SM_DATA_DIR)"
fi

mkdir -p "${SM_DATA_DIR}" || true

# The container runs as root on purpose: a host monitor needs to read every
# process under /proc and the docker socket. This is the norm for monitoring
# containers (netdata, node-exporter, cAdvisor all run as root). The container
# is already trusted — it shares the host PID namespace and mounts the docker
# socket — so a separate unprivileged user buys nothing and only reintroduces
# the docker-GID matching problem.
exec /usr/local/bin/server-monitor --config "$CFG" "$@"
