package config

import "os"

// DefaultPath returns the config-file path the binary should use when no
// --config flag is given. Honors the SM_CONFIG environment variable so the
// Docker image (which sets SM_CONFIG=/etc/server-monitor/config.yaml) and
// `docker compose exec server-monitor pair ...` both open the same SQLite
// database the daemon is using. Falls back to "config.yaml" for plain
// `go run` / bare-metal development.
func DefaultPath() string {
	if p := os.Getenv("SM_CONFIG"); p != "" {
		return p
	}
	return "config.yaml"
}
