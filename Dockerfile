# syntax=docker/dockerfile:1.7

# ----- Stage 1: build the Next.js static export -----
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci || npm install
COPY web/ ./
RUN npm run build
# The export lands in /web/out/.

# ----- Stage 2: build the Go binary -----
FROM golang:1.25-alpine AS go
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Place the web export where embed.go expects it.
RUN rm -rf cmd/server-monitor/web-out && mkdir -p cmd/server-monitor/web-out
COPY --from=web /web/out/. cmd/server-monitor/web-out/
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/server-monitor ./cmd/server-monitor

# ----- Stage 3: runtime -----
# Debian (glibc) rather than Alpine so that, on GPU hosts, the NVIDIA driver
# libraries the container-toolkit injects at runtime (glibc-linked) load
# cleanly. The image stays small (~80 MB).
FROM debian:bookworm-slim

# docker CLI + compose plugin so the templates feature can run
# `docker compose up -d` against the host socket. ca-certificates for HTTPS
# to remote agents; tzdata for correct timestamps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg tzdata \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=go /out/server-monitor /usr/local/bin/server-monitor
COPY deploy/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/server-monitor \
    && mkdir -p /var/lib/server-monitor /etc/server-monitor

# Defaults. Override via env or by mounting /etc/server-monitor/config.yaml.
# NOTE: the container runs in the host PID + network namespaces (see the
# compose files), so gopsutil reads the host's /proc directly — no HOST_PROC
# indirection needed.
ENV SM_MODE=hub \
    SM_BIND=0.0.0.0:8080 \
    SM_DATA_DIR=/var/lib/server-monitor \
    SM_DOCKER_SOCKET=/var/run/docker.sock \
    SM_TEMPLATES_ROOT=/var/lib/server-monitor/templates

EXPOSE 8080
VOLUME ["/var/lib/server-monitor"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
