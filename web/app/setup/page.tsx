'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

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
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-md">
        <div className="text-lg font-semibold text-center mb-2">First-run setup</div>
        <p className="text-xs text-fg-muted text-center mb-5">
          A one-time setup token was printed to the server console when the binary started.
          Paste it below to create the admin account.
        </p>
        <form onSubmit={onSubmit} className="card card-pad space-y-4">
          <div>
            <label className="text-xs text-fg-muted uppercase tracking-wider">Setup token</label>
            <input
              autoFocus
              className="input mt-1 font-mono"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="text-xs text-fg-muted uppercase tracking-wider">Username</label>
              <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs text-fg-muted uppercase tracking-wider">Password</label>
              <input
                type="password"
                className="input mt-1"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs text-fg-muted uppercase tracking-wider">Confirm password</label>
              <input
                type="password"
                className="input mt-1"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>
          {error && <div className="text-xs text-accent-red">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create admin account'}
          </button>
        </form>
      </div>
    </div>
  );
}
