'use client';

import { useState, useCallback } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { useMetrics } from '@/lib/store';
import { api } from '@/lib/api';
import { formatBytes, formatPct } from '@/lib/utils';
import type { Container } from '@/lib/types';
import { Play, Square, RotateCcw, Terminal, Loader2, MoreVertical, X } from 'lucide-react';
import DockerExecTerminal from './terminal';

export default function DockerPage() {
  return (
    <DashboardShell>
      <Docker />
    </DashboardShell>
  );
}

type ExecShell = 'auto' | 'bash' | 'sh';

function Docker() {
  const containers = useMetrics((s) => s.current?.docker) ?? [];
  const [execContainer, setExecContainer] = useState<{ id: string; name: string } | null>(null);
  const [execShell, setExecShell] = useState<ExecShell>('auto');

  if (!containers.length && !execContainer) {
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

      {/* Exec terminal overlay */}
      {execContainer && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-bg-border bg-bg-subtle/60">
            <div className="flex flex-wrap items-center gap-2 text-sm min-w-0">
              <Terminal className="size-4 text-accent shrink-0" />
              <span className="font-medium shrink-0">Shell</span>
              <span className="text-fg-muted shrink-0">—</span>
              <span className="text-fg-muted font-mono text-xs truncate">{execContainer.name}</span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted shrink-0">
                <span className="hidden sm:inline">Interpreter</span>
                <select
                  className="input py-1 px-2 text-xs font-mono min-w-[7rem]"
                  value={execShell}
                  onChange={(e) => setExecShell(e.target.value as ExecShell)}
                  aria-label="Container shell"
                  title="If bash never appears, try sh (Alpine). Auto picks bash when installed."
                >
                  <option value="auto">Auto (bash or sh)</option>
                  <option value="bash">Bash</option>
                  <option value="sh">sh only</option>
                </select>
              </label>
            </div>
            <button
              onClick={() => setExecContainer(null)}
              className="btn-ghost p-1.5 rounded-md"
              title="Close terminal"
            >
              <X className="size-4" />
            </button>
          </div>
          <DockerExecTerminal
            key={`${execContainer.id}-${execShell}`}
            containerId={execContainer.id}
            shell={execShell}
            onClose={() => setExecContainer(null)}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {containers.map((c) => (
          <ContainerCard
            key={c.id}
            container={c}
            onExec={() => {
              setExecShell('auto');
              setExecContainer({ id: c.id, name: c.name });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ContainerCard({
  container: c,
  onExec,
}: {
  container: Container;
  onExec: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAction = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      setLoading(action);
      setError(null);
      setMenuOpen(false);
      try {
        if (action === 'start') await api.dockerStart(c.id);
        else if (action === 'stop') await api.dockerStop(c.id);
        else if (action === 'restart') await api.dockerRestart(c.id);
      } catch (e: any) {
        setError(e.message || 'Action failed');
      } finally {
        setLoading(null);
      }
    },
    [c.id],
  );

  const isRunning = c.state === 'running';

  return (
    <div className="card card-pad relative group">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{c.name}</div>
          <div className="text-[11px] text-fg-subtle font-mono truncate">{c.image}</div>
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <StateBadge state={c.state} />
          {/* Actions menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-bg-subtle transition-colors"
              title="Actions"
            >
              <MoreVertical className="size-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg bg-bg-panel border border-bg-border shadow-lg py-1 animate-in fade-in slide-in-from-top-1">
                  {!isRunning && (
                    <ActionButton
                      icon={<Play className="size-3.5" />}
                      label="Start"
                      loading={loading === 'start'}
                      onClick={() => runAction('start')}
                      className="text-emerald-400 hover:bg-emerald-500/10"
                    />
                  )}
                  {isRunning && (
                    <ActionButton
                      icon={<Square className="size-3.5" />}
                      label="Stop"
                      loading={loading === 'stop'}
                      onClick={() => runAction('stop')}
                      className="text-red-400 hover:bg-red-500/10"
                    />
                  )}
                  <ActionButton
                    icon={<RotateCcw className="size-3.5" />}
                    label="Restart"
                    loading={loading === 'restart'}
                    onClick={() => runAction('restart')}
                    className="text-amber-400 hover:bg-amber-500/10"
                  />
                  {isRunning && (
                    <>
                      <div className="my-1 border-t border-bg-border" />
                      <ActionButton
                        icon={<Terminal className="size-3.5" />}
                        label="Open Shell"
                        loading={false}
                        onClick={() => {
                          setMenuOpen(false);
                          onExec();
                        }}
                        className="text-accent hover:bg-accent/10"
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="mt-3 text-xs text-fg-muted">{c.status}</div>

      {/* Error message */}
      {error && (
        <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded-md px-2.5 py-1.5 border border-red-500/20">
          {error}
        </div>
      )}

      {/* Stats (only for running containers) */}
      {isRunning && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-fg-muted">CPU</span>
              <span className="tabular-nums">{formatPct(c.cpu_pct)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg-subtle overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-500"
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
                className="h-full bg-violet-500 transition-all duration-500"
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

      {/* Container ID */}
      <div className="mt-3 text-[10px] text-fg-subtle font-mono truncate">id {c.id}</div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  loading,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors disabled:opacity-50 ${className}`}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {label}
    </button>
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
