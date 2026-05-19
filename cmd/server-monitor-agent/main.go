// server-monitor-agent is the headless build of server-monitor.
//
// Full functionality of an agent host — local collectors, docker controls,
// container exec/log streaming, PM2/Node app management, log tailing, AND
// template deployments (Supabase, Qdrant, …) — exposed over the same HTTP/WS
// API the hub calls (JWT or X-API-Key auth).
//
// What's NOT here: the Next.js UI bundle, the servers registry, and the
// aggregator goroutine. Those are hub-only concerns. The hub still proxies
// every per-server action (deploy a template, exec a shell, restart a
// container, tail a file) to this agent's API.
//
// Use this on every host you want monitored — running this binary instead of
// `server-monitor` skips ~4 MB of embedded UI and the dormant hub/aggregator
// code paths.
package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/api"
	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/hub"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
	customtpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/custom"
	qdranttpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/qdrant"
	supabasetpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/supabase"
	vllmtpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/vllm"
)

func main() {
	// Subcommands (no leading dashes) are dispatched before flag parsing so
	// they can have their own flag sets.
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		switch os.Args[1] {
		case "pair":
			os.Exit(runPair(os.Args[2:]))
		case "help", "--help", "-h":
			printUsage()
			return
		}
	}

	cfgPath := flag.String("config", "config.yaml", "Path to config file")
	flag.Usage = printUsage
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	// Force agent role regardless of config — this binary cannot be a hub.
	cfg.Mode = "agent"
	// Agents must be reachable from the hub host; a loopback bind almost
	// always indicates leftover dev config. Upgrade to 0.0.0.0.
	normalizeAgentBind(cfg)

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	authSvc, err := auth.New(ctx, st)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}

	// Agents never log in via UI — skip the first-run user banner. Instead
	// print a pairing token on first boot (or a hint on subsequent boots).
	maybePrintBootstrapPairing(ctx, st, authSvc, cfg)

	h := hub.New(cfg, st)
	defer h.Close()
	go h.Run(ctx)

	// Templates: same registry as the hub, so the hub's "deploy" action
	// proxied to this agent works exactly like a local deploy on a hub.
	tplReg := templates.NewRegistry()
	tplReg.Register(qdranttpl.New())
	tplReg.Register(supabasetpl.New())
	tplReg.Register(vllmtpl.New())
	tplReg.Register(customtpl.New())
	tplSvc := templates.NewService(tplReg, st, cfg.DataDir, cfg.Templates.StorageRoot)
	go runTemplateReconciler(ctx, tplSvc)

	// Pass nil for registry/aggregator/ui — agents don't aggregate other
	// servers and don't serve the dashboard.
	srv := api.NewServer(cfg, st, authSvc, h, tplSvc, nil, nil, nil)

	httpServer := &http.Server{
		Addr:              cfg.Server.Bind,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	if cfg.Server.TLS.Enabled {
		httpServer.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	go func() {
		log.Printf("server-monitor-agent listening on %s (tls=%v) — headless, hub calls /api/v1/* and /ws/*",
			cfg.Server.Bind, cfg.Server.TLS.Enabled)
		var err error
		if cfg.Server.TLS.Enabled {
			err = httpServer.ListenAndServeTLS(cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile)
		} else {
			err = httpServer.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down...")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	_ = httpServer.Shutdown(shutCtx)
	cancel()
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "server-monitor-agent — headless monitoring agent.")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  server-monitor-agent [--config config.yaml]            run the agent daemon")
	fmt.Fprintln(os.Stderr, "  server-monitor-agent pair <agent-url> [--name N]       generate a pairing")
	fmt.Fprintln(os.Stderr, "                                                          string for the hub")
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Flags (daemon mode):")
	flag.PrintDefaults()
}

// runTemplateReconciler periodically refreshes deployment status from
// `docker compose ps`. Mirrors the hub's reconciler so deployments stay
// accurate even after manual docker actions on the host.
func runTemplateReconciler(ctx context.Context, svc *templates.Service) {
	timer := time.NewTimer(15 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			svc.Reconcile(ctx)
			timer.Reset(30 * time.Second)
		}
	}
}
