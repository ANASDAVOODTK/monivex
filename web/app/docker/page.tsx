'use client';

import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { EmptyState, MetricTile, PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatPct } from '@/lib/utils';
import type { Container } from '@/lib/types';
import { ArrowRight, Container as ContainerIcon, Play } from 'lucide-react';

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
        description="Select a container to open details, live logs, and lifecycle controls."
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {containers.map((c) => (
          <ContainerLinkCard
            key={c.id}
            container={c}
          />
        ))}
      </div>
    </div>
  );
}

function ContainerLinkCard({ container: c }: { container: Container }) {
  const isRunning = c.state === 'running';

  return (
    <Link
      href={`/docker/${encodeURIComponent(c.id)}`}
      className="card card-pad block transition-colors hover:border-accent/40 hover:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.name}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">{c.image}</div>
          <div className="mt-2 text-[11px] text-accent">Open container details</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge state={c.state} />
          <ArrowRight className="size-4 text-fg-subtle" />
        </div>
      </div>

      <div className="mt-3 text-xs leading-5 text-fg-muted">{c.status}</div>

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
    </Link>
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
