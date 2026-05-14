'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import type { Deployment, DeploymentEvent } from '@/lib/types';
import {
  ArrowLeft,
  Boxes,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';

const SECRET_HINTS = ['password', 'secret', 'token', 'key'];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_HINTS.some((s) => k.includes(s));
}

export default function DeploymentPage() {
  return (
    <DashboardShell>
      <DeploymentDetail />
    </DashboardShell>
  );
}

function DeploymentDetail() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';

  const [dep, setDep] = useState<Deployment | null>(null);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    if (!id) {
      setErr('Missing deployment id');
      setLoading(false);
      return;
    }
    setErr(null);
    try {
      const [d, ev] = await Promise.all([
        api.deploymentGet(id),
        api.deploymentEvents(id),
      ]);
      setDep(d);
      setEvents(ev);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setActionBusy(key);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-fg-muted">
        <div className="glass-panel flex items-center gap-2 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin text-accent" />
          Loading deployment
        </div>
      </div>
    );
  }

  if (!dep) {
    return (
      <div className="space-y-4">
        <Link href="/templates" className="btn-ghost inline-flex w-fit items-center gap-2">
          <ArrowLeft className="size-4" />
          Back to templates
        </Link>
        <EmptyState
          title="Deployment not found"
          message={err || 'This deployment may have been removed.'}
          icon={<Boxes className="size-5" />}
        />
      </div>
    );
  }

  const isRunning = dep.status === 'running';
  const inFlight = ['deploying', 'starting', 'stopping', 'updating', 'deleting'].includes(dep.status);

  return (
    <div className="space-y-6">
      <Link href="/templates" className="btn-ghost inline-flex w-fit items-center gap-2">
        <ArrowLeft className="size-4" />
        Back to templates
      </Link>

      <PageHeader
        eyebrow={`Template: ${dep.template_id}`}
        title={dep.name}
        description={
          <>
            <span className="font-mono text-xs">slug {dep.slug}</span>
            <span className="ml-3 font-mono text-xs">id {dep.id}</span>
          </>
        }
        actions={
          <button type="button" onClick={refresh} className="btn-secondary">
            <RefreshCw className="size-4" />
            Refresh
          </button>
        }
        stats={
          <>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
              <StatusBadge state={dep.status} />
            </span>
            {Object.entries(dep.ports).map(([k, v]) => (
              <span key={k} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
                <span className="text-fg-muted">{k}</span>
                <span className="ml-2 font-mono font-medium text-fg">:{v}</span>
              </span>
            ))}
          </>
        }
      />

      {err && <Notice tone="danger">{err}</Notice>}

      {dep.message && (
        <Notice tone={dep.status === 'failed' ? 'danger' : 'warning'}>
          <span className="font-mono text-xs">{dep.message}</span>
        </Notice>
      )}

      <section className="card card-pad space-y-3">
        <div className="text-sm font-semibold">Actions</div>
        <div className="flex flex-wrap gap-2">
          {!isRunning && (
            <button
              disabled={inFlight || actionBusy !== null}
              onClick={() => run('start', () => api.deploymentStart(dep.id))}
              className="btn-secondary"
            >
              {actionBusy === 'start' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Start
            </button>
          )}
          {isRunning && (
            <button
              disabled={inFlight || actionBusy !== null}
              onClick={() => run('stop', () => api.deploymentStop(dep.id))}
              className="btn-secondary"
            >
              {actionBusy === 'stop' ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              Stop
            </button>
          )}
          <button
            disabled={inFlight || actionBusy !== null}
            onClick={() => run('update', () => api.deploymentUpdate(dep.id))}
            className="btn-secondary"
          >
            {actionBusy === 'update' ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Update
          </button>
          <button
            disabled={inFlight || actionBusy !== null}
            onClick={() => {
              if (confirm(`Delete "${dep.name}"? This removes containers AND volumes.`)) {
                run('delete', () => api.deploymentDelete(dep.id, true));
              }
            }}
            className="btn-ghost text-rose-300 hover:bg-rose-400/10"
          >
            {actionBusy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Delete
          </button>
        </div>
      </section>

      <section className="card card-pad space-y-3">
        <div className="text-sm font-semibold">Configuration</div>
        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(dep.config).map(([k, v]) => {
                const secret = isSecretKey(k);
                const visible = !secret || reveal[k];
                return (
                  <tr key={k} className="border-b border-white/5 last:border-b-0">
                    <td className="w-48 px-3 py-2 font-mono text-xs text-fg-muted">{k}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="break-all">
                          {visible ? v : '••••••••'}
                        </span>
                        {secret && (
                          <button
                            type="button"
                            className="text-[10px] text-accent hover:underline"
                            onClick={() => setReveal((p) => ({ ...p, [k]: !p[k] }))}
                          >
                            {visible ? 'hide' : 'show'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-pad space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Event history</div>
          <div className="text-xs text-fg-muted">{events.length} entries</div>
        </div>
        {events.length === 0 ? (
          <div className="text-xs text-fg-subtle">No events yet.</div>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-xs">
                <Clock className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-accent">{e.kind}</div>
                  <div className="break-all text-fg-muted">{e.message}</div>
                  <div className="mt-1 text-[10px] text-fg-subtle">{new Date(e.created_at).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad space-y-3">
        <div className="text-sm font-semibold">Workdir</div>
        <div className="font-mono text-xs text-fg-muted break-all">{dep.work_dir}</div>
        <div className="text-[11px] text-fg-subtle">
          Compose file and rendered env live in this directory on the host running server-monitor.
        </div>
      </section>
    </div>
  );
}
