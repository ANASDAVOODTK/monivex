package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig    `yaml:"server"`
	DataDir   string          `yaml:"data_dir"`
	Metrics   MetricsConfig   `yaml:"metrics"`
	Processes ProcessesConfig `yaml:"processes"`
	Logs      LogsConfig      `yaml:"logs"`
	Docker    DockerConfig    `yaml:"docker"`
	GPU       GPUConfig       `yaml:"gpu"`
}

type ServerConfig struct {
	Bind string    `yaml:"bind"`
	TLS  TLSConfig `yaml:"tls"`
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

type GPUConfig struct {
	Enabled bool   `yaml:"enabled"`
	Backend string `yaml:"backend"`
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
		GPU:       GPUConfig{Enabled: true, Backend: "auto"},
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
