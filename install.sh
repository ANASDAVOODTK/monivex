#!/usr/bin/env bash
# Monivex bootstrap installer.
#
# Installs prerequisites (git, make, Go, Node.js), clones the repo, builds,
# and installs the systemd service — all in one shot.
#
#   # Install as HUB (the dashboard you log into):
#   curl -fsSL https://raw.githubusercontent.com/ANASDAVOODTK/monivex/main/install.sh | sudo bash
#
#   # Install as AGENT (a monitored host):
#   curl -fsSL https://raw.githubusercontent.com/ANASDAVOODTK/monivex/main/install.sh | sudo bash -s -- --agent

set -euo pipefail

# ---------- args ----------
MODE="hub"
GO_VERSION="1.25.4"          # bump when a newer stable Go lands
NODE_MAJOR="20"
SRC_DIR="/opt/monivex-src"

for arg in "$@"; do
  case "$arg" in
    --agent) MODE="agent" ;;
    --hub)   MODE="hub"   ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---------- helpers ----------
info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
  [[ $EUID -eq 0 ]] || die "Please run as root:  curl … | sudo bash"
}

detect_pm() {
  if   command -v apt-get >/dev/null 2>&1; then echo apt
  elif command -v dnf     >/dev/null 2>&1; then echo dnf
  elif command -v yum     >/dev/null 2>&1; then echo yum
  elif command -v pacman  >/dev/null 2>&1; then echo pacman
  else die "Unsupported distro (no apt/dnf/yum/pacman found)."
  fi
}

pm_install() {
  case "$PM" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get update -qq
            DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" >/dev/null ;;
    dnf)    dnf install -y "$@" >/dev/null ;;
    yum)    yum install -y "$@" >/dev/null ;;
    pacman) pacman -Sy --needed --noconfirm "$@" >/dev/null ;;
  esac
}

# Return 0 if $1 (installed) >= $2 (required), 1 otherwise. Semver-lite.
version_ge() {
  # shellcheck disable=SC2206
  local a=(${1//./ }) b=(${2//./ })
  for i in 0 1 2; do
    local x=${a[$i]:-0} y=${b[$i]:-0}
    if   (( x > y )); then return 0
    elif (( x < y )); then return 1
    fi
  done
  return 0
}

arch_tag() {
  case "$(uname -m)" in
    x86_64|amd64)   echo amd64 ;;
    aarch64|arm64)  echo arm64 ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
}

# ---------- 0. sanity ----------
need_root
[[ "$(uname -s)" == "Linux" ]] || die "Linux only (found $(uname -s))."
command -v systemctl >/dev/null || die "systemd is required."

PM="$(detect_pm)"
ARCH="$(arch_tag)"

info "Monivex bootstrap installer  (mode: $MODE, distro pkg: $PM, arch: $ARCH)"

# ---------- 1. base tools ----------
need=()
for cmd in git make curl tar; do
  command -v "$cmd" >/dev/null 2>&1 || need+=("$cmd")
