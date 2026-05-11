package collectors

import (
	"context"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/ANASDAVOODTK/server-monitor/internal/metrics"
)

type SystemCollector struct {
	mu        sync.Mutex
	lastNet   map[string]net.IOCountersStat
	lastNetAt time.Time
	topN      int
}

func NewSystemCollector(topN int) *SystemCollector {
	if topN <= 0 {
		topN = 50
	}
	return &SystemCollector{topN: topN}
}

func (c *SystemCollector) CollectHost(ctx context.Context) metrics.Host {
	info, err := host.InfoWithContext(ctx)
	if err != nil {
		return metrics.Host{Hostname: "unknown", OS: runtime.GOOS}
	}
	return metrics.Host{
		Hostname:        info.Hostname,
		OS:              info.OS,
		Platform:        info.Platform,
		PlatformVersion: info.PlatformVersion,
		KernelVersion:   info.KernelVersion,
		Uptime:          info.Uptime,
		BootTime:        info.BootTime,
	}
}

func (c *SystemCollector) CollectCPU(ctx context.Context) metrics.CPU {
	infos, _ := cpu.InfoWithContext(ctx)
	model := ""
	cores := 0
	if len(infos) > 0 {
		model = strings.TrimSpace(infos[0].ModelName)
		for _, i := range infos {
			cores += int(i.Cores)
		}
	}
	threads, _ := cpu.CountsWithContext(ctx, true)
	per, _ := cpu.PercentWithContext(ctx, 0, true)
	overall := 0.0
	if len(per) > 0 {
		var sum float64
		for _, p := range per {
			sum += p
		}
		overall = sum / float64(len(per))
	}
	return metrics.CPU{
		Cores:   cores,
		Threads: threads,
		Model:   model,
		Overall: overall,
		PerCore: per,
	}
}

func (c *SystemCollector) CollectMemory(ctx context.Context) (metrics.Memory, metrics.Swap) {
	v, _ := mem.VirtualMemoryWithContext(ctx)
	s, _ := mem.SwapMemoryWithContext(ctx)
	m := metrics.Memory{}
	sw := metrics.Swap{}
	if v != nil {
		m = metrics.Memory{Total: v.Total, Available: v.Available, Used: v.Used, UsedPercent: v.UsedPercent}
	}
	if s != nil {
		sw = metrics.Swap{Total: s.Total, Used: s.Used, UsedPercent: s.UsedPercent}
	}
	return m, sw
}

func (c *SystemCollector) CollectDisks(ctx context.Context) []metrics.Disk {
	parts, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return nil
	}
	out := make([]metrics.Disk, 0, len(parts))
	seen := map[string]bool{}
	for _, p := range parts {
		if seen[p.Mountpoint] {
			continue
		}
		// Skip pseudo filesystems
		if strings.HasPrefix(p.Mountpoint, "/proc") ||
			strings.HasPrefix(p.Mountpoint, "/sys") ||
			strings.HasPrefix(p.Mountpoint, "/run") ||
			strings.HasPrefix(p.Mountpoint, "/dev") ||
			strings.HasPrefix(p.Mountpoint, "/snap") {
			continue
		}
		u, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil || u == nil {
			continue
		}
		seen[p.Mountpoint] = true
		out = append(out, metrics.Disk{
			Device:      p.Device,
			Mountpoint:  p.Mountpoint,
			Fstype:      p.Fstype,
			Total:       u.Total,
			Used:        u.Used,
			Free:        u.Free,
			UsedPercent: u.UsedPercent,
		})
	}
	return out
}

func (c *SystemCollector) CollectNetwork(ctx context.Context) []metrics.Network {
	stats, err := net.IOCountersWithContext(ctx, true)
	if err != nil {
		return nil
	}
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]metrics.Network, 0, len(stats))
	dt := now.Sub(c.lastNetAt).Seconds()
	if c.lastNetAt.IsZero() {
		dt = 0
	}
	curr := make(map[string]net.IOCountersStat, len(stats))
	for _, s := range stats {
		if s.Name == "lo" || strings.HasPrefix(s.Name, "veth") || strings.HasPrefix(s.Name, "docker") || strings.HasPrefix(s.Name, "br-") {
			// keep but de-emphasize? include for completeness
		}
		curr[s.Name] = s
		var sendRate, recvRate uint64
		if dt > 0 {
			if prev, ok := c.lastNet[s.Name]; ok {
				if s.BytesSent >= prev.BytesSent {
					sendRate = uint64(float64(s.BytesSent-prev.BytesSent) / dt)
				}
				if s.BytesRecv >= prev.BytesRecv {
					recvRate = uint64(float64(s.BytesRecv-prev.BytesRecv) / dt)
				}
			}
		}
		out = append(out, metrics.Network{
			Name:        s.Name,
			BytesSent:   s.BytesSent,
			BytesRecv:   s.BytesRecv,
			PacketsSent: s.PacketsSent,
			PacketsRecv: s.PacketsRecv,
			SendRate:    sendRate,
			RecvRate:    recvRate,
		})
	}
	c.lastNet = curr
	c.lastNetAt = now
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (c *SystemCollector) CollectLoad(ctx context.Context) metrics.Load {
	l, err := load.AvgWithContext(ctx)
	if err != nil || l == nil {
		return metrics.Load{}
	}
	return metrics.Load{Load1: l.Load1, Load5: l.Load5, Load15: l.Load15}
}

func (c *SystemCollector) CollectProcesses(ctx context.Context) []metrics.Process {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil
	}
	out := make([]metrics.Process, 0, len(procs))
	for _, p := range procs {
		name, _ := p.NameWithContext(ctx)
		cpuP, _ := p.CPUPercentWithContext(ctx)
		memP, _ := p.MemoryPercentWithContext(ctx)
		mi, _ := p.MemoryInfoWithContext(ctx)
		st, _ := p.StatusWithContext(ctx)
		username, _ := p.UsernameWithContext(ctx)
		nt, _ := p.NumThreadsWithContext(ctx)
		ct, _ := p.CreateTimeWithContext(ctx)
		cmd, _ := p.CmdlineWithContext(ctx)
		var rss uint64
		if mi != nil {
			rss = mi.RSS
		}
		status := ""
		if len(st) > 0 {
			status = strings.Join(st, ",")
		}
		out = append(out, metrics.Process{
			PID:        p.Pid,
			Name:       name,
			User:       username,
			CPUPercent: cpuP,
			MemPercent: memP,
			MemRSS:     rss,
			Status:     status,
			CreateTime: ct,
			NumThreads: nt,
			Command:    cmd,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CPUPercent > out[j].CPUPercent })
	if len(out) > c.topN {
		out = out[:c.topN]
	}
	return out
}
