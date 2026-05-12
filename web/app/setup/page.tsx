'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Notice } from '@/components/ui';
import { api } from '@/lib/api';
import { UserPlus } from 'lucide-react';

export default function SetupPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.setupStatus().then((s) => {
      if (!s.needs_setup) router.replace('/login');
    });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await api.setup(token.trim(), username.trim(), password);
      router.replace('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="First-run setup"
      subtitle="Use the setup token from the server console to create the admin account."
    >
      <form onSubmit={onSubmit} className="card card-pad space-y-4">
        <Field label="Setup token">
          <input
            autoFocus
            className="input font-mono"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
        </Field>
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password">
          <input
            type="password"
            className="input"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field label="Confirm password">
          <input
            type="password"
            className="input"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          <UserPlus className="size-4" />
          {loading ? 'Creating account...' : 'Create admin account'}
        </button>
      </form>
    </AuthShell>
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
