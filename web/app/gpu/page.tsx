'use client';

import { DashboardShell } from '@/components/dashboard-shell';
import { EmptyState, MetricTile, PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatPct } from '@/lib/utils';
import { Activity, Cpu, Gauge, MemoryStick, Thermometer, Wind, Zap } from 'lucide-react';

export default function GPUPage() {
  return (
    <DashboardShell>
      <GPUView />
    </DashboardShell>
  );
}

function GPUView() {
  const current = useMetrics((s) => s.current);
  const gpus = current?.gpus ?? [];

  if (gpus.length === 0) {
    return (
      <EmptyState
        title="No GPU telemetry"
        message="NVIDIA metrics are unavailable on this host."
        icon={<Cpu className="size-5" />}
      />
    );
  }

  const hottest = Math.max(...gpus.map((g) => g.temperature));
  const totalVram = gpus.reduce((sum, g) => sum + g.memory_total, 0);
  const usedVram = gpus.reduce((sum, g) => sum + g.memory_used, 0);
  const avgUtil = gpus.reduce((sum, g) => sum + g.utilization, 0) / gpus.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accelerators"
        title="GPU command"
        description="Utilization, clocks, thermals, power, VRAM, and compute processes."
        stats={
          <>
            <MetricChip label="Devices" value={gpus.length.toString()} />
            <MetricChip label="Avg util" value={formatPct(avgUtil)} />
            <MetricChip label="VRAM" value={`${formatBytes(usedVram)} / ${formatBytes(totalVram)}`} />
            <MetricChip label="Peak temp" value={`${hottest.toFixed(0)} C`} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Fleet utilization" value={formatPct(avgUtil)} percent={avgUtil} tone="violet" icon={<Activity className="size-4" />} />
        <MetricTile label="VRAM pressure" value={formatPct(totalVram ? (usedVram / totalVram) * 100 : 0)} detail={`${formatBytes(usedVram)} used`} percent={totalVram ? (usedVram / totalVram) * 100 : 0} tone="blue" icon={<MemoryStick className="size-4" />} />
        <MetricTile label="Thermal ceiling" value={`${hottest.toFixed(0)} C`} detail="Highest device temperature" percent={Math.min(100, hottest)} tone={hottest > 82 ? 'rose' : hottest > 72 ? 'amber' : 'green'} icon={<Thermometer className="size-4" />} />
        <MetricTile label="Power draw" value={`${gpus.reduce((sum, g) => sum + g.power_draw, 0).toFixed(0)} W`} detail={`${gpus.reduce((sum, g) => sum + g.power_limit, 0).toFixed(0)} W limit`} tone="amber" icon={<Zap className="size-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {gpus.map((g) => (
          <div key={g.index} className="card card-pad overflow-hidden">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Cpu className="size-4 text-accent" />
                  <span className="truncate">GPU {g.index} / {g.name}</span>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{g.uuid}</div>
              </div>
              <StatusBadge state="online" />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric icon={<Gauge className="size-3.5" />} label="Util" value={formatPct(g.utilization)} />
              <Metric icon={<Thermometer className="size-3.5" />} label="Temp" value={`${g.temperature.toFixed(0)} C`} tone={g.temperature > 82 ? 'rose' : 'neutral'} />
              <Metric icon={<Zap className="size-3.5" />} label="Power" value={`${g.power_draw.toFixed(0)} W`} sub={`/ ${g.power_limit.toFixed(0)} W`} />
              <Metric icon={<Wind className="size-3.5" />} label="Fan" value={`${g.fan_speed.toFixed(0)}%`} />
            </div>

            <div className="mt-5 space-y-4">
              <GaugeLine label="GPU utilization" value={g.utilization} tone="violet" text={formatPct(g.utilization)} />
              <GaugeLine
                label="VRAM"
                value={g.memory_used_pct}
                tone="blue"
                text={`${formatBytes(g.memory_used)} / ${formatBytes(g.memory_total)}`}
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-xs text-fg-muted">
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                Graphics clock <span className="block pt-1 text-sm text-fg tabular-nums">{g.graphics_clock} MHz</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                Memory clock <span className="block pt-1 text-sm text-fg tabular-nums">{g.memory_clock} MHz</span>
              </div>
            </div>

            {g.processes && g.processes.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-lg border border-bg-border">
                <table className="w-full text-xs">
                  <thead className="table-head">
                    <tr>
                      <th className="px-3 py-2 text-left">PID</th>
                      <th className="px-3 py-2 text-left">Process</th>
                      <th className="px-3 py-2 text-right">VRAM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.processes.map((p) => (
                      <tr key={p.pid} className="table-row">
                        <td className="px-3 py-2 font-mono text-fg-muted">{p.pid}</td>
                        <td className="px-3 py-2">{p.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatBytes(p.memory_used)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
      <span className="text-fg-muted">{label}</span>
      <span className="ml-2 font-medium text-fg">{value}</span>
    </span>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'rose';
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-fg-muted">
        {icon} {label}
      </div>
      <div className={`mt-2 text-lg font-semibold tabular-nums ${tone === 'rose' ? 'text-rose-300' : 'text-fg'}`}>{value}</div>
      {sub && <div className="text-[11px] text-fg-subtle">{sub}</div>}
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
