package templates

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// Compose wraps the `docker compose` CLI for a single project. It is a thin
// helper; one Compose instance is bound to a single workdir + project name.
type Compose struct {
	Project string
	WorkDir string
	File    string // docker-compose.yml (relative or absolute)
	EnvFile string // .env (relative or absolute)
	Bin     string // executable name; empty defaults to "docker"
}

// Available reports whether docker compose (v2, plugin form) is callable.
func ComposeAvailable(ctx context.Context, bin string) (bool, string, error) {
	if bin == "" {
		bin = "docker"
	}
	if _, err := exec.LookPath(bin); err != nil {
		return false, "", fmt.Errorf("docker not found on PATH")
	}
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx2, bin, "compose", "version", "--short").CombinedOutput()
	if err != nil {
		return false, "", fmt.Errorf("docker compose: %s", strings.TrimSpace(string(out)))
	}
	return true, strings.TrimSpace(string(out)), nil
}

func (c *Compose) bin() string {
	if c.Bin != "" {
		return c.Bin
	}
	return "docker"
}

func (c *Compose) baseArgs() []string {
	args := []string{"compose", "--project-name", c.Project, "-f", c.File}
	if c.EnvFile != "" {
		args = append(args, "--env-file", c.EnvFile)
	}
	return args
}

// run executes a compose subcommand with a timeout, returning combined output.
func (c *Compose) run(ctx context.Context, timeout time.Duration, args ...string) ([]byte, error) {
	ctx2, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	all := append(c.baseArgs(), args...)
	cmd := exec.CommandContext(ctx2, c.bin(), all...)
	cmd.Dir = c.WorkDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return out, fmt.Errorf("%s: %s", err.Error(), strings.TrimSpace(string(out)))
	}
	return out, nil
}

// Up brings the stack up in detached mode.
func (c *Compose) Up(ctx context.Context) ([]byte, error) {
	return c.run(ctx, 10*time.Minute, "up", "-d", "--remove-orphans")
}

// Start starts existing (created/stopped) services.
func (c *Compose) Start(ctx context.Context) ([]byte, error) {
	return c.run(ctx, 5*time.Minute, "start")
}

// Stop stops the stack without removing containers.
func (c *Compose) Stop(ctx context.Context) ([]byte, error) {
	return c.run(ctx, 5*time.Minute, "stop")
}

// Pull pulls the latest images for the stack.
func (c *Compose) Pull(ctx context.Context) ([]byte, error) {
	return c.run(ctx, 30*time.Minute, "pull")
}

// Down removes containers + networks. With removeVolumes true it also drops volumes.
func (c *Compose) Down(ctx context.Context, removeVolumes bool) ([]byte, error) {
	args := []string{"down", "--remove-orphans"}
	if removeVolumes {
		args = append(args, "-v")
	}
	return c.run(ctx, 10*time.Minute, args...)
}

// PS returns raw `docker compose ps` JSON output.
func (c *Compose) PS(ctx context.Context) ([]byte, error) {
	return c.run(ctx, 30*time.Second, "ps", "--format", "json", "--all")
}
