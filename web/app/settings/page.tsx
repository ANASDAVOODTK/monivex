'use client';

import { useCallback, useEffect, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { Notice, PageHeader } from '@/components/ui';
import { api, type APIKeySummary } from '@/lib/api';
import { Copy, Key, KeyRound, Loader2, LockKeyhole, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';

export default function SettingsPage() {
  return (
    <DashboardShell>
      <Settings />
    </DashboardShell>
  );
}

function Settings() {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setErr('');
    if (newPw !== confirm) {
      setErr("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(oldPw, newPw);
      setMsg('Password updated.');
      setOldPw('');
      setNewPw('');
      setConfirm('');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Control"
        title="Settings"
        description="Account security, API keys for hub access, and runtime configuration status."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
        <form onSubmit={onSubmit} className="card card-pad space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="size-4 text-accent" />
            Change password
          </div>
          <Field label="Current password">
            <input type="password" className="input" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
          </Field>
          <Field label="New password">
            <input type="password" className="input" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </Field>
          <Field label="Confirm new password">
            <input type="password" className="input" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          {err && <Notice tone="danger">{err}</Notice>}
          {msg && <Notice tone="success">{msg}</Notice>}
          <button type="submit" className="btn-primary" disabled={loading}>
            <LockKeyhole className="size-4" />
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <div className="card card-pad">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <SettingsIcon className="size-4 text-accent" />
            Runtime configuration
          </div>
          <div className="mt-4 space-y-3 text-sm text-fg-muted">
            <ConfigRow label="Source" value="config.yaml" />
            <ConfigRow label="Sample interval" value="server managed" />
            <ConfigRow label="History retention" value="server managed" />
            <ConfigRow label="Log allowlist" value="server managed" />
          </div>
          <div className="mt-5">
            <Notice>
              Changes to <span className="kbd">config.yaml</span> apply after restarting <span className="kbd">server-monitor</span>.
            </Notice>
          </div>
        </div>
      </div>

      <APIKeysSection />
    </div>
  );
}

function APIKeysSection() {
  const [keys, setKeys] = useState<APIKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; secret: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.apiKeysList();
      setKeys(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const k = await api.apiKeyCreate(newName.trim());
      setCreated({ id: k.id, name: k.name, secret: k.secret });
      setNewName('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Revoke API key "${name}"? Any hub using it will lose access immediately.`)) return;
    try {
      await api.apiKeyDelete(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="card card-pad">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Key className="size-4 text-accent" />
        API keys
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        Generate a key here, then paste it into another hub's "Add server" form to monitor this host from
        that hub. Each key authenticates the bearer as this server-monitor — keep secrets safe.
      </p>

      {created && (
        <div className="mt-4 rounded-lg border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm">
          <div className="font-medium text-emerald-200">New API key — copy now, won't be shown again</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="grow break-all rounded bg-black/40 px-2 py-1 font-mono text-xs">{created.secret}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(created.secret)}
              className="btn-ghost"
              title="Copy"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="btn-ghost mt-2 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={onCreate} className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="Key name">
          <input
            className="input min-w-56"
            placeholder="hub at 10.0.0.5"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
        </Field>
        <button type="submit" disabled={creating} className="btn-secondary">
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Generate key
        </button>
      </form>

      {err && <div className="mt-3"><Notice tone="danger">{err}</Notice></div>}

      <div className="mt-5">
        {loading ? (
          <div className="text-sm text-fg-muted">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="text-sm text-fg-muted">No API keys yet.</div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{k.name}</div>
                  <div className="mt-1 font-mono text-[10px] text-fg-subtle">
                    {k.id} · created {new Date(k.created_at * 1000).toLocaleString()}
                    {k.last_used_at ? ` · last used ${new Date(k.last_used_at * 1000).toLocaleString()}` : ' · never used'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(k.id, k.name)}
                  className="inline-flex items-center gap-1 rounded border border-rose-400/30 px-2 py-1 text-xs text-rose-300 hover:bg-rose-400/10"
                >
                  <Trash2 className="size-3" />
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2">
      <span>{label}</span>
      <span className="font-mono text-xs text-fg">{value}</span>
    </div>
  );
}
