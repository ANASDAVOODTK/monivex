package collectors

import (
	"context"
	"strings"

	sdbus "github.com/coreos/go-systemd/v22/dbus"

	"github.com/yourname/server-monitor/internal/metrics"
)

type ServicesCollector struct {
	enabled bool
}

func NewServicesCollector() *ServicesCollector {
	return &ServicesCollector{enabled: true}
}

func (s *ServicesCollector) Collect(ctx context.Context) []metrics.ServiceUnit {
	if !s.enabled {
		return nil
	}
	conn, err := sdbus.NewWithContext(ctx)
	if err != nil {
		s.enabled = false
		return nil
	}
	defer conn.Close()
	units, err := conn.ListUnitsByPatternsContext(ctx, nil, []string{"*.service"})
	if err != nil {
		return nil
	}
	out := make([]metrics.ServiceUnit, 0, len(units))
	for _, u := range units {
		if !strings.HasSuffix(u.Name, ".service") {
			continue
		}
		out = append(out, metrics.ServiceUnit{
			Name:        u.Name,
			Description: u.Description,
			LoadState:   u.LoadState,
			ActiveState: u.ActiveState,
			SubState:    u.SubState,
		})
	}
	return out
}