done
if (( ${#need[@]} > 0 )); then
  info "Installing base tools: ${need[*]}"
  pm_install "${need[@]}"
fi
ok "git, make, curl, tar present"

# ---------- 2. Go ----------
install_go() {
  info "Installing Go ${GO_VERSION}"
  local tmp; tmp="$(mktemp -d)"
  local tarball="$tmp/go.tgz"
  local file="go${GO_VERSION}.linux-${ARCH}.tar.gz"
  local ok=0

  # Try each source in turn. Any single one being reachable is enough — some
  # hosts block Google CDNs, others block the China mirror, etc.
  local sources=()
  [[ -n "${GO_URL:-}" ]] && sources+=("$GO_URL")
  sources+=(
    "https://go.dev/dl/${file}"
    "https://golang.google.cn/dl/${file}"
    "https://storage.googleapis.com/golang/${file}"
  )

  for url in "${sources[@]}"; do
    info "Fetching Go from $url"
    if curl -fsSL --connect-timeout 10 --max-time 300 "$url" -o "$tarball" 2>/dev/null; then
      ok=1; break
    else
      warn "  → unreachable"
    fi
  done

  # Final fallback: a tarball the operator dropped on the machine.
  if (( ! ok )); then
    for candidate in "./${file}" "/tmp/${file}" "/tmp/go.tgz"; do
      if [[ -f "$candidate" ]]; then
        info "Using local Go tarball at $candidate"
        cp "$candidate" "$tarball"
        ok=1; break
      fi
    done
  fi

  if (( ! ok )); then
    cat >&2 <<EOF
Could not fetch Go ${GO_VERSION} from any known mirror, and no local tarball
was found. Options:

  1. Download it on a machine that has internet access:
       https://go.dev/dl/${file}
     …then transfer it to this host and re-run:
       cp ${file} /tmp/${file}
       curl -fsSL https://raw.githubusercontent.com/ANASDAVOODTK/monivex/main/install.sh | sudo bash

  2. Point the installer at a reachable URL:
       GO_URL="https://your-mirror.example/${file}" \\
         bash -c "\$(curl -fsSL https://raw.githubusercontent.com/ANASDAVOODTK/monivex/main/install.sh)"
EOF
    die "Go download failed."
  fi

  rm -rf /usr/local/go
  tar -C /usr/local -xzf "$tarball"
  rm -rf "$tmp"
  ln -sf /usr/local/go/bin/go     /usr/local/bin/go
  ln -sf /usr/local/go/bin/gofmt  /usr/local/bin/gofmt
}

if command -v go >/dev/null 2>&1; then
  cur="$(go version | awk '{print $3}' | sed 's/^go//')"
  if version_ge "$cur" "1.25"; then
    ok "Go $cur is new enough"
  else
    warn "Go $cur is too old (need 1.25+); replacing"
    install_go
    ok "Go $(go version | awk '{print $3}') installed"
  fi
else
  install_go
  ok "Go $(go version | awk '{print $3}') installed"
fi

# ---------- 3. Node.js ----------
install_node() {
  info "Installing Node.js ${NODE_MAJOR}.x"
  case "$PM" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
      pm_install nodejs ;;
    dnf|yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
      pm_install nodejs ;;
    pacman)
      pm_install nodejs npm ;;
  esac
}

if command -v node >/dev/null 2>&1; then
  cur="$(node -v | sed 's/^v//')"
  if version_ge "$cur" "${NODE_MAJOR}.0"; then
    ok "Node $(node -v) is new enough"
  else
    warn "Node $cur is too old (need ${NODE_MAJOR}+); replacing"
    install_node
    ok "Node $(node -v) installed"
  fi
else
  install_node
  ok "Node $(node -v) installed"
fi

command -v npm >/dev/null || die "Node installed but npm is missing. Check the NodeSource setup output."

# ---------- 4. Repo ----------
if [[ -d "$SRC_DIR/.git" ]]; then
  info "Updating $SRC_DIR"
  if ! git -C "$SRC_DIR" pull --ff-only 2>/dev/null; then
    warn "git pull failed (uncommitted local changes?). Continuing with the current tree."
  fi
else
  info "Cloning Monivex into $SRC_DIR"
  git clone --depth 1 https://github.com/ANASDAVOODTK/monivex.git "$SRC_DIR"
fi
cd "$SRC_DIR"
ok "Sources at $SRC_DIR"

# ---------- 5. Build ----------
info "Building UI + Go binary (this takes ~1–3 min)"
# The build step needs PATH to include /usr/local/go/bin (fresh Go install) and
# whatever NodeSource put node at (typically /usr/bin). systemd's login PATH
# should already have /usr/local/bin, but explicit is safer.
export PATH="/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
make build >/dev/null
ok "Built bin/server-monitor"

# ---------- 6. Systemd service ----------
info "Installing systemd service (mode: $MODE)"
if [[ "$MODE" == "agent" ]]; then
  bash ./deploy/install.sh --agent
else
  bash ./deploy/install.sh
fi
