'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { EmptyState, Notice, PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import type { NodeApp, NodeAppsResponse } from '@/lib/types';
import { formatBytes, formatDuration } from '@/lib/utils';
import { Loader2, Package, Play, Plus, RefreshCw, RotateCcw, Square, Trash2 } from 'lucide-react';

export default function NodeAppsPage() {
  return <NodeAppsPanel />;
}

function NodeAppsPanel() {
  const params = useParams<{ id: string }>();
  const serverId = (params?.id ?? '') as string;
  const [data, setData] = useState<NodeAppsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!serverId) return;
    setErr(null);
    try {
      const r = await api.nodeApps(serverId);
      setData(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setActionId(key);
    try {
      await fn();
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-fg-muted">
        <div className="glass-panel flex items-center gap-2 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin text-accent" />
          Loading PM2 inventory
        </div>
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <EmptyState
        title="PM2 integration disabled"
        message={<span>Enable <span className="kbd">nodejs.enabled</span> in <span className="kbd">config.yaml</span>.</span>}
        icon={<Package className="size-5" />}
      />
    );
  }

  const pm2 = data.pm2;
  const apps = data.apps ?? [];
  const online = apps.filter((a) => a.status === 'online').length;
  const cpu = apps.reduce((sum, a) => sum + a.cpu, 0);
  const mem = apps.reduce((sum, a) => sum + a.memory, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Node.js"
        title="PM2 applications"
        description={pm2.available ? 'Manage host processes running under the server-monitor user.' : 'PM2 is not available on PATH for this service user.'}
        actions={
          <button type="button" onClick={() => load()} className="btn-secondary">
            <RefreshCw className="size-4" />
            Refresh
          </button>
        }
        stats={
          <>
            <SummaryChip label="Apps" value={apps.length.toString()} />
            <SummaryChip label="Online" value={online.toString()} tone="green" />
            <SummaryChip label="CPU" value={`${cpu.toFixed(1)}%`} />
            <SummaryChip label="Memory" value={formatBytes(mem)} />
            {pm2.version && <SummaryChip label="PM2" value={pm2.version} />}
          </>
        }
      />

      {err && <Notice tone="danger">{err}</Notice>}

      {!pm2.available && (
        <Notice tone="warning">
          {pm2.error || 'PM2 was not detected for this runtime user.'}
        </Notice>
      )}

      {pm2.list_error && <Notice tone="warning">List: {pm2.list_error}</Notice>}

      {pm2.available && pm2.can_start_new && <StartAppForm serverId={serverId} onCreated={() => load()} onError={setErr} />}

      {pm2.available && pm2.can_start_new === false && (
        <Notice>
          Starting new apps requires <span className="kbd">nodejs.allowed_script_prefixes</span> in <span className="kbd">config.yaml</span>.
        </Notice>
      )}

      {pm2.available && (
        <div className="table-wrap">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">CPU</th>
                  <th className="px-4 py-3 text-left">Memory</th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">Script</th>
                  <th className="px-4 py-3 text-left">Uptime</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <AppRow key={a.pm_id} app={a} busy={actionId} onRun={run} serverId={serverId} />
                ))}
                {apps.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-14 text-center text-sm text-fg-muted">
                      No PM2 processes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AppRow({
  app: a,
  busy,
  onRun,
  serverId,
}: {
  app: NodeApp;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => void;
  serverId: string;
}) {
  const b = (suffix: string) => busy === `${a.pm_id}-${suffix}`;
  const online = a.status === 'online';

  return (
    <tr className="table-row">
      <td className="px-4 py-3">
        <div className="font-medium">{a.name}</div>
        <div className="mt-1 font-mono text-[10px] text-fg-subtle">pm_id {a.pm_id}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge state={a.status} />
      </td>
      <td className="px-4 py-3 tabular-nums">
        <div className="flex max-w-36 items-center gap-3">
          <span className="w-12 text-xs">{a.cpu.toFixed(1)}%</span>
          <ProgressBar value={a.cpu} tone={a.cpu > 75 ? 'rose' : a.cpu > 45 ? 'amber' : 'teal'} className="h-1.5 flex-1" />
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums">{formatBytes(a.memory)}</td>
      <td className="hidden max-w-[300px] truncate px-4 py-3 font-mono text-xs text-fg-muted lg:table-cell" title={a.script}>
        {a.script}
      </td>
      <td className="px-4 py-3 text-fg-muted">{a.uptime_ms ? formatDuration(Math.floor(a.uptime_ms / 1000)) : '-'}</td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex flex-wrap justify-end gap-1">
          {!online && (
            <MiniBtn
              title="Start"
              onClick={() => onRun(`${a.pm_id}-start`, () => api.nodeAppStart(serverId, a.pm_id))}
              loading={b('start')}
            >
              <Play className="size-3.5" />
            </MiniBtn>
          )}
          {online && (
            <MiniBtn
              title="Stop"
              onClick={() => onRun(`${a.pm_id}-stop`, () => api.nodeAppStop(serverId, a.pm_id))}
              loading={b('stop')}
            >
              <Square className="size-3.5" />
            </MiniBtn>
          )}
          <MiniBtn
            title="Restart"
            onClick={() => onRun(`${a.pm_id}-restart`, () => api.nodeAppRestart(serverId, a.pm_id))}
            loading={b('restart')}
          >
            <RotateCcw className="size-3.5" />
          </MiniBtn>
          <MiniBtn
            title="Delete from PM2"
            onClick={() => onRun(`${a.pm_id}-delete`, () => api.nodeAppDelete(serverId, a.pm_id))}
            loading={b('delete')}
            danger
          >
            <Trash2 className="size-3.5" />
          </MiniBtn>
        </div>
      </td>
    </tr>
  );
}

function MiniBtn({
  children,
  onClick,
  loading,
  title,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  loading: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={loading}
      onClick={onClick}
      className={`rounded-lg border p-1.5 text-xs transition-colors disabled:opacity-50 ${
        danger
          ? 'border-rose-400/30 text-rose-300 hover:bg-rose-400/10'
          : 'border-bg-border text-fg-muted hover:bg-white/[0.06] hover:text-fg'
      }`}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : children}
    </button>
  );
}

function StartAppForm({
  serverId,
  onCreated,
  onError,
}: {
  serverId: string;
  onCreated: () => void;
  onError: (m: string | null) => void;
}) {
  const [script, setScript] = useState('');
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError(null);
    setLoading(true);
    try {
      await api.nodeAppCreate(serverId, {
        script: script.trim(),
        name: name.trim(),
        cwd: cwd.trim() || undefined,
      });
      setScript('');
      setName('');
      setCwd('');
      onCreated();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="card card-pad space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="size-4 text-accent" />
        Start app
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Script" className="sm:col-span-2">
          <input className="input font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} placeholder="/opt/myapp/server.js" required />
        </Field>
        <Field label="PM2 name">
          <input className="input font-mono text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-api" required />
        </Field>
        <Field label="Working directory">
          <input className="input font-mono text-xs" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/opt/myapp" />
        </Field>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          pm2 start
        </button>
      </div>
    </form>
  );
}

function Field({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function SummaryChip({
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
