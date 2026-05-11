package nodejs

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var nameRe = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,64}$`)

// App is a slim view of one PM2 process for the UI.
type App struct {
	PMID    int     `json:"pm_id"`
	Name    string  `json:"name"`
	Status  string  `json:"status"`
	Mode    string  `json:"mode"`
	CPU     float64 `json:"cpu"`
	Memory  uint64  `json:"memory"`
	Restarts int    `json:"restarts"`
	Uptime  int64   `json:"uptime_ms"`
	Script  string  `json:"script"`
	CWD     string  `json:"cwd"`
}

// Manager runs pm2 CLI commands (same user/daemon as server-monitor).
type Manager struct {
	PM2Path               string
	AllowedScriptPrefixes []string
}

func (m *Manager) bin() string {
	if m.PM2Path != "" {
		return m.PM2Path
	}
	return "pm2"
}

func (m *Manager) run(ctx context.Context, args ...string) ([]byte, error) {
	c := exec.CommandContext(ctx, m.bin(), args...)
	c.Env = nil // inherit
	return c.CombinedOutput()
}

// Status describes whether PM2 is usable on this host.
func (m *Manager) Status(ctx context.Context) (available bool, version string, errMsg string) {
	bin := m.bin()
	if filepath.IsAbs(bin) {
		if st, err := os.Stat(bin); err != nil || st.IsDir() {
			return false, "", fmt.Sprintf("nodejs.pm2_path not found: %s", bin)
		}
	} else if _, err := exec.LookPath(bin); err != nil {
		return false, "", "pm2 not found in PATH (install Node.js + PM2 on the server)"
	}
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := m.run(ctx2, "-v")
	if err != nil {
		return false, "", fmt.Sprintf("pm2: %v — %s", err, strings.TrimSpace(string(out)))
	}
	return true, strings.TrimSpace(string(out)), ""
}

// List returns PM2 processes from `pm2 jlist`.
func (m *Manager) List(ctx context.Context) ([]App, error) {
	ctx2, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := m.run(ctx2, "jlist")
	if err != nil {
		return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	var raw []pm2JListItem
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse jlist: %w", err)
	}
	outApps := make([]App, 0, len(raw))
	for _, r := range raw {
		outApps = append(outApps, App{
			PMID:     r.PMID,
			Name:     pickStr(r.Name, r.PM2Env.Name),
			Status:   r.PM2Env.Status,
			Mode:     r.PM2Env.ExecMode,
			CPU:      r.Monit.CPU,
			Memory:   uint64(r.Monit.Memory),
			Restarts: r.PM2Env.RestartTime,
			Uptime:   r.PM2Env.PMUptime,
			Script:   r.PM2Env.PMExecPath,
			CWD:      r.PM2Env.PmCwd,
		})
	}
	return outApps, nil
}

func pickStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

type pm2JListItem struct {
	PMID   int    `json:"pm_id"`
	Name   string `json:"name"`
	PM2Env struct {
		Name         string `json:"name"`
		Status       string `json:"status"`
		ExecMode     string `json:"exec_mode"`
		PMExecPath   string `json:"pm_exec_path"`
		PmCwd        string `json:"pm_cwd"`
		RestartTime  int    `json:"restart_time"`
		PMUptime     int64  `json:"pm_uptime"`
	} `json:"pm2_env"`
	Monit struct {
		Memory float64 `json:"memory"`
		CPU    float64 `json:"cpu"`
	} `json:"monit"`
}

func (m *Manager) scriptAllowed(abs string) bool {
	clean, err := filepath.Abs(abs)
	if err != nil {
		clean = filepath.Clean(abs)
	} else {
		clean = filepath.Clean(clean)
	}
	if !filepath.IsAbs(clean) {
		return false
	}
	if len(m.AllowedScriptPrefixes) == 0 {
		return false
	}
	for _, p := range m.AllowedScriptPrefixes {
		base := filepath.Clean(p)
		if base == "" {
			continue
		}
		if clean == base || strings.HasPrefix(clean, base+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// StartNew runs `pm2 start` for a script under an allowed prefix.
func (m *Manager) StartNew(ctx context.Context, script, name, cwd string) error {
	if !nameRe.MatchString(name) {
		return fmt.Errorf("invalid name: use letters, digits, ._- up to 64 chars")
	}
	if !m.scriptAllowed(script) {
		return fmt.Errorf("script path not allowed by nodejs.allowed_script_prefixes in config")
	}
	if cwd != "" {
		if !filepath.IsAbs(cwd) {
			return fmt.Errorf("cwd must be an absolute path")
		}
		if !m.dirAllowed(cwd) {
			return fmt.Errorf("cwd not under allowed_script_prefixes")
		}
	}
	args := []string{"start", script, "--name", name}
	if cwd != "" {
		args = append(args, "--cwd", cwd)
	}
	ctx2, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := m.run(ctx2, args...)
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}

func (m *Manager) dirAllowed(dir string) bool {
	clean, _ := filepath.Abs(filepath.Clean(dir))
	for _, p := range m.AllowedScriptPrefixes {
		base := filepath.Clean(p)
		if base == "" {
			continue
		}
		if clean == base || strings.HasPrefix(clean, base+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (m *Manager) action(ctx context.Context, verb string, pmID int) error {
	ctx2, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := m.run(ctx2, verb, fmt.Sprintf("%d", pmID))
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}

func (m *Manager) Start(ctx context.Context, pmID int) error   { return m.action(ctx, "start", pmID) }
func (m *Manager) Stop(ctx context.Context, pmID int) error    { return m.action(ctx, "stop", pmID) }
func (m *Manager) Restart(ctx context.Context, pmID int) error { return m.action(ctx, "restart", pmID) }

func (m *Manager) Delete(ctx context.Context, pmID int) error {
	ctx2, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := m.run(ctx2, "delete", fmt.Sprintf("%d", pmID))
	if err != nil {
		return fmt.Errorf("%s", strings.TrimSpace(string(out)))
	}
	return nil
}
