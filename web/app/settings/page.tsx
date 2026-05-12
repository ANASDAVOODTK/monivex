'use client';

import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { Notice, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { KeyRound, LockKeyhole, Settings as SettingsIcon } from 'lucide-react';

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
        description="Account security and runtime configuration status."
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
