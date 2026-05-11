package hub

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/collectors"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/metrics"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

type Hub struct {
	cfg    *config.Config
	store  *store.Store
	system *collectors.SystemCollector
	gpu    *collectors.GPUCollector
	docker *collectors.DockerCollector
	svcs   *collectors.ServicesCollector

	mu       sync.RWMutex
	last     *metrics.Snapshot
	subs     map[chan *metrics.Snapshot]struct{}

	// caches refreshed less frequently
	servicesCache    []metrics.ServiceUnit
	servicesCachedAt time.Time
}

func New(cfg *config.Config, st *store.Store) *Hub {
	return &Hub{
		cfg:    cfg,
		store:  st,
		system: collectors.NewSystemCollector(cfg.Processes.TopN),
		gpu:    collectors.NewGPUCollector(cfg.GPU.Enabled),
		docker: collectors.NewDockerCollector(cfg.Docker.Enabled, cfg.Docker.Socket),
		svcs:   collectors.NewServicesCollector(),
		subs:   map[chan *metrics.Snapshot]struct{}{},
	}
}

func (h *Hub) Close() {
	h.docker.Close()
}

// Docker returns the underlying Docker collector for management operations.
func (h *Hub) Docker() *collectors.DockerCollector {
	return h.docker
}

func (h *Hub) Last() *metrics.Snapshot {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.last
}

func (h *Hub) Subscribe() chan *metrics.Snapshot {
	ch := make(chan *metrics.Snapshot, 4)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	last := h.last
	h.mu.Unlock()
	if last != nil {
		// non-blocking send of latest
		select {
		case ch <- last:
		default:
		}
	}
	return ch
}

func (h *Hub) Unsubscribe(ch chan *metrics.Snapshot) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *Hub) Run(ctx context.Context) {
	sample := time.Duration(h.cfg.Metrics.SampleInterval) * time.Second
	if sample <= 0 {
		sample = time.Second
	}
	persist := time.Duration(h.cfg.Metrics.PersistInterval) * time.Second
	if persist <= 0 {
		persist = 10 * time.Second
	}

	tick := time.NewTicker(sample)
	defer tick.Stop()
	persistTick := time.NewTicker(persist)
	defer persistTick.Stop()
	pruneTick := time.NewTicker(5 * time.Minute)
	defer pruneTick.Stop()
	rollupTick := time.NewTicker(time.Minute)
	defer rollupTick.Stop()

	// First sample immediately
	h.sample(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			h.sample(ctx)
		case <-persistTick.C:
			h.persist(ctx)
		case <-rollupTick.C:
			h.rollup(ctx)
		case <-pruneTick.C:
			h.prune(ctx)
		}
	}
}

func (h *Hub) sample(ctx context.Context) {
	snap := &metrics.Snapshot{Timestamp: time.Now()}
	snap.Host = h.system.CollectHost(ctx)
	snap.CPU = h.system.CollectCPU(ctx)
	snap.Memory, snap.Swap = h.system.CollectMemory(ctx)
	snap.Disks = h.system.CollectDisks(ctx)
	snap.Network = h.system.CollectNetwork(ctx)
	snap.Load = h.system.CollectLoad(ctx)
	snap.GPUs = h.gpu.Collect(ctx)
	snap.Processes = h.system.CollectProcesses(ctx)
	snap.Docker = h.docker.Collect(ctx)

	// services list refreshed every 10s
	if time.Since(h.servicesCachedAt) > 10*time.Second {
		if list := h.svcs.Collect(ctx); list != nil {
			h.servicesCache = list
			h.servicesCachedAt = time.Now()
		}
	}
	snap.Services = h.servicesCache

	h.mu.Lock()
	h.last = snap
	for ch := range h.subs {
		select {
		case ch <- snap:
		default:
			// slow client; drop
		}
	}
	h.mu.Unlock()
}

func (h *Hub) persist(ctx context.Context) {
	snap := h.Last()
	if snap == nil {
		return
	}
	// Persist a slim version (no processes/services/docker stats which can be huge)
	slim := struct {
		Timestamp time.Time         `json:"timestamp"`
		CPU       metrics.CPU       `json:"cpu"`
		Memory    metrics.Memory    `json:"memory"`
		Swap      metrics.Swap      `json:"swap"`
		Disks     []metrics.Disk    `json:"disks"`
		Network   []metrics.Network `json:"network"`
		Load      metrics.Load      `json:"load"`
		GPUs      []metrics.GPU     `json:"gpus"`
	}{
		Timestamp: snap.Timestamp,
		CPU:       metrics.CPU{Overall: snap.CPU.Overall, Cores: snap.CPU.Cores, Threads: snap.CPU.Threads},
		Memory:    snap.Memory,
		Swap:      snap.Swap,
		Disks:     snap.Disks,
		Network:   snap.Network,
		Load:      snap.Load,
		GPUs:      stripGPUProcs(snap.GPUs),
	}
	if err := h.store.InsertShort(ctx, snap.Timestamp, slim); err != nil {
		log.Printf("persist short: %v", err)
	}
}

func stripGPUProcs(gs []metrics.GPU) []metrics.GPU {
	out := make([]metrics.GPU, len(gs))
	for i, g := range gs {
		g.Processes = nil
		out[i] = g
	}
	return out
}

func (h *Hub) rollup(ctx context.Context) {
	// Aggregate the past minute of metrics_short into a single metrics_long row.
	now := time.Now()
	from := now.Add(-time.Minute)
	rows, err := h.store.QueryRange(ctx, "metrics_short", from, now)
	if err != nil || len(rows) == 0 {
		return
	}
	// Average CPU and memory etc. We just store the latest row to keep it simple
	// but mark the timestamp at the minute boundary.
	tail := rows[len(rows)-1]
	if err := h.store.InsertLong(ctx, now.Truncate(time.Minute), tail.Payload); err != nil {
		log.Printf("rollup: %v", err)
	}
}

func (h *Hub) prune(ctx context.Context) {
	now := time.Now()
	if rs := h.cfg.Metrics.RetentionShort.Std(); rs > 0 {
		_ = h.store.Prune(ctx, "metrics_short", now.Add(-rs))
	}
	if rl := h.cfg.Metrics.RetentionLong.Std(); rl > 0 {
		_ = h.store.Prune(ctx, "metrics_long", now.Add(-rl))
	}
}
