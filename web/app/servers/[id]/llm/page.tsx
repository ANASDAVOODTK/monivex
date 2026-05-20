'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { EmptyState, Notice, PageHeader, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import type { DeploymentSummary, TemplateEngineStatus } from '@/lib/types';
import { Bot, Loader2, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';

export default function LlmPage() {
  return <LlmPanel />;
}

function LlmPanel() {
  const params = useParams<{ id: string }>();
  const serverId = (params?.id ?? '') as string;
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [engine, setEngine] = useState<TemplateEngineStatus | null>(null);
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
      setEngine(catalog.engine);
      setDeployments(deps.filter((d) => d.template_id === 'vllm'));
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
          Loading models
        </div>
      </div>
    );
  }

  const running = deployments.filter((d) => d.status === 'running').length;
  const deployHref = `/servers/${encodeURIComponent(serverId)}/llm/deploy`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="LLM Models"
        title="vLLM inference"
        description="Deploy HuggingFace models behind an OpenAI-compatible API. Pick a model from the recipe catalog and the launch settings pre-fill automatically."
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={refresh} className="btn-secondary">
              <RefreshCw className="size-4" />
              Refresh
            </button>
            <Link href={deployHref} className="btn-primary">
              <Plus className="size-4" />
              Deploy a model
            </Link>
          </div>
        }
        stats={
          <>
            <Chip label="Models" value={deployments.length.toString()} />
            <Chip label="Running" value={running.toString()} tone="green" />
            {engine?.version && <Chip label="Compose" value={engine.version} />}
          </>
        }
      />

      {err && <Notice tone="danger">{err}</Notice>}

      {engine && !engine.available && (
        <Notice tone="warning">
          Docker Compose is not available on this host. Install Docker with the compose plugin to deploy models. {engine.error}
        </Notice>
      )}

      <Notice>
        <div className="text-xs">
          Models need an NVIDIA GPU with the container toolkit installed. Each deployment is an isolated
          Docker Compose project — weights are cached on the host so restarts are fast.
        </div>
      </Notice>

      {deployments.length === 0 ? (
        <EmptyState
          title="No models deployed"
          message="Deploy your first LLM — choose from the vLLM recipe catalog and the GPU / serving settings fill in for you."
          icon={<Bot className="size-5" />}
          action={
            <Link href={deployHref} className="btn-primary">
              <Plus className="size-4" />
              Deploy a model
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">API port</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <ModelRow key={d.id} serverId={serverId} dep={d} busy={actionId} onRun={run} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({
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
  const port = dep.ports?.vllm;
  return (
    <tr className="table-row">
      <td className="px-4 py-3">
        <Link
          href={`/servers/${encodeURIComponent(serverId)}/templates/deployment?id=${encodeURIComponent(dep.id)}`}
          className="font-medium text-fg hover:text-accent"
        >
          {dep.name}
        </Link>
        <div className="mt-1 font-mono text-[10px] text-fg-subtle">slug {dep.slug}</div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge state={dep.status} />
        {dep.message && (
          <div className="mt-1 max-w-[280px] truncate text-[11px] text-rose-200" title={dep.message}>
            {dep.message}
          </div>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-fg-muted">{port ? `:${port}` : '—'}</td>
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
            danger
            title="Delete model + volumes"
            disabled={inFlight}
            loading={b('delete')}
            onClick={() => {
              if (confirm(`Delete model "${dep.name}"? This removes containers AND cached volumes.`)) {
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
