'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import type { NodeApp, NodeAppsResponse } from '@/lib/types';
import { formatBytes } from '@/lib/utils';
import { Loader2, Play, RefreshCw, RotateCcw, Square, Trash2, Plus } from 'lucide-react';

export default function NodeAppsPage() {
  return (
    <DashboardShell>
      <NodeAppsPanel />
    </DashboardShell>
  );
}

function NodeAppsPanel() {
  const [data, setData] = useState<NodeAppsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.nodeApps();
      setData(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
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
      <div className="flex items-center justify-center py-24 text-fg-muted gap-2">
        <Loader2 className="size-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Node apps (PM2)</h1>
        <div className="card card-pad text-sm text-fg-muted">
          PM2 integration is disabled. Set <span className="font-mono text-xs">nodejs.enabled: true</span> in{' '}
          <span className="font-mono text-xs">config.yaml</span> on the server.
        </div>
      </div>
    );
  }

  const pm2 = data.pm2;
  const apps = data.apps ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Node apps (PM2)</h1>
          <p className="text-sm text-fg-muted">
            {pm2.available
              ? `PM2 ${pm2.version ?? ''} · manage processes on the host where server-monitor runs (same OS user).`
              : 'PM2 is not available on PATH for that user.'}
          </p>
        </div>
        <button type="button" onClick={() => load()} className="btn-secondary inline-flex items-center gap-2 text-sm shrink-0">
          <RefreshCw className="size-4" />
          Refresh
        </button>
      </div>

      {err && (
        <div className="text-sm text-red-400 bg-red-500/10 rounded-md px-3 py-2 border border-red-500/20">{err}</div>
      )}

      {!pm2.available && (
        <div className="card card-pad text-sm text-fg-muted space-y-2">
          <p>{pm2.error || 'PM2 not detected.'}</p>
          <p className="text-xs">
            Install Node.js and PM2 on the server, run <span className="font-mono">pm2 save</span> under the same user as
            server-monitor, or set <span className="font-mono">nodejs.pm2_path</span> in config.
          </p>
        </div>
      )}

      {pm2.list_error && (
        <div className="text-sm text-amber-300 bg-amber-500/10 rounded-md px-3 py-2 border border-amber-500/20">
          List: {pm2.list_error}
        </div>
      )}

      {pm2.available && pm2.can_start_new && <StartAppForm onCreated={() => load()} onError={setErr} />}

      {pm2.available && pm2.can_start_new === false && (
        <div className="text-xs text-fg-muted border border-bg-border rounded-md px-3 py-2 bg-bg-subtle/30">
          Starting new apps from the UI requires <span className="font-mono">nodejs.allowed_script_prefixes</span> in{' '}
          <span className="font-mono">config.yaml</span> (for example <span className="font-mono">/opt/apps</span>). You
          can still stop, restart, and delete existing processes.
        </div>
      )}

      {pm2.available && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle/40 text-xs text-fg-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">CPU</th>
                <th className="text-left px-3 py-2.5">Mem</th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">Script</th>
                <th className="text-right px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <AppRow key={a.pm_id} app={a} busy={actionId} onRun={run} />
              ))}
              {apps.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-fg-muted">
                    No PM2 processes. Use <span className="font-mono">pm2 start</span> or the form above (if enabled).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AppRow({
  app: a,
  busy,
  onRun,
}: {
  app: NodeApp;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<void>) => void;
}) {
  const b = (suffix: string) => busy === `${a.pm_id}-${suffix}`;
  const online = a.status === 'online';

  return (
    <tr className="border-t border-bg-border hover:bg-bg-subtle/30">
      <td className="px-3 py-2">
        <div className="font-medium">{a.name}</div>
        <div className="text-[10px] text-fg-subtle font-mono">pm_id {a.pm_id}</div>
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={a.status} />
      </td>
      <td className="px-3 py-2 tabular-nums">{a.cpu.toFixed(1)}%</td>
      <td className="px-3 py-2 tabular-nums">{formatBytes(a.memory)}</td>
      <td className="px-3 py-2 text-fg-muted text-xs font-mono truncate max-w-[240px] hidden lg:table-cell" title={a.script}>
        {a.script}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex flex-wrap justify-end gap-1">
          {!online && (
            <MiniBtn
              title="Start"
              onClick={() => onRun(`${a.pm_id}-start`, () => api.nodeAppStart(a.pm_id))}
              loading={b('start')}
            >
              <Play className="size-3.5" />
            </MiniBtn>
          )}
          {online && (
            <MiniBtn
              title="Stop"
              onClick={() => onRun(`${a.pm_id}-stop`, () => api.nodeAppStop(a.pm_id))}
              loading={b('stop')}
            >
              <Square className="size-3.5" />
            </MiniBtn>
          )}
          <MiniBtn
            title="Restart"
            onClick={() => onRun(`${a.pm_id}-restart`, () => api.nodeAppRestart(a.pm_id))}
            loading={b('restart')}
          >
            <RotateCcw className="size-3.5" />
          </MiniBtn>
          <MiniBtn
            title="Delete from PM2"
            onClick={() => onRun(`${a.pm_id}-delete`, () => api.nodeAppDelete(a.pm_id))}
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
      className={`p-1.5 rounded-md border text-xs transition-colors disabled:opacity-50 ${
        danger
          ? 'border-red-500/30 text-red-300 hover:bg-red-500/10'
          : 'border-bg-border text-fg-muted hover:text-fg hover:bg-bg-subtle'
      }`}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : children}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    online: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    stopped: 'bg-bg-subtle text-fg-muted border border-bg-border',
    stopping: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    launching: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    errored: 'bg-red-500/15 text-red-300 border border-red-500/30',
    one_launch_status: 'bg-bg-subtle text-fg-muted border border-bg-border',
  };
  const cls = map[status] || 'bg-bg-subtle text-fg-muted border border-bg-border';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function StartAppForm({ onCreated, onError }: { onCreated: () => void; onError: (m: string | null) => void }) {
  const [script, setScript] = useState('');
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    onError(null);
    setLoading(true);
    try {
      await api.nodeAppCreate({
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
    <div className="card card-pad">
      <div className="flex items-center gap-2 text-sm font-medium mb-3">
        <Plus className="size-4 text-accent" />
        Start app
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="block text-xs text-fg-muted mb-1">Script (absolute path)</label>
          <input className="input w-full font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} placeholder="/opt/myapp/server.js" required />
        </div>
        <div>
          <label className="block text-xs text-fg-muted mb-1">PM2 name</label>
          <input className="input w-full font-mono text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-api" required />
        </div>
        <div>
          <label className="block text-xs text-fg-muted mb-1">Working directory (optional)</label>
          <input className="input w-full font-mono text-xs" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/opt/myapp" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
          <button type="submit" disabled={loading} className="btn-primary text-sm inline-flex items-center gap-2">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            pm2 start
          </button>
        </div>
      </form>
    </div>
  );
}
