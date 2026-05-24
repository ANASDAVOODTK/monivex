// Package agentboot prints the first-run pairing token an agent emits so the
// operator can paste it into the hub without running a separate `pair`
// command. Lives in its own package so both binaries (`server-monitor` in
// agent mode and the dedicated `server-monitor-agent`) can use it.
package agentboot

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/pairing"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// PrintBootstrapPairing prints a one-time `sm://...` pairing token on the
// very first boot of an agent that has no API keys yet. On subsequent boots
// it prints a hint instead.
func PrintBootstrapPairing(ctx context.Context, st *store.Store, a *auth.Service, cfg *config.Config) {
	keys, err := st.ListAPIKeys(ctx)
	if err != nil {
		return
	}
	if len(keys) > 0 {
		fmt.Println("---------------------------------------------------------------")
		fmt.Println("Agent ready. To enroll with another hub, run:")
		fmt.Printf("  server-monitor pair %s\n", DetectPublicURL(cfg))
		fmt.Println("(or `server-monitor-agent pair <url>` with the slim agent binary)")
		fmt.Println("---------------------------------------------------------------")
		return
	}

	host, _ := os.Hostname()
	name := fmt.Sprintf("bootstrap-%s-%s", host, time.Now().UTC().Format("20060102-150405"))
	_, secret, err := a.CreateAPIKey(ctx, name)
	if err != nil {
		return
	}
	url := DetectPublicURL(cfg)
	token, err := pairing.Encode(url, secret, name)
	if err != nil {
		return
	}

	fmt.Println("=================================================================")
	fmt.Println("Agent first-run — paste this into the hub's 'Add server' form:")
	fmt.Println()
	fmt.Println("  " + token)
	fmt.Println()
	fmt.Println("Agent URL:  ", url)
	fmt.Println("Key name:   ", name)
	fmt.Println("(This token is printed once. Run `server-monitor pair <url>`")
	fmt.Println(" later to mint another.)")
	fmt.Println("=================================================================")
}

// DetectPublicURL builds a best-guess URL the hub can use to reach this
// agent. Handles the common bind values:
//
//   - 0.0.0.0:N / ::N → pick the primary outbound LAN IP, fall back to hostname.
//   - 127.0.0.1:N    → keep as-is (same-host scenarios).
//   - host:N         → keep as-is.
func DetectPublicURL(cfg *config.Config) string {
	host, port, err := net.SplitHostPort(cfg.Server.Bind)
	if err != nil {
		host, port = cfg.Server.Bind, "8080"
	}
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		if ip := primaryOutboundIP(); ip != "" {
			host = ip
		} else if h, _ := os.Hostname(); h != "" {
			host = h
		} else {
			host = "127.0.0.1"
		}
	}
	scheme := "http"
	if cfg.Server.TLS.Enabled {
		scheme = "https"
	}
	// IPv6 addresses need brackets in URLs.
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		host = "[" + host + "]"
	}
	return fmt.Sprintf("%s://%s:%s", scheme, host, port)
}

// primaryOutboundIP returns the local IP of the interface a UDP packet to
// 8.8.8.8 would go out on. Doesn't actually send anything; just resolves
// the route. Returns "" if no route is available (e.g. offline).
func primaryOutboundIP() string {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || addr.IP == nil {
		return ""
	}
	return addr.IP.String()
}
