.PHONY: all web build backend agent run dev clean tidy install install-agent uninstall docker docker-push

BIN := bin/server-monitor
AGENT_BIN := bin/server-monitor-agent

# Docker image. Override on the command line:
#   make docker IMAGE=youruser/monivex TAG=v0.1.0
IMAGE ?= anasdavoodtk/monivex
TAG   ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo latest)

all: build

web:
	cd web && npm install && npm run build
	rm -rf cmd/server-monitor/web-out
	mkdir -p cmd/server-monitor/web-out
	cp -r web/out/. cmd/server-monitor/web-out/

build: web
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(BIN) ./cmd/server-monitor

# Backend-only build of the hub (use when running `npm run dev` separately).
backend:
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -o $(BIN) ./cmd/server-monitor

# Slim, headless agent binary. No embedded UI, no templates, no aggregator,
# no servers registry. Install this on the hosts you only want monitored.
agent:
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(AGENT_BIN) ./cmd/server-monitor-agent

run: build
	./$(BIN) --config ./config.yaml

# Install as a systemd service. Run AFTER `make build` (we deliberately do
# NOT depend on `build` here — `sudo make install` would otherwise re-run the
# Node + Go build under sudo's stripped PATH, which breaks on systems where
# npm/node come from nvm).
#   make build                         # as your user (normal PATH)
#   sudo make install                  # hub (default)
#   sudo make install-agent            # agent (headless, listens on :8090)
install:
	./deploy/install.sh

install-agent:
	./deploy/install.sh --agent

uninstall:
	./deploy/uninstall.sh

dev:
	@echo "Run in two terminals:"
	@echo "  1) cd web && npm run dev      # Next.js on :3000, proxies /api and /ws to :8080"
	@echo "  2) make backend && ./$(BIN) --config ./config.yaml"

tidy:
	go mod tidy

clean:
	rm -rf bin web/out web/.next
	rm -rf cmd/server-monitor/web-out
	mkdir -p cmd/server-monitor/web-out
	echo "# placeholder" > cmd/server-monitor/web-out/.gitkeep
	rm -f $(AGENT_BIN)

# Build the Docker image. Multi-stage Dockerfile compiles the web export AND
# the Go binary inside the image — no need to `make build` first.
docker:
	docker build -t $(IMAGE):$(TAG) -t $(IMAGE):latest .

# Push the just-built image (and :latest) to a registry. Run `docker login`
# first. Override IMAGE / TAG to publish under your own namespace.
docker-push: docker
	docker push $(IMAGE):$(TAG)
	docker push $(IMAGE):latest
