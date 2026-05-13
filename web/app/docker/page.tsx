'use client';

import { useCallback, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { EmptyState, MetricTile, Notice, PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { useMetrics } from '@/lib/store';
import { api } from '@/lib/api';
import { formatBytes, formatPct } from '@/lib/utils';
import type { Container } from '@/lib/types';
import { Container as ContainerIcon, Loader2, Logs, MoreVertical, Play, RotateCcw, Square, Terminal, X } from 'lucide-react';
import DockerExecTerminal from './terminal';
import DockerLogsTerminal from './logs-terminal';

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
  const [logsContainer, setLogsContainer] = useState<{ id: string; name: string } | null>(null);
  const [execShell, setExecShell] = useState<ExecShell>('auto');

  if (!containers.length && !execContainer && !logsContainer) {
    return (
      <EmptyState
        title="No containers"
        message="Docker stats are not available from this host."
        icon={<ContainerIcon className="size-5" />}
      />
    );
  }

  const running = containers.filter((c) => c.state === 'running').length;
  const cpu = containers.reduce((sum, c) => sum + (c.cpu_pct || 0), 0);
  const mem = containers.reduce((sum, c) => sum + (c.mem_usage || 0), 0);
  const memLimit = containers.reduce((sum, c) => sum + (c.mem_limit || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Docker"
        title="Container fleet"
        description="Runtime inventory, live resource pressure, and controlled lifecycle actions."
        stats={
          <>
            <MetricChip label="Containers" value={containers.length.toString()} />
            <MetricChip label="Running" value={running.toString()} tone="green" />
            <MetricChip label="CPU sum" value={formatPct(cpu)} />
            <MetricChip label="Memory" value={`${formatBytes(mem)} / ${formatBytes(memLimit)}`} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricTile label="Running" value={`${running}/${containers.length}`} tone="green" icon={<Play className="size-4" />} />
        <MetricTile label="CPU pressure" value={formatPct(cpu)} percent={Math.min(100, cpu)} tone={cpu > 75 ? 'rose' : cpu > 45 ? 'amber' : 'teal'} icon={<ContainerIcon className="size-4" />} />
        <MetricTile label="Memory pressure" value={formatPct(memLimit ? (mem / memLimit) * 100 : 0)} percent={memLimit ? (mem / memLimit) * 100 : 0} tone="blue" icon={<ContainerIcon className="size-4" />} />
      </div>

      {execContainer && (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-bg-border bg-white/[0.035] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Terminal className="size-4 shrink-0 text-accent" />
              <span className="font-medium">Container shell</span>
              <span className="truncate font-mono text-xs text-fg-muted">{execContainer.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input min-w-36 py-1.5 text-xs font-mono"
                value={execShell}
                onChange={(e) => setExecShell(e.target.value as ExecShell)}
                aria-label="Container shell"
              >
                <option value="auto">Auto</option>
                <option value="bash">Bash</option>
                <option value="sh">sh</option>
              </select>
              <button
                onClick={() => setExecContainer(null)}
                className="btn-ghost p-2"
                title="Close terminal"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <DockerExecTerminal
            key={`${execContainer.id}-${execShell}`}
            containerId={execContainer.id}
            shell={execShell}
            onClose={() => setExecContainer(null)}
          />
        </div>
      )}

      {logsContainer && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-bg-border bg-white/[0.035] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Logs className="size-4 shrink-0 text-accent" />
              <span className="font-medium">Live logs</span>
              <span className="truncate font-mono text-xs text-fg-muted">{logsContainer.name}</span>
            </div>
            <button
              onClick={() => setLogsContainer(null)}
              className="btn-ghost p-2"
              title="Close logs"
            >
              <X className="size-4" />
            </button>
          </div>
          <DockerLogsTerminal
            key={logsContainer.id}
            containerId={logsContainer.id}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {containers.map((c) => (
          <ContainerCard
            key={c.id}
            container={c}
            onExec={() => {
              setLogsContainer(null);
              setExecShell('auto');
              setExecContainer({ id: c.id, name: c.name });
            }}
            onLogs={() => {
              setExecContainer(null);
              setLogsContainer({ id: c.id, name: c.name });
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
  onLogs,
}: {
  container: Container;
  onExec: () => void;
  onLogs: () => void;
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
        else await api.dockerRestart(c.id);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setLoading(null);
      }
    },
    [c.id],
  );

  const isRunning = c.state === 'running';

  return (
    <div className="card card-pad relative">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.name}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{c.image}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge state={c.state} />
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-white/[0.06] hover:text-fg"
              title="Actions"
            >
              <MoreVertical className="size-4" />
            </button>
            {menuOpen && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border border-white/10 bg-bg-panel py-1 shadow-card">
                  {!isRunning && (
                    <ActionButton
                      icon={<Play className="size-3.5" />}
                      label="Start"
                      loading={loading === 'start'}
                      onClick={() => runAction('start')}
                      className="text-emerald-300 hover:bg-emerald-400/10"
                    />
                  )}
                  {isRunning && (
                    <ActionButton
                      icon={<Square className="size-3.5" />}
                      label="Stop"
                      loading={loading === 'stop'}
                      onClick={() => runAction('stop')}
                      className="text-rose-300 hover:bg-rose-400/10"
                    />
                  )}
                  <ActionButton
                    icon={<RotateCcw className="size-3.5" />}
                    label="Restart"
                    loading={loading === 'restart'}
                    onClick={() => runAction('restart')}
                    className="text-amber-300 hover:bg-amber-400/10"
                  />
                  <div className="my-1 border-t border-bg-border" />
                  <ActionButton
                    icon={<Logs className="size-3.5" />}
                    label="Live logs"
                    loading={false}
                    onClick={() => {
                      setMenuOpen(false);
                      onLogs();
                    }}
                    className="text-sky-300 hover:bg-sky-400/10"
                  />
                  {isRunning && (
                    <>
                      <ActionButton
                        icon={<Terminal className="size-3.5" />}
                        label="Open shell"
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

      <div className="mt-3 text-xs leading-5 text-fg-muted">{c.status}</div>

      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {isRunning ? (
        <div className="mt-5 space-y-4">
          <Meter label="CPU" value={c.cpu_pct} text={formatPct(c.cpu_pct)} tone={c.cpu_pct > 75 ? 'rose' : c.cpu_pct > 45 ? 'amber' : 'teal'} />
          <Meter
            label="Memory"
            value={c.mem_pct}
            text={`${formatBytes(c.mem_usage)} / ${formatBytes(c.mem_limit)}`}
            tone="blue"
          />
          <div className="grid grid-cols-2 gap-3 text-xs text-fg-muted">
            <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">RX <span className="block pt-1 text-fg">{formatBytes(c.net_rx)}</span></div>
            <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">TX <span className="block pt-1 text-fg">{formatBytes(c.net_tx)}</span></div>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-white/10 p-4 text-sm text-fg-muted">
          Container is not running.
        </div>
      )}

      <div className="mt-4 truncate font-mono text-[10px] text-fg-subtle">id {c.id}</div>
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
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors disabled:opacity-50 ${className}`}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function Meter({
  label,
  value,
  text,
  tone,
}: {
  label: string;
  value: number;
  text: string;
  tone: 'teal' | 'blue' | 'amber' | 'rose';
}) {
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

function MetricChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green';
}) {
  const cls = tone === 'green' ? 'border-emerald-300/25 bg-emerald-400/10' : 'border-white/10 bg-white/[0.04]';

  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs ${cls}`}>
      <span className="text-fg-muted">{label}</span>
      <span className="ml-2 font-medium text-fg">{value}</span>
    </span>
  );
}
