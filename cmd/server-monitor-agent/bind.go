package main

import (
	"github.com/ANASDAVOODTK/server-monitor/internal/bindfix"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
)

// normalizeAgentBind delegates to internal/bindfix. Kept as a thin local
// wrapper so the call site in main reads naturally.
func normalizeAgentBind(cfg *config.Config) bool {
	return bindfix.NormalizeAgentBind(cfg)
}
