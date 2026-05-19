package main

import (
	"context"
	"crypto/tls"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/aggregator"
	"github.com/ANASDAVOODTK/server-monitor/internal/api"
	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/bindfix"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/hub"
	"github.com/ANASDAVOODTK/server-monitor/internal/servers"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
	customtpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/custom"
	qdranttpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/qdrant"
	supabasetpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/supabase"
	vllmtpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/vllm"
)

// uiFromMain is wired by embed.go in the same package.
var uiFromMain func() fs.FS

func main() {
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		switch os.Args[1] {
		case "pair":
			os.Exit(runPair(os.Args[2:]))
		}
	}

	cfgPath := flag.String("config", "config.yaml", "Path to config file")
	flag.Parse()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if cfg.IsAgent() {
		// Same logic as the dedicated agent binary — a hub-binary running in
		// agent mode must be reachable from the real hub.
		bindfix.NormalizeAgentBind(cfg)
	}

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
	if !cfg.IsAgent() {
		// Agents never need a login (no UI), so we don't bother the operator
		// with the first-run banner there.
		authSvc.PrintFirstRunBanner()
	}

	h := hub.New(cfg, st)
	defer h.Close()
	go h.Run(ctx)

	// Templates run on both hubs and agents — the hub proxies "deploy"
	// requests through to whichever agent owns the target server, so the
	// agent needs a local Service to handle them.
	tplReg := templates.NewRegistry()
	tplReg.Register(qdranttpl.New())
	tplReg.Register(supabasetpl.New())
	tplReg.Register(vllmtpl.New())
	tplReg.Register(customtpl.New())
	tplSvc := templates.NewService(tplReg, st, cfg.DataDir, cfg.Templates.StorageRoot)
	go runTemplateReconciler(ctx, tplSvc)

	// Registry + aggregator + UI are hub-only. In agent mode we skip them
	// so the agent stays small and just exposes its local API for the hub
	// to call.
	var (
		registry *servers.Registry
		agg      *aggregator.Aggregator
		ui       fs.FS
	)
	if !cfg.IsAgent() {
		registry, err = servers.New(st, authSvc.Secret())
		if err != nil {
			log.Fatalf("servers registry: %v", err)
		}
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "this server"
		}
		if _, err := registry.EnsureSelf(ctx, hostname); err != nil {
			log.Fatalf("ensure self server: %v", err)
		}

		agg = aggregator.New(registry, h)
		go agg.Run(ctx)

		if uiFromMain != nil {
			ui = uiFromMain()
		}
	} else {
		log.Printf("running in AGENT mode — UI, servers registry, and aggregator are disabled")
	}

	srv := api.NewServer(cfg, st, authSvc, h, tplSvc, registry, agg, ui)

	httpServer := &http.Server{
		Addr:              cfg.Server.Bind,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	if cfg.Server.TLS.Enabled {
		httpServer.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	}

	go func() {
		log.Printf("server-monitor listening on %s (tls=%v)", cfg.Server.Bind, cfg.Server.TLS.Enabled)
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

	// Graceful shutdown
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down...")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	_ = httpServer.Shutdown(shutCtx)
	cancel()
}

func runTemplateReconciler(ctx context.Context, svc *templates.Service) {
	// Initial reconcile after a small delay so docker compose finishes warming.
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
