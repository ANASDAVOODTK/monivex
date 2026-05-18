package collectors

import (
	"context"
	"os/user"
	"runtime"
	"sort"
	"strconv"
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

	// Static info captured once at startup — hostname/OS/CPU model/cores/threads
	// don't change at runtime, so re-reading /proc/cpuinfo and the host info
	// every second was pure waste.
	hostStatic metrics.Host
	cpuStatic  cpuStaticInfo
}

type cpuStaticInfo struct {
	Model   string
	Cores   int
	Threads int
}

func NewSystemCollector(topN int) *SystemCollector {
	if topN <= 0 {
		topN = 50
	}
	c := &SystemCollector{topN: topN}
	c.initStatic()
	return c
}

func (c *SystemCollector) initStatic() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if info, err := host.InfoWithContext(ctx); err == nil && info != nil {
		c.hostStatic = metrics.Host{
			Hostname:        info.Hostname,
			OS:              info.OS,
			Platform:        info.Platform,
			PlatformVersion: info.PlatformVersion,
			KernelVersion:   info.KernelVersion,
			BootTime:        info.BootTime,
		}
	} else {
		c.hostStatic = metrics.Host{Hostname: "unknown", OS: runtime.GOOS}
	}
	if infos, err := cpu.InfoWithContext(ctx); err == nil && len(infos) > 0 {
		c.cpuStatic.Model = strings.TrimSpace(infos[0].ModelName)
		cores := 0
		for _, i := range infos {
			cores += int(i.Cores)
		}
		c.cpuStatic.Cores = cores
	}
	if threads, err := cpu.CountsWithContext(ctx, true); err == nil {
		c.cpuStatic.Threads = threads
	}
}

func (c *SystemCollector) CollectHost(ctx context.Context) metrics.Host {
	h := c.hostStatic
	if h.BootTime > 0 {
		now := uint64(time.Now().Unix())
		if now > h.BootTime {
			h.Uptime = now - h.BootTime
		}
	}
	return h
}

func (c *SystemCollector) CollectCPU(ctx context.Context) metrics.CPU {
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
		Cores:   c.cpuStatic.Cores,
		Threads: c.cpuStatic.Threads,
		Model:   c.cpuStatic.Model,
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

// CollectProcesses uses two passes to avoid expensive /proc reads on the
// hundreds of processes we end up discarding anyway:
//
//   Pass 1 (all processes): cheap fields only — Name, CPUPercent, MemoryInfo —
//     enough to sort by CPU and identify the row.
//   Pass 2 (top-N survivors): the expensive stuff — Cmdline, Username,
//     Status, CreateTime, NumThreads.
//
// Username lookups are deduplicated by UID within a single snapshot so
// getpwuid (which can hit NSS/LDAP/SSSD) runs once per distinct user, not
// once per process.
func (c *SystemCollector) CollectProcesses(ctx context.Context) []metrics.Process {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil
	}

	// Total memory is needed to compute MemPercent without paying for
	// gopsutil's per-process MemoryPercent() (which re-reads VirtualMemory
	// for every process).
	var totalMem uint64
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil && vm != nil {
		totalMem = vm.Total
	}

	type entry struct {
		p      *process.Process
		name   string
		cpuPct float64
		memRSS uint64
	}
	entries := make([]entry, 0, len(procs))
	for _, p := range procs {
		cpuP, _ := p.CPUPercentWithContext(ctx)
		mi, _ := p.MemoryInfoWithContext(ctx)
		name, _ := p.NameWithContext(ctx)
		var rss uint64
		if mi != nil {
			rss = mi.RSS
		}
		entries = append(entries, entry{p: p, name: name, cpuPct: cpuP, memRSS: rss})
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].cpuPct > entries[j].cpuPct })
	if len(entries) > c.topN {
		entries = entries[:c.topN]
	}

	userCache := map[uint32]string{}
	out := make([]metrics.Process, 0, len(entries))
	for _, e := range entries {
		p := e.p
		st, _ := p.StatusWithContext(ctx)
		nt, _ := p.NumThreadsWithContext(ctx)
		ct, _ := p.CreateTimeWithContext(ctx)
		cmd, _ := p.CmdlineWithContext(ctx)

		// UID→username cache. On platforms where Uids() isn't supported
		// (Windows), fall back to gopsutil's Username().
		username := ""
		if uids, err := p.UidsWithContext(ctx); err == nil && len(uids) > 0 {
			uid := uids[0]
			if u, ok := userCache[uid]; ok {
				username = u
			} else {
				if uobj, err := user.LookupId(strconv.Itoa(int(uid))); err == nil {
					username = uobj.Username
				}
				userCache[uid] = username
			}
		} else {
			username, _ = p.UsernameWithContext(ctx)
		}

		var memPct float32
		if totalMem > 0 {
			memPct = float32(float64(e.memRSS) / float64(totalMem) * 100)
		}

		status := ""
		if len(st) > 0 {
			status = strings.Join(st, ",")
		}
		out = append(out, metrics.Process{
			PID:        p.Pid,
			Name:       e.name,
			User:       username,
			CPUPercent: e.cpuPct,
			MemPercent: memPct,
			MemRSS:     e.memRSS,
			Status:     status,
			CreateTime: ct,
			NumThreads: nt,
			Command:    cmd,
		})
	}
	return out
}
