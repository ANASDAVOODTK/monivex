package main

import (
	"context"

	"github.com/ANASDAVOODTK/server-monitor/internal/agentboot"
	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// Thin wrappers around the shared internal/agentboot package so existing
// call sites in main.go (and pair.go's tests, if any) keep working.

func maybePrintBootstrapPairing(ctx context.Context, st *store.Store, a *auth.Service, cfg *config.Config) {
	agentboot.PrintBootstrapPairing(ctx, st, a, cfg)
}

func detectPublicURL(cfg *config.Config) string {
	return agentboot.DetectPublicURL(cfg)
}
