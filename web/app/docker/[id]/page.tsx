'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { EmptyState, MetricTile, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatPct } from '@/lib/utils';
import { ArrowLeft, Container as ContainerIcon, Loader2, Logs, Play, RotateCcw, Square, Terminal } from 'lucide-react';
import DockerExecTerminal from '../terminal';
import DockerLogsTerminal from '../logs-terminal';

type ExecShell = 'auto' | 'bash' | 'sh';

export default function DockerContainerPage() {
  return (
    <DashboardShell>
      <DockerContainerDetails />
    </DashboardShell>
  );
}

function DockerContainerDetails() {
  const params = useParams<{ id: string }>();
  const containerId = typeof params.id === 'string' ? params.id : '';
  const containers = useMetrics((s) => s.current?.docker);
  const container = useMemo(() => (containers ?? []).find((c) => c.id === containerId) ?? null, [containers, containerId]);

  const [loading, setLoading] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showShell, setShowShell] = useState(false);
  const [execShell, setExecShell] = useState<ExecShell>('auto');

  const runAction = useCallback(
    async (action: 'start' | 'stop' | 'restart') => {
      setLoading(action);
      setError(null);
      try {
        if (action === 'start') await api.dockerStart(containerId);
        else if (action === 'stop') await api.dockerStop(containerId);
        else await api.dockerRestart(containerId);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Action failed');
      } finally {
        setLoading(null);
      }
    },
    [containerId],
  );

  if (!container) {
    return (
      <div className="space-y-4">
        <Link href="/docker" className="btn-ghost inline-flex w-fit items-center gap-2">
          <ArrowLeft className="size-4" />
          Back to containers
        </Link>
        <EmptyState
          title="Container not found"
          message="This container is not in the current snapshot. Return to the list and pick an active container."
          icon={<ContainerIcon className="size-5" />}
        />
      </div>
    );
  }

  const isRunning = container.state === 'running';

  return (
    <div className="space-y-6">
      <Link href="/docker" className="btn-ghost inline-flex w-fit items-center gap-2">
        <ArrowLeft className="size-4" />
        Back to containers
      </Link>

      <PageHeader
        eyebrow="Docker Container"
        title={container.name}
        description={container.image}
        stats={
          <>
            <StatusBadge state={container.state} />
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs text-fg-muted">
              id {container.id}
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricTile label="CPU" value={formatPct(container.cpu_pct)} percent={Math.min(100, container.cpu_pct)} tone={container.cpu_pct > 75 ? 'rose' : container.cpu_pct > 45 ? 'amber' : 'teal'} icon={<ContainerIcon className="size-4" />} />
        <MetricTile label="Memory" value={formatPct(container.mem_pct)} percent={container.mem_pct} tone="blue" icon={<ContainerIcon className="size-4" />} />
        <MetricTile label="Network I/O" value={`${formatBytes(container.net_rx)} / ${formatBytes(container.net_tx)}`} tone="teal" icon={<ContainerIcon className="size-4" />} />
      </div>

      <div className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {!isRunning && (
            <ActionButton
              icon={<Play className="size-4" />}
              label="Start"
              loading={loading === 'start'}
              onClick={() => runAction('start')}
              className="btn-secondary"
            />
          )}
          {isRunning && (
            <ActionButton
              icon={<Square className="size-4" />}
              label="Stop"
              loading={loading === 'stop'}
              onClick={() => runAction('stop')}
              className="btn-secondary"
            />
          )}
          <ActionButton
            icon={<RotateCcw className="size-4" />}
            label="Restart"
            loading={loading === 'restart'}
            onClick={() => runAction('restart')}
            className="btn-secondary"
          />
          <button
            onClick={() => {
              setExecShell('auto');
              setShowShell((v) => !v);
            }}
            disabled={!isRunning}
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            title={!isRunning ? 'Shell requires running container' : 'Toggle shell'}
          >
            <Terminal className="size-4" />
            {showShell ? 'Hide shell' : 'Open shell'}
          </button>
        </div>
        <div className="text-xs text-fg-muted">{container.status}</div>
        {error && <Notice tone="danger">{error}</Notice>}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-bg-border bg-white/[0.035] px-4 py-3 text-sm">
          <Logs className="size-4 text-accent" />
          <span className="font-medium">Live logs</span>
          <span className="font-mono text-xs text-fg-muted">{container.name}</span>
        </div>
        <DockerLogsTerminal key={container.id} containerId={container.id} />
      </div>

      {showShell && isRunning && (
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-bg-border bg-white/[0.035] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Terminal className="size-4 shrink-0 text-accent" />
              <span className="font-medium">Container shell</span>
              <span className="truncate font-mono text-xs text-fg-muted">{container.name}</span>
            </div>
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
          </div>
          <DockerExecTerminal
            key={`${container.id}-${execShell}`}
            containerId={container.id}
            shell={execShell}
            onClose={() => setShowShell(false)}
          />
        </div>
      )}
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
  icon: ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button onClick={onClick} disabled={loading} className={`${className} disabled:opacity-50`}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}
