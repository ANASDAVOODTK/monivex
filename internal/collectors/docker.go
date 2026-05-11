package collectors

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"

	"github.com/ANASDAVOODTK/server-monitor/internal/metrics"
)

type DockerCollector struct {
	enabled bool
	cli     *client.Client
}

func NewDockerCollector(enabled bool, socket string) *DockerCollector {
	d := &DockerCollector{enabled: enabled}
	if !enabled {
		return d
	}
	host := "unix://" + socket
	cli, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		d.enabled = false
		return d
	}
	d.cli = cli
	return d
}

func (d *DockerCollector) Available() bool { return d.enabled }

func (d *DockerCollector) Close() {
	if d.cli != nil {
		_ = d.cli.Close()
	}
}

// statsJSON mirrors the parts of the Docker stats response we use, so we
// don't depend on type renames between SDK versions.
type statsJSON struct {
	CPUStats    cpuStats               `json:"cpu_stats"`
	PreCPUStats cpuStats               `json:"precpu_stats"`
	MemoryStats memoryStat             `json:"memory_stats"`
	Networks    map[string]networkStat `json:"networks"`
}

type cpuStats struct {
	CPUUsage struct {
		TotalUsage  uint64   `json:"total_usage"`
		PercpuUsage []uint64 `json:"percpu_usage"`
	} `json:"cpu_usage"`
	SystemUsage uint64 `json:"system_cpu_usage"`
	OnlineCPUs  uint32 `json:"online_cpus"`
}

type memoryStat struct {
	Usage uint64            `json:"usage"`
	Limit uint64            `json:"limit"`
	Stats map[string]uint64 `json:"stats"`
}

type networkStat struct {
	RxBytes uint64 `json:"rx_bytes"`
	TxBytes uint64 `json:"tx_bytes"`
}

func (d *DockerCollector) Collect(ctx context.Context) []metrics.Container {
	if !d.enabled || d.cli == nil {
		return nil
	}
	cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	list, err := d.cli.ContainerList(cctx, container.ListOptions{All: true})
	if err != nil {
		return nil
	}
	results := make([]metrics.Container, len(list))
	var wg sync.WaitGroup
	for i, c := range list {
		i, c := i, c
		name := ""
		if len(c.Names) > 0 {
			name = strings.TrimPrefix(c.Names[0], "/")
		}
		base := metrics.Container{
			ID:      c.ID[:minInt(12, len(c.ID))],
			Name:    name,
			Image:   c.Image,
			State:   c.State,
			Status:  c.Status,
			Created: c.Created,
		}
		if c.State != "running" {
			results[i] = base
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			sctx, scancel := context.WithTimeout(ctx, 3*time.Second)
			defer scancel()
			stats, err := d.cli.ContainerStatsOneShot(sctx, c.ID)
			if err != nil {
				results[i] = base
				return
			}
			defer stats.Body.Close()
			var v statsJSON
			if err := json.NewDecoder(stats.Body).Decode(&v); err != nil {
				results[i] = base
				return
			}
			base.CPUPct = calcCPUPercent(&v)
			used := v.MemoryStats.Usage
			if cache, ok := v.MemoryStats.Stats["cache"]; ok && cache <= used {
				used -= cache
			}
			base.MemUsage = used
			base.MemLimit = v.MemoryStats.Limit
			if v.MemoryStats.Limit > 0 {
				base.MemPct = float64(used) / float64(v.MemoryStats.Limit) * 100
			}
			for _, n := range v.Networks {
				base.NetRx += n.RxBytes
				base.NetTx += n.TxBytes
			}
			results[i] = base
		}()
	}
	wg.Wait()
	out := make([]metrics.Container, 0, len(results))
	for _, r := range results {
		if r.ID != "" {
			out = append(out, r)
		}
	}
	return out
}

func calcCPUPercent(v *statsJSON) float64 {
	cpuDelta := float64(v.CPUStats.CPUUsage.TotalUsage) - float64(v.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(v.CPUStats.SystemUsage) - float64(v.PreCPUStats.SystemUsage)
	online := float64(v.CPUStats.OnlineCPUs)
	if online == 0 {
		online = float64(len(v.CPUStats.CPUUsage.PercpuUsage))
	}
	if systemDelta > 0 && cpuDelta > 0 && online > 0 {
		return (cpuDelta / systemDelta) * online * 100.0
	}
	return 0
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
