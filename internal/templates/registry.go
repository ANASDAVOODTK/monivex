package templates

import (
	"fmt"
	"sort"
	"sync"
)

// Registry holds the available template drivers, keyed by template ID.
type Registry struct {
	mu      sync.RWMutex
	drivers map[string]Driver
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{drivers: map[string]Driver{}}
}

// Register makes a driver available under its definition ID.
func (r *Registry) Register(d Driver) {
	def := d.Definition()
	if def.ID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.drivers[def.ID] = d
}

// Get returns the driver for the given template ID.
func (r *Registry) Get(id string) (Driver, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[id]
	if !ok {
		return nil, fmt.Errorf("unknown template: %s", id)
	}
	return d, nil
}

// List returns all driver definitions sorted by name.
func (r *Registry) List() []Definition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Definition, 0, len(r.drivers))
	for _, d := range r.drivers {
		out = append(out, d.Definition())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
