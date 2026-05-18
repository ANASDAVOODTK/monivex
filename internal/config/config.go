package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	// Mode selects what the binary does. "" or "hub" runs the full dashboard
	// (UI + servers registry + aggregator + local collectors). "agent" runs
	// only the local collectors and the read-only API the hub calls — no UI,
	// no registry, no aggregator. Agent mode is the lightweight deployment
	// for monitored hosts that should not run their own dashboard.
	Mode      string          `yaml:"mode"`
	Server    ServerConfig    `yaml:"server"`
	DataDir   string          `yaml:"data_dir"`
	Metrics   MetricsConfig   `yaml:"metrics"`
	Processes ProcessesConfig `yaml:"processes"`
	Logs      LogsConfig      `yaml:"logs"`
	Docker    DockerConfig    `yaml:"docker"`
	NodeJS    NodeJSConfig    `yaml:"nodejs"`
	GPU       GPUConfig       `yaml:"gpu"`
	Templates TemplatesConfig `yaml:"templates"`
}

// IsAgent reports whether this instance should run in agent-only mode.
func (c *Config) IsAgent() bool { return c.Mode == "agent" }

type ServerConfig struct {
	Bind string    `yaml:"bind"`
	TLS  TLSConfig `yaml:"tls"`
	// AllowedOrigins gates WebSocket upgrades by the browser-supplied Origin
	// header. Empty (default) falls back to same-origin + localhost dev — the
	// usual case when the embedded UI and the API are served from the same
	// host. Set this in production if the dashboard is loaded from a different
	// host than the API (e.g. behind a reverse proxy with a different name),
	// otherwise legitimate connections will be rejected.
	AllowedOrigins []string `yaml:"allowed_origins"`
}

type TLSConfig struct {
	Enabled  bool   `yaml:"enabled"`
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
}

type MetricsConfig struct {
	SampleInterval  int      `yaml:"sample_interval"`
	PersistInterval int      `yaml:"persist_interval"`
	RetentionShort  Duration `yaml:"retention_short"`
	RetentionLong   Duration `yaml:"retention_long"`
}

// Duration is a time.Duration that unmarshals from strings like "24h" or "30d".
type Duration time.Duration

func (d *Duration) UnmarshalYAML(unmarshal func(any) error) error {
	var s string
	if err := unmarshal(&s); err != nil {
		// Try numeric (nanoseconds) for backward compat.
		var n int64
		if err2 := unmarshal(&n); err2 == nil {
			*d = Duration(n)
			return nil
		}
		return err
	}
	dur, err := parseDuration(s)
	if err != nil {
		return fmt.Errorf("parse duration %q: %w", s, err)
	}
	*d = Duration(dur)
	return nil
}

func parseDuration(s string) (time.Duration, error) {
	// Support trailing 'd' for days (Go's stdlib doesn't).
	if n := len(s); n > 0 && (s[n-1] == 'd' || s[n-1] == 'D') {
		var v float64
		if _, err := fmt.Sscanf(s[:n-1], "%f", &v); err != nil {
			return 0, err
		}
		return time.Duration(v * 24 * float64(time.Hour)), nil
	}
	return time.ParseDuration(s)
}

func (d Duration) Std() time.Duration { return time.Duration(d) }

type ProcessesConfig struct {
	TopN int `yaml:"top_n"`
}

type LogsConfig struct {
	AllowedPaths []string `yaml:"allowed_paths"`
}

type DockerConfig struct {
	Enabled bool   `yaml:"enabled"`
	Socket  string `yaml:"socket"`
}

// NodeJSConfig controls PM2 integration for the Node apps UI.
// server-monitor runs pm2 as the same OS user as the daemon; use that user's PM2_HOME.
type NodeJSConfig struct {
	Enabled bool `yaml:"enabled"`
	// PM2Path: absolute path to pm2 binary, or empty to use PATH.
	PM2Path string `yaml:"pm2_path"`
	// AllowedScriptPrefixes: absolute path prefixes for "Start app" in the UI. Empty disables starting new apps (list/stop/restart still works).
	AllowedScriptPrefixes []string `yaml:"allowed_script_prefixes"`
}

type GPUConfig struct {
	Enabled bool   `yaml:"enabled"`
	Backend string `yaml:"backend"`
}

// TemplatesConfig controls the on-disk location for template deployments.
// StorageRoot defaults to "{data_dir}/templates" when empty. Each deployment
// gets a subdirectory <StorageRoot>/<slug> containing the compose file, .env,
// and any support files. Docker named volumes (postgres data, storage objects)
// are still managed by Docker but are namespaced with the deployment slug.
type TemplatesConfig struct {
	StorageRoot string `yaml:"storage_root"`
}

func Default() *Config {
	return &Config{
		Server: ServerConfig{Bind: "0.0.0.0:8080"},
		DataDir: "./data",
		Metrics: MetricsConfig{
			SampleInterval:  1,
			PersistInterval: 10,
			RetentionShort:  Duration(24 * time.Hour),
			RetentionLong:   Duration(30 * 24 * time.Hour),
		},
		Processes: ProcessesConfig{TopN: 50},
		Logs:      LogsConfig{AllowedPaths: []string{}},
		Docker:    DockerConfig{Enabled: true, Socket: "/var/run/docker.sock"},
		NodeJS: NodeJSConfig{
			Enabled:               true,
			AllowedScriptPrefixes: []string{}, // set in config.yaml before using "Start app"
		},
		GPU: GPUConfig{Enabled: true, Backend: "auto"},
	}
}

func Load(path string) (*Config, error) {
	cfg := Default()
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			if !os.IsNotExist(err) {
				return nil, fmt.Errorf("read config: %w", err)
			}
			// Config file not found – continue with defaults.
		} else {
			if err := yaml.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("parse config: %w", err)
			}
		}
	}
	if cfg.Metrics.SampleInterval <= 0 {
		cfg.Metrics.SampleInterval = 1
	}
	if cfg.Metrics.PersistInterval <= 0 {
		cfg.Metrics.PersistInterval = 10
	}
	if cfg.DataDir == "" {
		cfg.DataDir = "./data"
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	return cfg, nil
}
