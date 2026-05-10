'use client';

import { useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

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
      setOldPw(''); setNewPw(''); setConfirm('');
    } catch (e: any) {
      setErr(e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-fg-muted">Account and runtime configuration.</p>
      </div>
      <form onSubmit={onSubmit} className="card card-pad space-y-4">
        <div className="text-sm font-semibold">Change password</div>
        <div>
          <label className="text-xs text-fg-muted uppercase tracking-wider">Current password</label>
          <input type="password" className="input mt-1" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-fg-muted uppercase tracking-wider">New password</label>
          <input type="password" className="input mt-1" minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs text-fg-muted uppercase tracking-wider">Confirm new password</label>
          <input type="password" className="input mt-1" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {err && <div className="text-xs text-accent-red">{err}</div>}
        {msg && <div className="text-xs text-accent-green">{msg}</div>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Updating...' : 'Update password'}
        </button>
      </form>
      <div className="card card-pad text-xs text-fg-muted space-y-2">
        <div className="text-sm font-semibold text-fg">Runtime configuration</div>
        <div>Sample interval, retention and log whitelist are read from <span className="kbd">config.yaml</span>. Edit the file and restart <span className="kbd">server-monitor</span> to apply changes.</div>
      </div>
    </div>
  );
}
