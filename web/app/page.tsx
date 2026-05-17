'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { api, type ServerSummary } from '@/lib/api';
import {
  Activity,
  ArrowRight,
  Boxes,
  CircleAlert,
  CircleCheck,
  CircleOff,
  Cpu,
  HardDrive,
  Loader2,
  LogOut,
  MemoryStick,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Trash2,
} from 'lucide-react';

function ToneClass(connected: boolean, enabled: boolean) {
  if (!enabled) return 'text-fg-subtle';
  return connected ? 'text-emerald-300' : 'text-rose-300';
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatLastSeen(ts?: number) {
  if (!ts) return 'never';
  const diff = Date.now() / 1000 - ts;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

export default function ServersListPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const status = await api.setupStatus();
        if (status.needs_setup) {
          router.replace('/setup');
          return;
        }
        await api.me();
        setReady(true);
      } catch {
        router.replace('/login');
      }
    })();
  }, [router]);

  if (!ready) {
    return (
      <div className="app-bg flex h-screen items-center justify-center text-sm text-fg-muted">
        <div className="glass-panel flex items-center gap-3 px-4 py-3">
          <Activity className="size-4 animate-pulse text-accent" />
          Loading
        </div>
      </div>
    );
  }
  return <ServersList />;
}

function ServersList() {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.serversList();
      setServers(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const totals = useMemo(() => {
    const connected = servers.filter((s) => s.connected).length;
    return { total: servers.length, connected };
  }, [servers]);

  const onRemove = async (id: string, name: string) => {
    if (!confirm(`Remove server "${name}"? This stops monitoring it but does not affect the agent.`)) return;
    setRemoving(id);
    try {
      await api.serverDelete(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="app-bg min-h-screen text-fg">
      <header className="border-b border-white/10 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg border border-accent/30 bg-accent/10 shadow-glow">
              <Activity className="size-5 text-accent" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">Server Monitor</div>
              <div className="mt-1 text-[11px] text-fg-subtle">Fleet overview</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="btn-secondary">
              <RefreshCw className="size-4" />
              Refresh
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-secondary">
              <Plus className="size-4" />
              Add server
            </button>
            <Link href="/settings" className="btn-ghost">
              <Settings className="size-4" />
              Settings
            </Link>
            <button
              onClick={async () => {
                try {
                  await api.logout();
                } finally {
                  window.location.href = '/login';
                }
              }}
              className="btn-ghost"
            >
              <LogOut className="size-4" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <Chip label="Servers" value={String(totals.total)} />
          <Chip label="Connected" value={String(totals.connected)} tone="green" />
        </div>

        {err && (
          <div className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {loading && servers.length === 0 ? (
          <div className="grid min-h-[40vh] place-items-center text-fg-muted">
            <div className="glass-panel flex items-center gap-2 px-4 py-3 text-sm">
              <Loader2 className="size-4 animate-spin text-accent" />
              Loading servers
            </div>
          </div>
        ) : servers.length === 0 ? (
          <div className="grid min-h-[40vh] place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center">
            <Server className="size-8 text-fg-subtle" />
            <h2 className="mt-3 text-lg font-semibold">No servers yet</h2>
            <p className="mt-2 max-w-md text-sm text-fg-muted">
              Add another instance running server-monitor by pasting its URL and API key.
            </p>
            <button onClick={() => setShowAdd(true)} className="btn-secondary mt-4">
              <Plus className="size-4" />
              Add server
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {servers.map((s) => (
              <ServerCard
                key={s.id}
                server={s}
                removing={removing === s.id}
                onRemove={() => onRemove(s.id, s.name)}
              />
            ))}
          </div>
        )}
      </main>

      {showAdd && (
        <AddServerDialog
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ServerCard({
  server,
  removing,
  onRemove,
}: {
  server: ServerSummary;
  removing: boolean;
  onRemove: () => void;
}) {
  const statusIcon = !server.enabled ? (
    <CircleOff className="size-4" />
  ) : server.connected ? (
    <CircleCheck className="size-4" />
  ) : (
    <CircleAlert className="size-4" />
  );
  const statusText = !server.enabled
    ? 'disabled'
    : server.connected
      ? 'connected'
      : server.last_error
        ? 'disconnected'
        : 'connecting';

  const detailHref = `/servers/${encodeURIComponent(server.id)}`;

  return (
    <Link
      href={detailHref}
      className="card card-pad group block cursor-pointer transition-colors hover:border-accent/50 hover:bg-white/[0.035] hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-accent/60"
      aria-label={`Open dashboard for ${server.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-accent" />
            <h3 className="truncate text-sm font-semibold text-fg group-hover:text-accent">
              {server.name}
            </h3>
            {server.is_self && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                this
              </span>
            )}
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-fg-subtle">
            {server.base_url || 'local'}
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs ${ToneClass(server.connected, server.enabled)}`}>
          {statusIcon}
          {statusText}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Stat icon={<Cpu className="size-3.5" />} label="CPU" value={server.cpu_percent !== undefined ? `${server.cpu_percent.toFixed(0)}%` : '-'} />
        <Stat icon={<MemoryStick className="size-3.5" />} label="MEM" value={server.mem_percent !== undefined ? `${server.mem_percent.toFixed(0)}%` : '-'} />
        <Stat icon={<HardDrive className="size-3.5" />} label="DISK" value={server.disk_percent !== undefined ? `${server.disk_percent.toFixed(0)}%` : '-'} />
      </div>

      <div className="mt-4 flex items-center justify-between text-[11px] text-fg-muted">
        <div>
          <span className="text-fg-subtle">host</span>{' '}
          <span className="font-mono">{server.hostname || '-'}</span>
        </div>
        <div>
          <span className="text-fg-subtle">up</span>{' '}
          <span className="font-mono">{formatUptime(server.uptime)}</span>
        </div>
      </div>

      {server.last_error && (
        <div className="mt-3 truncate rounded border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-200">
          {server.last_error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
        <span className="text-[10px] text-fg-subtle">last seen {formatLastSeen(server.last_seen)}</span>
        <div className="flex items-center gap-2">
          {!server.is_self && (
            <button
              onClick={(e) => {
                // Stop the parent Link from navigating when "Remove" is clicked.
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }}
              disabled={removing}
              className="inline-flex items-center gap-1 rounded border border-transparent px-2 py-1 text-xs text-rose-300 transition-colors hover:border-rose-400/30 hover:bg-rose-400/10 disabled:opacity-50"
            >
              {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              Remove
            </button>
          )}
          <span className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition-colors group-hover:bg-accent/20">
            Open dashboard
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.025] p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Chip({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'green' }) {
  const cls =
    tone === 'green'
      ? 'border-emerald-300/25 bg-emerald-400/10'
      : 'border-white/10 bg-white/[0.04]';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cls}`}>
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </span>
  );
}

function AddServerDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}) {
  const [pairing, setPairing] = useState('');
  const [name, setName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [baseURL, setBaseURL] = useState('https://');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tested, setTested] = useState<{ hostname: string } | null>(null);

  const usingPairing = pairing.trim().startsWith('sm://');

  const payload = () => {
    if (usingPairing) {
      return { name: name.trim() || undefined, pairing: pairing.trim() };
    }
    return {
      name: name.trim() || tested?.hostname || '',
      base_url: baseURL.trim(),
      api_key: apiKey.trim(),
    };
  };

  const test = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api.serverTest(payload());
      setTested(r.host);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Test failed');
      setTested(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.serverCreate(payload());
      await onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = usingPairing || (baseURL.trim().length > 0 && apiKey.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="glass-panel w-full max-w-lg space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Add server</h2>
          <button type="button" onClick={onClose} className="btn-ghost">
            Close
          </button>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3 text-xs text-fg-muted">
          On the agent host, run:
          <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-fg">
{`server-monitor-agent pair https://<agent-host>:8080`}
          </pre>
          Paste the <code className="rounded bg-black/40 px-1 font-mono">sm://...</code> it
          prints into the box below.
        </div>

        <label className="block text-sm">
          <div className="mb-1 text-xs text-fg-muted">Pairing string</div>
          <textarea
            className="input w-full font-mono text-xs"
            rows={3}
            placeholder="sm://eyJ2IjoxLCJ1cmwiOiJodHRwczovLy4uLiIsImtleSI6InNtX..."
            value={pairing}
            onChange={(e) => {
              setPairing(e.target.value);
              setTested(null);
            }}
            disabled={advanced && !usingPairing}
          />
        </label>

        <label className="block text-sm">
          <div className="mb-1 text-xs text-fg-muted">Name (optional)</div>
          <input
            className="input w-full"
            placeholder={usingPairing ? 'auto-detected from agent hostname' : 'prod-web-1'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <details
          open={advanced}
          onToggle={(e) => setAdvanced((e.currentTarget as HTMLDetailsElement).open)}
          className="text-sm"
        >
          <summary className="cursor-pointer select-none text-xs text-fg-muted hover:text-fg">
            Advanced — enter URL and API key manually
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs text-fg-muted">Base URL</div>
              <input
                className="input w-full font-mono text-xs"
                placeholder="https://10.0.0.5:8080"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                disabled={usingPairing}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs text-fg-muted">API key</div>
              <input
                type="password"
                autoComplete="off"
                className="input w-full font-mono text-xs"
                placeholder="sm_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={usingPairing}
              />
            </label>
          </div>
        </details>

        {tested && (
          <div className="rounded border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            Connection OK. Reachable host: <span className="font-mono">{tested.hostname}</span>
          </div>
        )}
        {err && (
          <div className="rounded border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={test}
            disabled={busy || !canSubmit}
            className="btn-secondary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Boxes className="size-4" />}
            Test
          </button>
          <button type="submit" disabled={busy || !canSubmit} className="btn-primary">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
