'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import type {
  DeploymentSummary,
  TemplateDefinition,
  TemplateEngineStatus,
} from '@/lib/types';
import {
  ArrowRight,
  Boxes,
  Database,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';

export default function TemplatesPage() {
  return <TemplatesPanel />;
}

function TemplatesPanel() {
  const params = useParams<{ id: string }>();
  const serverId = (params?.id ?? '') as string;
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [engine, setEngine] = useState<TemplateEngineStatus | null>(null);
  const [storageRoot, setStorageRoot] = useState<string>('');
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!serverId) return;
    setErr(null);
    try {
      const [catalog, deps] = await Promise.all([
        api.templatesCatalog(serverId),
        api.deploymentList(serverId),
      ]);
      setTemplates(catalog.templates);
      setEngine(catalog.engine);
      setStorageRoot(catalog.storage_root || '');
      setDeployments(deps);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setActionId(key);
    try {
      await fn();
      await refresh();
    } catch (e) {
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
          Loading templates
        </div>
      </div>
    );
  }

  // vLLM lives in its own "LLM Models" sidebar tab, so it is excluded from the
  // generic Templates catalog and deployments table here.
  const visibleTemplates = templates.filter((t) => t.id !== 'vllm');
  const visibleDeployments = deployments.filter((d) => d.template_id !== 'vllm');
  const running = visibleDeployments.filter((d) => d.status === 'running').length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Templates"
        title="One-click stacks"
        description="Deploy fully configured services like Supabase as isolated projects. Each deployment ships its own database, compose config and host ports."
        actions={
          <button type="button" onClick={refresh} className="btn-secondary">
            <RefreshCw className="size-4" />
            Refresh
          </button>
        }
        stats={
          <>
            <Chip label="Templates" value={visibleTemplates.length.toString()} />
            <Chip label="Deployments" value={visibleDeployments.length.toString()} />
            <Chip label="Running" value={running.toString()} tone="green" />
            {engine?.version && <Chip label="Compose" value={engine.version} />}
          </>
        }
      />

      {err && <Notice tone="danger">{err}</Notice>}

      {engine && !engine.available && (
        <Notice tone="warning">
          Docker Compose is not available on this host. Install Docker with the compose plugin to deploy templates. {engine.error}
        </Notice>
      )}

      {storageRoot && (
        <Notice>
          <div className="text-xs">
            Deployments are stored under
            <span className="ml-1 font-mono text-fg">{storageRoot}</span>
            . Postgres and storage data live in Docker named volumes namespaced by each deployment slug.
          </div>
        </Notice>
      )}

      <section>
        <div className="mb-3 text-sm font-semibold text-fg">Catalog</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleTemplates.map((t) => (
            <TemplateCard key={t.id} serverId={serverId} template={t} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-fg">Deployments</div>
        </div>
        {visibleDeployments.length === 0 ? (
          <EmptyState
            title="No deployments yet"
            message="Choose a template above to deploy your first isolated project."
            icon={<Boxes className="size-5" />}
          />
        ) : (
          <div className="table-wrap">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="px-4 py-3 text-left">Project</th>
                    <th className="px-4 py-3 text-left">Template</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Ports</th>
                    <th className="px-4 py-3 text-left">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDeployments.map((d) => (
                    <DeploymentRow
                      key={d.id}
                      serverId={serverId}
                      dep={d}
                      busy={actionId}
                      onRun={run}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TemplateCard({ serverId, template }: { serverId: string; template: TemplateDefinition }) {
  return (
    <Link
      href={`/servers/${encodeURIComponent(serverId)}/templates/deploy?template=${encodeURIComponent(template.id)}`}
      className="card card-pad block transition-colors hover:border-accent/40 hover:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
              <Database className="size-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-fg">{template.name}</div>
              <div className="text-[11px] uppercase tracking-wider text-fg-subtle">{template.id}</div>
            </div>
          </div>
          <div className="mt-3 text-sm text-fg-muted">{template.description}</div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-fg-subtle" />
      </div>
    </Link>
  );
}

function DeploymentRow({
  serverId,
  dep,
  busy,
  onRun,
}: {
  serverId: string;
  dep: DeploymentSummary;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => void;
}) {
  const b = (suffix: string) => busy === `${dep.id}-${suffix}`;
  const isRunning = dep.status === 'running';
  const inFlight = ['deploying', 'starting', 'stopping', 'updating', 'deleting'].includes(dep.status);
  return (
    <tr className="table-row">
      <td className="px-4 py-3">
        <Link href={`/servers/${encodeURIComponent(serverId)}/templates/deployment?id=${encodeURIComponent(dep.id)}`} className="font-medium text-fg hover:text-accent">
          {dep.name}
        </Link>
        <div className="mt-1 font-mono text-[10px] text-fg-subtle">slug {dep.slug}</div>
      </td>
      <td className="px-4 py-3 capitalize">{dep.template_id}</td>
      <td className="px-4 py-3">
        <StatusBadge state={dep.status} />
        {dep.message && (
          <div className="mt-1 max-w-[260px] truncate text-[11px] text-rose-200" title={dep.message}>
            {dep.message}
          </div>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-fg-muted">
        {Object.entries(dep.ports).map(([k, v]) => (
          <div key={k}>{k}:{v}</div>
        ))}
      </td>
      <td className="px-4 py-3 text-fg-muted">{new Date(dep.created_at).toLocaleString()}</td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex flex-wrap justify-end gap-1">
          {!isRunning && (
            <Mini
              title="Start"
              disabled={inFlight}
              loading={b('start')}
              onClick={() => onRun(`${dep.id}-start`, () => api.deploymentStart(serverId, dep.id))}
            >
              <Play className="size-3.5" />
            </Mini>
          )}
          {isRunning && (
            <Mini
              title="Stop"
              disabled={inFlight}
              loading={b('stop')}
              onClick={() => onRun(`${dep.id}-stop`, () => api.deploymentStop(serverId, dep.id))}
            >
              <Square className="size-3.5" />
            </Mini>
          )}
          <Mini
            title="Update (pull + recreate)"
            disabled={inFlight}
            loading={b('update')}
            onClick={() => onRun(`${dep.id}-update`, () => api.deploymentUpdate(serverId, dep.id))}
          >
            <RotateCcw className="size-3.5" />
          </Mini>
          <Mini
            danger
            title="Delete deployment + volumes"
            disabled={inFlight}
            loading={b('delete')}
            onClick={() => {
              if (confirm(`Delete deployment "${dep.name}"? This removes containers AND volumes.`)) {
                onRun(`${dep.id}-delete`, () => api.deploymentDelete(serverId, dep.id, true));
              }
            }}
          >
            <Trash2 className="size-3.5" />
          </Mini>
        </div>
      </td>
    </tr>
  );
}

function Mini({
  children,
  onClick,
  loading,
  title,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  loading: boolean;
  title: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={loading || disabled}
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

function Chip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green';
}) {
  const cls =
    tone === 'green' ? 'border-emerald-300/25 bg-emerald-400/10' : 'border-white/10 bg-white/[0.04]';
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs ${cls}`}>
      <span className="text-fg-muted">{label}</span>
      <span className="ml-2 font-medium text-fg">{value}</span>
    </span>
  );
}
