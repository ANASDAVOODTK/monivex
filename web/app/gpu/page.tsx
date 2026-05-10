'use client';

import { DashboardShell } from '@/components/dashboard-shell';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatPct } from '@/lib/utils';
import { Cpu, Thermometer, Zap, Wind, Activity } from 'lucide-react';

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
      <div className="card card-pad text-center text-sm text-fg-muted">
        No NVIDIA GPU detected (or `nvidia-smi` not available).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">GPU</h1>
        <p className="text-sm text-fg-muted">Per-device utilization, VRAM, temperature and processes.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {gpus.map((g) => (
          <div key={g.index} className="card card-pad">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <Cpu className="size-4 text-emerald-400" />
                  GPU {g.index} · {g.name}
                </div>
                <div className="text-[11px] text-fg-subtle font-mono mt-0.5">{g.uuid}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <Metric icon={<Activity className="size-3.5" />} label="Util" value={formatPct(g.utilization)} />
              <Metric icon={<Thermometer className="size-3.5" />} label="Temp" value={`${g.temperature.toFixed(0)}°C`} accent="red" />
              <Metric icon={<Zap className="size-3.5" />} label="Power" value={`${g.power_draw.toFixed(0)} W`} sub={`/ ${g.power_limit.toFixed(0)} W`} />
              <Metric icon={<Wind className="size-3.5" />} label="Fan" value={`${g.fan_speed.toFixed(0)}%`} />
            </div>
            <div className="space-y-3 mb-5">
              <Gauge label="GPU utilization" value={g.utilization} color="bg-emerald-500" />
              <Gauge
                label="VRAM"
                value={g.memory_used_pct}
                color="bg-violet-500"
                sub={`${formatBytes(g.memory_used)} / ${formatBytes(g.memory_total)}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-fg-muted">
              <div>Graphics clock: <span className="text-fg tabular-nums">{g.graphics_clock} MHz</span></div>
              <div>Memory clock: <span className="text-fg tabular-nums">{g.memory_clock} MHz</span></div>
            </div>
            {g.processes && g.processes.length > 0 && (
              <div className="mt-5">
                <div className="text-xs text-fg-muted uppercase tracking-wider mb-2">Compute processes</div>
                <div className="rounded-md border border-bg-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-bg-subtle/40 text-fg-muted">
                      <tr>
                        <th className="text-left px-3 py-2">PID</th>
                        <th className="text-left px-3 py-2">Process</th>
                        <th className="text-right px-3 py-2">VRAM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.processes.map((p) => (
                        <tr key={p.pid} className="border-t border-bg-border">
                          <td className="px-3 py-2 font-mono">{p.pid}</td>
                          <td className="px-3 py-2">{p.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatBytes(p.memory_used)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: 'red' }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] text-fg-muted uppercase tracking-wider">
        {icon} {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${accent === 'red' ? 'text-accent-red' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-fg-subtle">{sub}</div>}
    </div>
  );
}

function Gauge({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-fg-muted">{label}</span>
        <span className="tabular-nums">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {sub && <div className="text-[11px] text-fg-subtle mt-1">{sub}</div>}
    </div>
  );
}
