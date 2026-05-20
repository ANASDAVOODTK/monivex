'use client';

import { useServerId } from '@/lib/use-server-id';
import { Sparkline } from '@/components/sparkline';
import { HealthRing, InfoPill, MetricTile, ProgressBar, StatusBadge } from '@/components/ui';
import { useServerMetrics } from '@/lib/store';
import { clampPct, formatBytes, formatBytesPerSec, formatPct } from '@/lib/utils';
import {
  Activity,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Server,
  Thermometer,
  Zap,
} from 'lucide-react';

export default function OverviewPage() {
  return <Overview />;
}

function Overview() {
  const serverId = useServerId();
  const { current, history, connected } = useServerMetrics(serverId);

  const cpuSeries = history.map((h) => ({ t: h.t, v: h.cpu }));
  const memSeries = history.map((h) => ({ t: h.t, v: h.mem }));
  const gpuSeries = history.map((h) => ({ t: h.t, v: h.gpu }));
  const netRxSeries = history.map((h) => ({ t: h.t, v: h.netRx }));
  const netTxSeries = history.map((h) => ({ t: h.t, v: h.netTx }));

  const gpu = current?.gpus?.[0];
  const totalNetRx = current?.network?.reduce((a, n) => a + n.recv_rate, 0) ?? 0;
  const totalNetTx = current?.network?.reduce((a, n) => a + n.send_rate, 0) ?? 0;
  const primaryDisk = current?.disks?.find((d) => d.mountpoint === '/') ?? current?.disks?.[0];
  const topProcesses = [...(current?.processes ?? [])]
    .sort((a, b) => b.cpu_percent - a.cpu_percent)
    .slice(0, 5);

  const healthScore = Math.round(
    (100 - clampPct(current?.cpu?.overall ?? 0)) * 0.28 +
      (100 - clampPct(current?.memory?.used_percent ?? 0)) * 0.26 +
      (100 - clampPct(primaryDisk?.used_percent ?? 0)) * 0.2 +
      (connected ? 100 : 0) * 0.16 +
      (gpu ? 100 - clampPct(gpu.temperature > 0 ? Math.max(0, (gpu.temperature - 35) * 1.6) : 0) : 100) * 0.1,
  );
  const healthTone = healthScore > 78 ? 'green' : healthScore > 58 ? 'amber' : 'rose';

  return (
    <div className="space-y-6">
      <div className="glass-panel overflow-hidden p-5 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-between gap-6">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <InfoPill icon={<Server className="size-3.5" />} label="Node" value={current?.host?.hostname ?? 'pending'} tone="teal" />
                <InfoPill label="Kernel" value={current?.host?.kernel_version ?? 'waiting'} />
                <InfoPill label="Samples" value={history.length} tone={connected ? 'green' : 'rose'} />
              </div>
              <h1 className="text-3xl font-semibold text-fg sm:text-4xl">Operations cockpit</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-muted">
                Real-time host telemetry, workload pressure, and infrastructure signals in one command surface.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
              <HealthRing value={healthScore} label={healthScore > 78 ? 'Stable systems' : healthScore > 58 ? 'Watch closely' : 'Intervention needed'} tone={healthTone} />
              <div className="grid gap-3 sm:grid-cols-3">
                <MicroRead label="CPU pressure" value={formatPct(current?.cpu?.overall ?? 0)} pct={current?.cpu?.overall ?? 0} tone="teal" />
                <MicroRead label="Memory load" value={formatPct(current?.memory?.used_percent ?? 0)} pct={current?.memory?.used_percent ?? 0} tone="blue" />
                <MicroRead label="Disk use" value={primaryDisk ? formatPct(primaryDisk.used_percent) : '-'} pct={primaryDisk?.used_percent ?? 0} tone="amber" />
              </div>
            </div>
          </div>

          <SystemField
            cpu={current?.cpu?.overall ?? 0}
            mem={current?.memory?.used_percent ?? 0}
            disk={primaryDisk?.used_percent ?? 0}
            gpu={gpu?.utilization ?? 0}
            rx={totalNetRx}
            tx={totalNetTx}
            connected={connected}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="CPU"
          value={formatPct(current?.cpu?.overall ?? 0)}
          detail={current?.cpu ? `${current.cpu.cores} cores / ${current.cpu.threads} threads` : 'Awaiting sample'}
          percent={current?.cpu?.overall}
          tone="teal"
          icon={<Cpu className="size-4" />}
        />
        <MetricTile
          label="Memory"
          value={formatPct(current?.memory?.used_percent ?? 0)}
          detail={
            current?.memory
              ? `${formatBytes(current.memory.used)} of ${formatBytes(current.memory.total)}`
              : 'Awaiting sample'
          }
          percent={current?.memory?.used_percent}
          tone="blue"
          icon={<MemoryStick className="size-4" />}
        />
        <MetricTile
          label="Root disk"
          value={primaryDisk ? formatPct(primaryDisk.used_percent) : '-'}
          detail={primaryDisk ? `${formatBytes(primaryDisk.free)} free on ${primaryDisk.mountpoint}` : 'No disk data'}
          percent={primaryDisk?.used_percent}
          tone={primaryDisk && primaryDisk.used_percent > 85 ? 'rose' : 'amber'}
          icon={<HardDrive className="size-4" />}
        />
        <MetricTile
          label="Network"
          value={formatBytesPerSec(totalNetRx)}
          detail={`down ${formatBytesPerSec(totalNetRx)} / up ${formatBytesPerSec(totalNetTx)}`}
          tone="green"
          icon={<Network className="size-4" />}
          footer={<span>Total interfaces: {current?.network?.length ?? 0}</span>}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartPanel title="CPU usage" value={formatPct(current?.cpu?.overall ?? 0)} color="#2dd4bf">
          <Sparkline data={cpuSeries} color="#2dd4bf" height={96} />
        </ChartPanel>
        <ChartPanel title="Memory usage" value={formatPct(current?.memory?.used_percent ?? 0)} color="#60a5fa">
          <Sparkline data={memSeries} color="#60a5fa" height={96} />
        </ChartPanel>
        <ChartPanel title="GPU utilization" value={gpu ? formatPct(gpu.utilization) : 'No GPU'} color="#a78bfa">
          <Sparkline data={gpuSeries} color="#a78bfa" height={96} />
        </ChartPanel>
        <ChartPanel title="Network receive" value={formatBytesPerSec(totalNetRx)} color="#34d399">
          <Sparkline data={netRxSeries} color="#34d399" height={96} domain={['auto', 'auto']} />
        </ChartPanel>
        <ChartPanel title="Network transmit" value={formatBytesPerSec(totalNetTx)} color="#fbbf24">
          <Sparkline data={netTxSeries} color="#fbbf24" height={96} domain={['auto', 'auto']} />
        </ChartPanel>
        <div className="card card-pad">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-fg-muted">Load average</div>
              <div className="mt-2 text-sm text-fg-muted">1, 5, and 15 minute windows</div>
            </div>
            <Gauge className="size-5 text-accent" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 text-center">
            <LoadCol label="1m" value={current?.load?.load1 ?? 0} />
            <LoadCol label="5m" value={current?.load?.load5 ?? 0} />
            <LoadCol label="15m" value={current?.load?.load15 ?? 0} />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="card card-pad">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Workload leaders</h2>
              <p className="mt-1 text-xs text-fg-muted">Highest CPU consumers in the latest sample</p>
            </div>
            <a href={`/servers/${serverId}/processes`} className="text-xs font-medium text-accent hover:text-teal-200">
              Open processes
            </a>
          </div>
          <div className="space-y-3">
            {topProcesses.map((p) => (
              <div key={p.pid} className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.025] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-mono text-fg-muted">pid {p.pid}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{p.command}</div>
                </div>
                <div className="min-w-44">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-fg-muted">CPU</span>
                    <span className="tabular-nums">{formatPct(p.cpu_percent)}</span>
                  </div>
                  <ProgressBar value={p.cpu_percent} tone={p.cpu_percent > 75 ? 'rose' : p.cpu_percent > 45 ? 'amber' : 'teal'} />
                </div>
              </div>
            ))}
            {topProcesses.length === 0 && <div className="py-10 text-center text-sm text-fg-muted">No process data yet.</div>}
          </div>
        </div>

        <div className="card card-pad">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Accelerators</h2>
              <p className="mt-1 text-xs text-fg-muted">GPU thermal, power, and memory posture</p>
            </div>
            <a href={`/servers/${serverId}/gpu`} className="text-xs font-medium text-accent hover:text-teal-200">
              GPU view
            </a>
          </div>
          {current?.gpus && current.gpus.length > 0 ? (
            <div className="space-y-3">
              {current.gpus.map((g) => (
                <div key={g.index} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">GPU {g.index} / {g.name}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{g.uuid}</div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-rose-200">
                      <Thermometer className="size-3.5" />
                      {g.temperature.toFixed(0)} C
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <GaugeLine label="Utilization" value={g.utilization} tone="violet" text={formatPct(g.utilization)} />
                    <GaugeLine label="VRAM" value={g.memory_used_pct} tone="blue" text={`${formatBytes(g.memory_used)} / ${formatBytes(g.memory_total)}`} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1"><Zap className="size-3" />{g.power_draw.toFixed(0)} / {g.power_limit.toFixed(0)} W</span>
                    <span>fan {g.fan_speed.toFixed(0)}%</span>
                    <StatusBadge state="online" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-white/10 text-sm text-fg-muted">
              No GPU telemetry detected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemField({
  cpu,
  mem,
  disk,
  gpu,
  rx,
  tx,
  connected,
}: {
  cpu: number;
  mem: number;
  disk: number;
  gpu: number;
  rx: number;
  tx: number;
  connected: boolean;
}) {
  const nodes = [
    { label: 'CPU', value: cpu, className: 'left-[14%] top-[22%]', tone: 'teal' as const },
    { label: 'MEM', value: mem, className: 'right-[14%] top-[26%]', tone: 'blue' as const },
    { label: 'DISK', value: disk, className: 'left-[18%] bottom-[20%]', tone: 'amber' as const },
    { label: 'GPU', value: gpu, className: 'right-[18%] bottom-[18%]', tone: 'violet' as const },
  ];

  return (
    <div className="relative min-h-[320px] overflow-hidden rounded-lg border border-white/10 bg-[#0b1014]">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="absolute inset-x-8 top-1/2 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
      <div className="absolute inset-y-8 left-1/2 w-px bg-gradient-to-b from-transparent via-accent/45 to-transparent" />
      <div className="absolute left-1/2 top-1/2 grid size-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-accent/30 bg-bg/80 shadow-glow">
        <div className="grid size-20 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
          <Activity className="size-8 text-accent" />
        </div>
      </div>

      {nodes.map((node) => (
        <div key={node.label} className={`absolute ${node.className}`}>
          <div className="w-24 rounded-lg border border-white/10 bg-bg/80 p-2 backdrop-blur">
            <div className="flex items-center justify-between text-[10px] text-fg-muted">
              <span>{node.label}</span>
              <span className="tabular-nums">{formatPct(node.value, 0)}</span>
            </div>
            <ProgressBar value={node.value} tone={node.tone} className="mt-2 h-1.5" />
          </div>
        </div>
      ))}

      <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${connected ? 'bg-emerald-300' : 'bg-rose-300'}`} />
          {connected ? 'stream connected' : 'stream offline'}
        </div>
        <div className="tabular-nums">
          RX {formatBytesPerSec(rx)} / TX {formatBytesPerSec(tx)}
        </div>
      </div>
    </div>
  );
}

function MicroRead({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: 'teal' | 'blue' | 'amber' }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
      <ProgressBar value={pct} tone={tone} className="mt-3 h-1.5" />
    </div>
  );
}

function ChartPanel({ title, value, color, children }: { title: string; value: string; color: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wider text-fg-muted">{title}</div>
        <div className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</div>
      </div>
      {children}
    </div>
  );
}

function LoadCol({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <div className="text-[10px] uppercase text-fg-subtle">{label}</div>
      <div className="mt-2 text-xl font-semibold tabular-nums">{value.toFixed(2)}</div>
    </div>
  );
}

function GaugeLine({ label, value, tone, text }: { label: string; value: number; tone: 'violet' | 'blue'; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular-nums">{text}</span>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}
