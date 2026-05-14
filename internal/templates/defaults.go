package templates

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"time"
)

// Defaults bundles generated config values and adjusted ports for a template.
// The frontend pre-fills the deploy form with this payload so users do not
// have to invent secrets and so default ports avoid running services.
type Defaults struct {
	Config map[string]string `json:"config"`
	Ports  map[string]int    `json:"ports"`
	Notes  []string          `json:"notes"`
}

// DefaultGenerator is an optional capability for a Driver: it can synthesize a
// fully populated config (random passwords, generated JWT tokens, etc.) for a
// fresh deployment.
type DefaultGenerator interface {
	GenerateConfig() (map[string]string, error)
}

// GenerateDefaults builds suggested config + free host ports for a template.
// Any conflicts with previously-deployed projects or with ports that are
// already in use on the host are resolved by stepping up to the next free port.
func (s *Service) GenerateDefaults(ctx context.Context, templateID string) (*Defaults, error) {
	driver, err := s.registry.Get(templateID)
	if err != nil {
		return nil, err
	}
	def := driver.Definition()

	out := &Defaults{
		Config: map[string]string{},
		Ports:  map[string]int{},
	}

	for _, f := range def.Fields {
		if f.Default != "" {
			out.Config[f.Key] = f.Default
		}
	}
	if gen, ok := driver.(DefaultGenerator); ok {
		generated, err := gen.GenerateConfig()
		if err != nil {
			return nil, fmt.Errorf("generate config: %w", err)
		}
		for k, v := range generated {
			out.Config[k] = v
		}
	}

	used, err := s.usedPorts(ctx)
	if err != nil {
		return nil, fmt.Errorf("collect used ports: %w", err)
	}
	for _, p := range def.Ports {
		free := nextFreePort(p.Default, used)
		out.Ports[p.Key] = free
		used[free] = true
		if free != p.Default {
			out.Notes = append(out.Notes, fmt.Sprintf(
				"port %d (%s) is already in use; switched to %d", p.Default, p.Key, free))
		}
	}
	return out, nil
}

// usedPorts returns ports already claimed by other deployments persisted in
// the store. The live TCP probe in nextFreePort handles non-template processes.
func (s *Service) usedPorts(ctx context.Context) (map[int]bool, error) {
	rows, err := s.store.ListTemplateDeployments(ctx)
	if err != nil {
		return nil, err
	}
	used := map[int]bool{}
	for _, r := range rows {
		var p map[string]int
		_ = json.Unmarshal(r.PortsJSON, &p)
		for _, v := range p {
			if v > 0 {
				used[v] = true
			}
		}
	}
	return used, nil
}

// nextFreePort walks upward from start looking for a port that is neither in
// the supplied used set nor currently bindable on the host. Maximum scan is
// 200 steps to keep the call snappy even on busy hosts.
func nextFreePort(start int, used map[int]bool) int {
	if start < 1 || start > 65535 {
		start = 30000
	}
	for offset := 0; offset < 200; offset++ {
		p := start + offset
		if p < 1 || p > 65535 {
			break
		}
		if used[p] {
			continue
		}
		if !portInUse(p) {
			return p
		}
	}
	return start
}

// portInUse returns true when either TCP listen on the port fails (port held
// by another process) or the port number is illegal.
func portInUse(port int) bool {
	if port <= 0 || port > 65535 {
		return true
	}
	addr := net.JoinHostPort("0.0.0.0", strconv.Itoa(port))
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return true
	}
	// Give the OS a moment to release the port for the real listener.
	_ = l.Close()
	time.Sleep(5 * time.Millisecond)
	return false
}
