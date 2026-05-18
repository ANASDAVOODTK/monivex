package metrics

import "time"

// Snapshot is a full point-in-time picture pushed to clients and persisted.
type Snapshot struct {
	Timestamp time.Time     `json:"timestamp"`
	Host      Host          `json:"host"`
	CPU       CPU           `json:"cpu"`
	Memory    Memory        `json:"memory"`
	Swap      Swap          `json:"swap"`
	Disks     []Disk        `json:"disks"`
	Network   []Network     `json:"network"`
	Load      Load          `json:"load"`
	GPUs      []GPU         `json:"gpus"`
	Processes []Process     `json:"processes"`
	Docker    []Container   `json:"docker"`
	// DockerError is the most recent error from `docker ps` (e.g. "permission
	// denied while trying to connect to the docker API"). Empty when docker
	// is reachable.
	DockerError string        `json:"docker_error,omitempty"`
	Services    []ServiceUnit `json:"services"`
}

type Host struct {
	Hostname        string `json:"hostname"`
	OS              string `json:"os"`
	Platform        string `json:"platform"`
	PlatformVersion string `json:"platform_version"`
	KernelVersion   string `json:"kernel_version"`
	Uptime          uint64 `json:"uptime"`
	BootTime        uint64 `json:"boot_time"`
}

type CPU struct {
	Cores    int       `json:"cores"`
	Threads  int       `json:"threads"`
	Model    string    `json:"model"`
	Overall  float64   `json:"overall"`  // percent
	PerCore  []float64 `json:"per_core"` // percent
}

type Memory struct {
	Total       uint64  `json:"total"`
	Available   uint64  `json:"available"`
	Used        uint64  `json:"used"`
	UsedPercent float64 `json:"used_percent"`
}

type Swap struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	UsedPercent float64 `json:"used_percent"`
}

type Disk struct {
	Device      string  `json:"device"`
	Mountpoint  string  `json:"mountpoint"`
	Fstype      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"used_percent"`
}

type Network struct {
	Name        string `json:"name"`
	BytesSent   uint64 `json:"bytes_sent"`
	BytesRecv   uint64 `json:"bytes_recv"`
	PacketsSent uint64 `json:"packets_sent"`
	PacketsRecv uint64 `json:"packets_recv"`
	// rates over the last sample window
	SendRate uint64 `json:"send_rate"`
	RecvRate uint64 `json:"recv_rate"`
}

type Load struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}

type GPU struct {
	Index            int     `json:"index"`
	Name             string  `json:"name"`
	UUID             string  `json:"uuid"`
	Utilization      float64 `json:"utilization"`       // %
	MemoryTotal      uint64  `json:"memory_total"`      // bytes
	MemoryUsed       uint64  `json:"memory_used"`       // bytes
	MemoryUsedPct    float64 `json:"memory_used_pct"`   // %
	Temperature      float64 `json:"temperature"`       // C
	PowerDraw        float64 `json:"power_draw"`        // W
	PowerLimit       float64 `json:"power_limit"`       // W
	FanSpeed         float64 `json:"fan_speed"`         // %
	GraphicsClockMhz int     `json:"graphics_clock"`    // MHz
	MemoryClockMhz   int     `json:"memory_clock"`      // MHz
	Processes        []GPUProcess `json:"processes"`
}

type GPUProcess struct {
	PID         int    `json:"pid"`
	Name        string `json:"name"`
	MemoryUsed  uint64 `json:"memory_used"`
}

type Process struct {
	PID         int32   `json:"pid"`
	Name        string  `json:"name"`
	User        string  `json:"user"`
	CPUPercent  float64 `json:"cpu_percent"`
	MemPercent  float32 `json:"mem_percent"`
	MemRSS      uint64  `json:"mem_rss"`
	Status      string  `json:"status"`
	CreateTime  int64   `json:"create_time"`
	NumThreads  int32   `json:"num_threads"`
	Command     string  `json:"command"`
}

type Container struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Image    string  `json:"image"`
	State    string  `json:"state"`
	Status   string  `json:"status"`
	Created  int64   `json:"created"`
	CPUPct   float64 `json:"cpu_pct"`
	MemUsage uint64  `json:"mem_usage"`
	MemLimit uint64  `json:"mem_limit"`
	MemPct   float64 `json:"mem_pct"`
	NetRx    uint64  `json:"net_rx"`
	NetTx    uint64  `json:"net_tx"`
}

type ServiceUnit struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	LoadState   string `json:"load_state"`
	ActiveState string `json:"active_state"`
	SubState    string `json:"sub_state"`
}
