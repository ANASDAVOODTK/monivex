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
FROM alpine:3.20

# docker-cli + compose plugin so the templates feature (docker compose up -d)
# works against the host socket mounted at /var/run/docker.sock.
# tzdata + ca-certificates for HTTPS calls to remote agents.
RUN apk add --no-cache \
      ca-certificates \
      tzdata \
      docker-cli \
      docker-cli-compose \
      su-exec \
    && addgroup -S -g 1000 monitor \
    && adduser -S -u 1000 -G monitor -h /var/lib/server-monitor monitor \
    && mkdir -p /var/lib/server-monitor /etc/server-monitor \
    && chown -R monitor:monitor /var/lib/server-monitor

COPY --from=go /out/server-monitor /usr/local/bin/server-monitor
COPY deploy/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/server-monitor

# Default bind. Override via SM_BIND env or by mounting a config.yaml.
ENV SM_MODE=hub \
    SM_BIND=0.0.0.0:8080 \
    SM_DATA_DIR=/var/lib/server-monitor \
    SM_DOCKER_SOCKET=/var/run/docker.sock \
    SM_TEMPLATES_ROOT=/var/lib/server-monitor/templates \
    HOST_PROC=/host/proc \
    HOST_SYS=/host/sys \
    HOST_ETC=/host/etc

EXPOSE 8080
VOLUME ["/var/lib/server-monitor"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
