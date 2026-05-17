// Package bindfix normalizes the agent's listen address. An agent bound to
// loopback can't be reached by a remote hub, so we upgrade it to 0.0.0.0
// with a one-time notice. Lives in its own package so both the agent and
// hub binaries can import it.
package bindfix

import (
	"fmt"
	"net"
	"strings"

	"github.com/ANASDAVOODTK/server-monitor/internal/config"
)

// NormalizeAgentBind rewrites cfg.Server.Bind in place if it's set to a
// loopback address. Returns true if a rewrite happened.
func NormalizeAgentBind(cfg *config.Config) bool {
	host, port, err := net.SplitHostPort(cfg.Server.Bind)
	if err != nil {
		return false
	}
	if !isLoopback(host) {
		return false
	}
	old := cfg.Server.Bind
	cfg.Server.Bind = net.JoinHostPort("0.0.0.0", port)
	fmt.Println("---------------------------------------------------------------")
	fmt.Printf("NOTICE: agent bind was %q (loopback) — upgraded to %q so a remote\n",
		old, cfg.Server.Bind)
	fmt.Println("hub can reach this agent. Set a non-loopback bind in config.yaml")
	fmt.Println("to silence this message.")
	fmt.Println("---------------------------------------------------------------")
	return true
}

func isLoopback(h string) bool {
	h = strings.TrimSpace(strings.Trim(h, "[]"))
	switch strings.ToLower(h) {
	case "127.0.0.1", "::1", "localhost":
		return true
	}
	return false
}
