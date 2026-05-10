.PHONY: all web build backend run dev clean tidy

BIN := bin/server-monitor

all: build

web:
	cd web && npm install && npm run build
	rm -rf cmd/server-monitor/web-out
	mkdir -p cmd/server-monitor/web-out
	cp -r web/out/. cmd/server-monitor/web-out/

build: web
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(BIN) ./cmd/server-monitor

# Backend-only build (use when running `npm run dev` separately)
backend:
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -o $(BIN) ./cmd/server-monitor

run: build
	./$(BIN) --config ./config.yaml

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
