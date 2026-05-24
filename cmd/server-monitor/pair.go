package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/pairing"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// runPair handles `server-monitor pair <url> [--name N] [--config c.yaml]`.
// Identical to the agent binary's `pair` so users get the same one-string
// enrollment whether they're running the hub or agent build on the target.
func runPair(args []string) int {
	fs := flag.NewFlagSet("pair", flag.ContinueOnError)
	cfgPath := fs.String("config", config.DefaultPath(), "Path to config file (defaults to $SM_CONFIG or ./config.yaml)")
	name := fs.String("name", "", "Display name for the generated API key (defaults to host + timestamp)")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: server-monitor pair <agent-url> [flags]")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Generates an API key on this instance and prints a single 'sm://...' pairing")
		fmt.Fprintln(os.Stderr, "string. Paste it into the hub's Add Server form to enroll this host.")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Example:")
		fmt.Fprintln(os.Stderr, "  server-monitor pair https://10.0.0.5:8080")
		fmt.Fprintln(os.Stderr, "")
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() < 1 {
		fs.Usage()
		return 2
	}
	url := strings.TrimRight(strings.TrimSpace(fs.Arg(0)), "/")
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		fmt.Fprintf(os.Stderr, "URL must start with http:// or https://, got %q\n", url)
		return 2
	}

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		return 1
	}
	st, err := store.Open(cfg.DataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "store: %v\n", err)
		return 1
	}
	defer st.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	authSvc, err := auth.New(ctx, st)
	if err != nil {
		fmt.Fprintf(os.Stderr, "auth: %v\n", err)
		return 1
	}

	keyName := *name
	if keyName == "" {
		host, _ := os.Hostname()
		keyName = fmt.Sprintf("pair-%s-%s", host, time.Now().UTC().Format("20060102-150405"))
	}

	_, secret, err := authSvc.CreateAPIKey(ctx, keyName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create api key: %v\n", err)
		return 1
	}

	token, err := pairing.Encode(url, secret, keyName)
	if err != nil {
		fmt.Fprintf(os.Stderr, "encode: %v\n", err)
		return 1
	}

	fmt.Fprintln(os.Stderr, "Created API key:", keyName)
	fmt.Fprintln(os.Stderr, "Host URL:       ", url)
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "Paste this into the hub's 'Add server' form:")
	fmt.Fprintln(os.Stderr, "")
	fmt.Println(token)
	return 0
}
