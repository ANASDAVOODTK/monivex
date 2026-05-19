'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import type { BackupListing, Deployment, DeploymentEvent, TemplateDefinition } from '@/lib/types';
import {
  ArrowLeft,
  Boxes,
  Clock,
  Database,
  FileArchive,
  HardDrive,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from 'lucide-react';

const SECRET_HINTS = ['password', 'secret', 'token', 'key'];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_HINTS.some((s) => k.includes(s));
}

export default function DeploymentPage() {
  return <DeploymentDetail />;
}

function DeploymentDetail() {
  const routeParams = useParams<{ id: string }>();
  const serverId = (routeParams?.id ?? '') as string;
  const params = useSearchParams();
  const id = params.get('id') ?? '';

  const [dep, setDep] = useState<Deployment | null>(null);
  const [events, setEvents] = useState<DeploymentEvent[]>([]);
  const [backups, setBackups] = useState<BackupListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) {
      setErr('Missing deployment id');
      setLoading(false);
      return;
    }
    setErr(null);
    try {
      const [d, ev, bk] = await Promise.all([
        api.deploymentGet(serverId, id),
        api.deploymentEvents(serverId, id),
        api.deploymentBackups(serverId, id).catch(() => null),
      ]);
      setDep(d);
      setEvents(ev);
      setBackups(bk);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [serverId, id]);

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
        <Link href={`/servers/${encodeURIComponent(serverId)}/templates`} className="btn-ghost inline-flex w-fit items-center gap-2">
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
      <Link href={`/servers/${encodeURIComponent(serverId)}/templates`} className="btn-ghost inline-flex w-fit items-center gap-2">
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
              onClick={() => run('start', () => api.deploymentStart(serverId, dep.id))}
              className="btn-secondary"
            >
              {actionBusy === 'start' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Start
            </button>
          )}
          {isRunning && (
            <button
              disabled={inFlight || actionBusy !== null}
              onClick={() => run('stop', () => api.deploymentStop(serverId, dep.id))}
              className="btn-secondary"
            >
              {actionBusy === 'stop' ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              Stop
            </button>
          )}
          <button
            disabled={inFlight || actionBusy !== null}
            onClick={() => setEditing(true)}
            className="btn-secondary"
          >
            <Pencil className="size-4" />
            Edit configuration
          </button>
          <button
            disabled={inFlight || actionBusy !== null}
            onClick={() => run('update', () => api.deploymentUpdate(serverId, dep.id))}
            className="btn-secondary"
          >
            {actionBusy === 'update' ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Pull & restart
          </button>
          <button
            disabled={inFlight || actionBusy !== null}
            onClick={() => {
              if (confirm(`Delete "${dep.name}"? This removes containers AND volumes.`)) {
                run('delete', () => api.deploymentDelete(serverId, dep.id, true));
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

      <BackupsSection dep={dep} backups={backups} />

      <section className="card card-pad space-y-3">
        <div className="text-sm font-semibold">Workdir</div>
        <div className="font-mono text-xs text-fg-muted break-all">{dep.work_dir}</div>
        <div className="text-[11px] text-fg-subtle">
          Compose file and rendered env live in this directory on the host running server-monitor.
        </div>
      </section>

      {editing && (
        <EditConfigDialog
          serverId={serverId}
          dep={dep}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function BackupsSection({
  dep,
  backups,
}: {
  dep: Deployment;
  backups: BackupListing | null;
}) {
  const cfg = dep.config;
  const enabled = useMemo(() => {
    if (dep.template_id !== 'supabase') return null;
    const v = (cfg.backup_enabled ?? '').toString().trim().toLowerCase();
    if (v === '') return true;
    return v === 'yes' || v === 'true' || v === '1' || v === 'on';
  }, [cfg.backup_enabled, dep.template_id]);

  // Hide entirely for templates that don't expose a backup configuration.
  if (enabled === null) return null;

  const schedule = (cfg.backup_schedule ?? '0 3 * * *').toString();
  const keepDays = (cfg.backup_keep_days ?? '7').toString();
  const dbCount = backups?.db.length ?? 0;
  const fileCount = backups?.files.length ?? 0;

  return (
    <section className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Backups</div>
          <div className="mt-1 text-xs text-fg-muted">
            Postgres dumps + Storage / Studio file volumes are written into the deployment workdir on schedule.
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] ${
            enabled
              ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200'
              : 'border-white/10 bg-white/[0.04] text-fg-muted'
          }`}
        >
          {enabled ? 'Scheduled backups: ON' : 'Scheduled backups: OFF'}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Schedule" value={enabled ? schedule : '—'} mono />
        <Stat label="Retention (days)" value={enabled ? keepDays : '—'} />
        <Stat label="Backup root" value={backups?.root || `${dep.work_dir}/volumes/backup`} mono small />
      </div>

      {!enabled && (
        <Notice>
          <div className="text-xs">
            Backups are currently disabled. Set <span className="font-mono">backup_enabled</span>{' '}
            to <span className="font-mono">yes</span> in the configuration and apply changes to start the sidecars.
          </div>
        </Notice>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <BackupList
          title="Postgres dumps"
          icon={<Database className="size-4 text-accent" />}
          empty={
            enabled
              ? 'No Postgres dumps yet. The first backup runs at the next scheduled tick.'
              : 'Enable scheduled backups to start generating Postgres dumps.'
          }
          files={backups?.db ?? []}
        />
        <BackupList
          title="File volumes"
          icon={<HardDrive className="size-4 text-accent" />}
          empty={
            enabled
              ? 'No file-volume archives yet. Storage + Studio data is tarred on the same schedule.'
              : 'Enable scheduled backups to start archiving Storage + Studio data.'
          }
          files={backups?.files ?? []}
        />
      </div>

      <div className="text-[11px] text-fg-subtle">
        Total: {dbCount} Postgres dump{dbCount === 1 ? '' : 's'} · {fileCount} file archive
        {fileCount === 1 ? '' : 's'}. Files live on the host running this deployment — copy them off-box
        for true disaster recovery.
      </div>
    </section>
  );
}

function BackupList({
  title,
  icon,
  empty,
  files,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  files: { name: string; size: number; mod_time: string }[];
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025]">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs font-semibold">
        {icon}
        <span>{title}</span>
        <span className="ml-auto text-[10px] font-normal text-fg-subtle">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <div className="px-3 py-4 text-[11px] text-fg-subtle">{empty}</div>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {files.map((f) => (
            <li
              key={f.name}
              className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-xs last:border-b-0"
            >
              <FileArchive className="size-3.5 shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px]" title={f.name}>
                  {f.name}
                </div>
                <div className="mt-0.5 text-[10px] text-fg-subtle">
                  {new Date(f.mod_time).toLocaleString()}
                </div>
              </div>
              <span className="font-mono text-[10px] text-fg-muted">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div
        className={`mt-1 break-all ${mono ? 'font-mono' : ''} ${small ? 'text-[11px]' : 'text-sm'} text-fg`}
      >
        {value}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function EditConfigDialog({
  serverId,
  dep,
  onClose,
  onSaved,
}: {
  serverId: string;
  dep: Deployment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [def, setDef] = useState<TemplateDefinition | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({ ...dep.config });
  const [ports, setPorts] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(dep.ports).map(([k, v]) => [k, String(v)])),
  );
  const [restart, setRestart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .templateGet(serverId, dep.template_id)
      .then((d) => {
        if (!cancelled) setDef(d);
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Failed to load template');
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, dep.template_id]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const portsNum: Record<string, number> = {};
      for (const [k, v] of Object.entries(ports)) {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n <= 0 || n > 65535) {
          throw new Error(`Port "${k}" must be between 1 and 65535`);
        }
        portsNum[k] = n;
      }
      await api.deploymentEdit(serverId, dep.id, { config, ports: portsNum, restart });
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 py-8">
      <div className="card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <div className="text-sm font-semibold">Edit configuration</div>
            <div className="text-xs text-fg-muted">{dep.name}</div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadErr && <Notice tone="danger">{loadErr}</Notice>}
          {err && <Notice tone="danger">{err}</Notice>}

          {!def ? (
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin text-accent" />
              Loading template definition
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Fields
                </div>
                <div className="space-y-3">
                  {def.fields
                    .filter((f) => f.type !== 'secret' && f.type !== 'password')
                    .map((f) => (
                      <label key={f.key} className="block space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium">{f.label}</span>
                          <span className="font-mono text-[10px] text-fg-subtle">{f.key}</span>
                        </div>
                        {f.type === 'textarea' ? (
                          <textarea
                            value={config[f.key] ?? ''}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, [f.key]: e.target.value }))
                            }
                            placeholder={f.placeholder || ''}
                            spellCheck={false}
                            className="input min-h-64 w-full resize-y font-mono text-xs leading-relaxed"
                          />
                        ) : (
                          <input
                            type={f.type === 'number' ? 'number' : 'text'}
                            value={config[f.key] ?? ''}
                            onChange={(e) =>
                              setConfig((p) => ({ ...p, [f.key]: e.target.value }))
                            }
                            placeholder={f.placeholder || ''}
                            className="input w-full"
                          />
                        )}
                        {f.description && (
                          <div className="text-[11px] text-fg-subtle">{f.description}</div>
                        )}
                      </label>
                    ))}
                </div>
                <div className="text-[11px] text-fg-subtle">
                  Secrets and passwords are intentionally not editable here. To rotate them, redeploy the template.
                </div>
              </div>

              {(def.ports?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    Host ports
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {def.ports.map((p) => (
                      <label key={p.key} className="space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium">{p.label}</span>
                          <span className="font-mono text-[10px] text-fg-subtle">{p.key}</span>
                        </div>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={ports[p.key] ?? ''}
                          onChange={(e) => setPorts((prev) => ({ ...prev, [p.key]: e.target.value }))}
                          className="input w-full font-mono"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="text-[11px] text-fg-subtle">
                    Changing a host port requires a restart. The new port must not be in use by another deployment.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={restart}
              onChange={(e) => setRestart(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/5 text-accent focus:ring-accent"
            />
            Restart containers to apply changes
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-ghost" disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !def}
              className="btn-primary"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
