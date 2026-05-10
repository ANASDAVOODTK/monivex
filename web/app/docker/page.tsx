'use client';

import { DashboardShell } from '@/components/dashboard-shell';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatPct } from '@/lib/utils';

export default function DockerPage() {
  return (
    <DashboardShell>
      <Docker />
    </DashboardShell>
  );
}

function Docker() {
  const containers = useMetrics((s) => s.current?.docker) ?? [];

  if (!containers.length) {
    return (
      <div className="card card-pad text-center text-sm text-fg-muted">
        No containers found (or Docker socket not accessible).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Docker containers</h1>
        <p className="text-sm text-fg-muted">{containers.length} containers · live stats.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {containers.map((c) => (
          <div key={c.id} className="card card-pad">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="text-[11px] text-fg-subtle font-mono truncate">{c.image}</div>
              </div>
              <StateBadge state={c.state} />
            </div>
            <div className="mt-3 text-xs text-fg-muted">{c.status}</div>
            {c.state === 'running' && (
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-fg-muted">CPU</span>
                    <span className="tabular-nums">{formatPct(c.cpu_pct)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                    <div
                      className="h-full bg-indigo-500"
                      style={{ width: `${Math.min(100, c.cpu_pct)}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-fg-muted">Memory</span>
                    <span className="tabular-nums">{formatBytes(c.mem_usage)} / {formatBytes(c.mem_limit)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden">
                    <div
                      className="h-full bg-violet-500"
                      style={{ width: `${Math.min(100, c.mem_pct)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-fg-muted pt-1">
                  <span>RX {formatBytes(c.net_rx)}</span>
                  <span>TX {formatBytes(c.net_tx)}</span>
                </div>
              </div>
            )}
            <div className="mt-3 text-[10px] text-fg-subtle font-mono truncate">id {c.id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    running: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    exited: 'bg-bg-subtle text-fg-muted border border-bg-border',
    paused: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    dead: 'bg-red-500/15 text-red-300 border border-red-500/30',
    created: 'bg-bg-subtle text-fg-muted border border-bg-border',
    restarting: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  };
  const cls = map[state] || 'bg-bg-subtle text-fg-muted border border-bg-border';
  return <span className={`badge ${cls}`}>{state}</span>;
}
