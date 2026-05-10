package collectors

import (
	"context"
	"encoding/csv"
	"os/exec"
	"strconv"
	"strings"

	"github.com/yourname/server-monitor/internal/metrics"
)

// GPUCollector reads NVIDIA GPU stats by parsing `nvidia-smi --query-gpu`.
// This avoids CGO dependencies and the NVML headers; works on all driver
// versions that ship `nvidia-smi`.
type GPUCollector struct {
	enabled bool
	bin     string
}

func NewGPUCollector(enabled bool) *GPUCollector {
	c := &GPUCollector{enabled: enabled, bin: "nvidia-smi"}
	if !enabled {
		return c
	}
	if _, err := exec.LookPath("nvidia-smi"); err != nil {
		c.enabled = false
	}
	return c
}

func (c *GPUCollector) Available() bool { return c.enabled }

func (c *GPUCollector) Collect(ctx context.Context) []metrics.GPU {
	if !c.enabled {
		return nil
	}
	gpus := c.queryGPU(ctx)
	if len(gpus) == 0 {
		return nil
	}
	procs := c.queryProcesses(ctx)
	for i := range gpus {
		gpus[i].Processes = procs[gpus[i].Index]
	}
	return gpus
}

func (c *GPUCollector) queryGPU(ctx context.Context) []metrics.GPU {
	args := []string{
		"--query-gpu=index,name,uuid,utilization.gpu,memory.total,memory.used,temperature.gpu,power.draw,power.limit,fan.speed,clocks.gr,clocks.mem",
		"--format=csv,noheader,nounits",
	}
	out, err := exec.CommandContext(ctx, c.bin, args...).Output()
	if err != nil {
		return nil
	}
	r := csv.NewReader(strings.NewReader(string(out)))
	r.TrimLeadingSpace = true
	rows, err := r.ReadAll()
	if err != nil {
		return nil
	}
	gpus := make([]metrics.GPU, 0, len(rows))
	for _, row := range rows {
		if len(row) < 12 {
			continue
		}
		idx := atoi(row[0])
		memTotalMB := atof(row[4])
		memUsedMB := atof(row[5])
		memTotal := uint64(memTotalMB * 1024 * 1024)
		memUsed := uint64(memUsedMB * 1024 * 1024)
		var memPct float64
		if memTotal > 0 {
			memPct = float64(memUsed) / float64(memTotal) * 100
		}
		gpus = append(gpus, metrics.GPU{
			Index:            idx,
			Name:             strings.TrimSpace(row[1]),
			UUID:             strings.TrimSpace(row[2]),
			Utilization:      atof(row[3]),
			MemoryTotal:      memTotal,
			MemoryUsed:       memUsed,
			MemoryUsedPct:    memPct,
			Temperature:      atof(row[6]),
			PowerDraw:        atof(row[7]),
			PowerLimit:       atof(row[8]),
			FanSpeed:         atof(row[9]),
			GraphicsClockMhz: atoi(row[10]),
			MemoryClockMhz:   atoi(row[11]),
		})
	}
	return gpus
}

func (c *GPUCollector) queryProcesses(ctx context.Context) map[int][]metrics.GPUProcess {
	args := []string{
		"--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
		"--format=csv,noheader,nounits",
	}
	out, err := exec.CommandContext(ctx, c.bin, args...).Output()
	if err != nil {
		return nil
	}
	// We need uuid -> index. Re-query short list.
	idxByUUID := map[string]int{}
	idxArgs := []string{"--query-gpu=index,uuid", "--format=csv,noheader"}
	if iout, err := exec.CommandContext(ctx, c.bin, idxArgs...).Output(); err == nil {
		r := csv.NewReader(strings.NewReader(string(iout)))
		r.TrimLeadingSpace = true
		rows, _ := r.ReadAll()
		for _, row := range rows {
			if len(row) >= 2 {
				idxByUUID[strings.TrimSpace(row[1])] = atoi(row[0])
			}
		}
	}
	r := csv.NewReader(strings.NewReader(string(out)))
	r.TrimLeadingSpace = true
	rows, err := r.ReadAll()
	if err != nil {
		return nil
	}
	res := map[int][]metrics.GPUProcess{}
	for _, row := range rows {
		if len(row) < 4 {
			continue
		}
		uuid := strings.TrimSpace(row[0])
		idx, ok := idxByUUID[uuid]
		if !ok {
			continue
		}
		memMB := atof(row[3])
		res[idx] = append(res[idx], metrics.GPUProcess{
			PID:        atoi(row[1]),
			Name:       strings.TrimSpace(row[2]),
			MemoryUsed: uint64(memMB * 1024 * 1024),
		})
	}
	return res
}

func atoi(s string) int {
	v, _ := strconv.Atoi(strings.TrimSpace(s))
	return v
}

func atof(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "[N/A]" || s == "N/A" {
		return 0
	}
	v, _ := strconv.ParseFloat(s, 64)
	return v
}
