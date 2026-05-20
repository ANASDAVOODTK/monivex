# syntax=docker/dockerfile:1.7

# ----- Stage 1: build the Next.js static export -----
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci || npm install
COPY web/ ./
RUN npm run build
# The export lands in /web/out/.

# ----- Stage 2: build the Go binary + fetch the docker CLI -----
FROM golang:1.25-alpine AS go
WORKDIR /src
RUN apk add --no-cache git ca-certificates wget
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Place the web export where embed.go expects it.
RUN rm -rf cmd/server-monitor/web-out && mkdir -p cmd/server-monitor/web-out
COPY --from=web /web/out/. cmd/server-monitor/web-out/
ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/server-monitor ./cmd/server-monitor

# Static docker CLI + compose plugin, fetched over HTTPS from Docker's
# official download server and GitHub releases. These are fully static
# binaries — they run on the glibc (Debian) runtime below. Doing it this way
# means the image builds on networks that only permit HTTPS (no apt/HTTP).
ARG DOCKER_VERSION=27.3.1
ARG COMPOSE_VERSION=2.30.3
RUN ARCH="$(uname -m)" \
    && wget -qO /tmp/docker.tgz "https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_VERSION}.tgz" \
    && tar -xzf /tmp/docker.tgz -C /tmp \
    && mkdir -p /dist/cli-plugins \
    && cp /tmp/docker/docker /dist/docker \
    && wget -qO /dist/cli-plugins/docker-compose "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
    && chmod +x /dist/docker /dist/cli-plugins/docker-compose

# ----- Stage 3: runtime -----
# Debian (glibc) so that, on GPU hosts, the NVIDIA libraries the
# container-toolkit injects at runtime load cleanly. NO apt is used — every
# runtime dependency is copied in from the build stages — so the image builds
# even on networks that only allow HTTPS downloads.
FROM debian:bookworm-slim

# CA bundle for the binary's outbound HTTPS (hub -> remote agents).
COPY --from=go /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# docker CLI + compose plugin for the templates feature.
COPY --from=go /dist/docker /usr/local/bin/docker
COPY --from=go /dist/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=go /out/server-monitor /usr/local/bin/server-monitor
COPY deploy/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/server-monitor /usr/local/bin/docker \
    && mkdir -p /var/lib/server-monitor /etc/server-monitor

# Defaults. Override via env or by mounting /etc/server-monitor/config.yaml.
# The container runs in the host PID + network namespaces (see the compose
# files), so gopsutil reads the host's /proc directly — no HOST_PROC needed.
ENV SM_MODE=hub \
    SM_BIND=0.0.0.0:8080 \
    SM_DATA_DIR=/var/lib/server-monitor \
    SM_DOCKER_SOCKET=/var/run/docker.sock \
    SM_TEMPLATES_ROOT=/var/lib/server-monitor/templates

EXPOSE 8080
VOLUME ["/var/lib/server-monitor"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
