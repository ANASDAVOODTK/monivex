'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Activity } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.setupStatus().then((s) => {
      if (s.needs_setup) router.replace('/setup');
    });
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(username, password);
      router.replace('/');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center mb-6 gap-2">
          <div className="size-9 rounded-md bg-gradient-to-br from-accent to-accent-violet flex items-center justify-center">
            <Activity className="size-5 text-white" />
          </div>
          <div className="text-lg font-semibold">Server Monitor</div>
        </div>
        <form onSubmit={onSubmit} className="card card-pad space-y-4">
          <div>
            <label className="text-xs text-fg-muted uppercase tracking-wider">Username</label>
            <input
              autoFocus
              className="input mt-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-fg-muted uppercase tracking-wider">Password</label>
            <input
              type="password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="text-xs text-accent-red">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
