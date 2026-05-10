'use client';

import { DashboardShell } from '@/components/dashboard-shell';
import { StatCard } from '@/components/stat-card';
import { Sparkline } from '@/components/sparkline';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatBytesPerSec, formatPct } from '@/lib/utils';
import { Cpu, MemoryStick, HardDrive, Network, Zap, Thermometer } from 'lucide-react';

export default function OverviewPage() {
  return (
    <DashboardShell>
      <Overview />
    </DashboardShell>
  );
}

function Overview() {
  const current = useMetrics((s) => s.current);
  const history = useMetrics((s) => s.history);

  const cpuSeries = history.map((h) => ({ t: h.t, v: h.cpu }));
  const memSeries = history.map((h) => ({ t: h.t, v: h.mem }));
  const gpuSeries = history.map((h) => ({ t: h.t, v: h.gpu }));
  const netRxSeries = history.map((h) => ({ t: h.t, v: h.netRx }));
  const netTxSeries = history.map((h) => ({ t: h.t, v: h.netTx }));

  const gpu = current?.gpus?.[0];
  const totalNetRx = current?.network?.reduce((a, n) => a + n.recv_rate, 0) ?? 0;
  const totalNetTx = current?.network?.reduce((a, n) => a + n.send_rate, 0) ?? 0;
  const primaryDisk = current?.disks?.find((d) => d.mountpoint === '/') ?? current?.disks?.[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-fg-muted">Live metrics streamed every second.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="CPU"
          value={formatPct(current?.cpu?.overall ?? 0)}
          sub={current?.cpu ? `${current.cpu.cores} cores · ${current.cpu.threads} threads` : '...'}
          percent={current?.cpu?.overall}
          accent="indigo"
          icon={<Cpu className="size-4" />}
        />
        <StatCard
          label="Memory"
          value={formatPct(current?.memory?.used_percent ?? 0)}
          sub={
            current?.memory
              ? `${formatBytes(current.memory.used)} / ${formatBytes(current.memory.total)}`
              : '...'
          }
          percent={current?.memory?.used_percent}
          accent="violet"
          icon={<MemoryStick className="size-4" />}
        />
        <StatCard
          label="Disk (root)"
          value={primaryDisk ? formatPct(primaryDisk.used_percent) : '-'}
          sub={
            primaryDisk
              ? `${formatBytes(primaryDisk.used)} / ${formatBytes(primaryDisk.total)} · ${primaryDisk.mountpoint}`
              : '...'
          }
          percent={primaryDisk?.used_percent}
          accent="cyan"
          icon={<HardDrive className="size-4" />}
        />
        <StatCard
          label="Network I/O"
          value={`${formatBytesPerSec(totalNetRx)}`}
          sub={`▼ ${formatBytesPerSec(totalNetRx)} · ▲ ${formatBytesPerSec(totalNetTx)}`}
          accent="green"
          icon={<Network className="size-4" />}
        />
      </div>

      {/* Sparklines */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ChartCard title="CPU usage" value={formatPct(current?.cpu?.overall ?? 0)}>
          <Sparkline data={cpuSeries} color="#6366f1" />
        </ChartCard>
        <ChartCard title="Memory usage" value={formatPct(current?.memory?.used_percent ?? 0)}>
          <Sparkline data={memSeries} color="#8b5cf6" />
        </ChartCard>
        <ChartCard
          title="GPU 0 utilization"
          value={gpu ? formatPct(gpu.utilization) : 'No GPU'}
        >
          <Sparkline data={gpuSeries} color="#10b981" />
        </ChartCard>
        <ChartCard title="Network ↓ (rx)" value={formatBytesPerSec(totalNetRx)}>
          <Sparkline data={netRxSeries} color="#06b6d4" domain={['auto', 'auto']} />
        </ChartCard>
        <ChartCard title="Network ↑ (tx)" value={formatBytesPerSec(totalNetTx)}>
          <Sparkline data={netTxSeries} color="#f59e0b" domain={['auto', 'auto']} />
        </ChartCard>
        <div className="card card-pad">
          <div className="text-xs text-fg-muted uppercase tracking-wider">Load average</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <LoadCol label="1m" value={current?.load?.load1 ?? 0} />
            <LoadCol label="5m" value={current?.load?.load5 ?? 0} />
            <LoadCol label="15m" value={current?.load?.load15 ?? 0} />
          </div>
        </div>
      </div>

      {/* GPU summary */}
      {current?.gpus && current.gpus.length > 0 && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">GPUs</h2>
            <a href="/gpu" className="text-xs text-accent hover:underline">Details →</a>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {current.gpus.map((g) => (
              <div key={g.index} className="rounded-lg border border-bg-border bg-bg-subtle/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium">GPU {g.index} · {g.name}</div>
                    <div className="text-[11px] text-fg-subtle font-mono">{g.uuid}</div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-accent-red">
                    <Thermometer className="size-3.5" /> {g.temperature.toFixed(0)}°C
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-fg-muted mb-1">Util</div>
                    <Bar pct={g.utilization} color="bg-emerald-500" />
                    <div className="text-fg mt-1 tabular-nums">{formatPct(g.utilization)}</div>
                  </div>
                  <div>
                    <div className="text-fg-muted mb-1">VRAM</div>
                    <Bar pct={g.memory_used_pct} color="bg-violet-500" />
                    <div className="text-fg mt-1 tabular-nums">
                      {formatBytes(g.memory_used)} / {formatBytes(g.memory_total)}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-muted mb-1 flex items-center gap-1"><Zap className="size-3" />Power</div>
                    <div className="text-fg tabular-nums">{g.power_draw.toFixed(0)} / {g.power_limit.toFixed(0)} W</div>
                  </div>
                  <div>
                    <div className="text-fg-muted mb-1">Fan</div>
                    <div className="text-fg tabular-nums">{g.fan_speed.toFixed(0)}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="flex items-baseline justify-between">
        <div className="text-xs text-fg-muted uppercase tracking-wider">{title}</div>
        <div className="text-sm font-semibold tabular-nums">{value}</div>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function LoadCol({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] text-fg-subtle uppercase">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value.toFixed(2)}</div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}
