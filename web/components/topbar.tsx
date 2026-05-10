'use client';

import { useEffect, useState } from 'react';
import { useMetrics } from '@/lib/store';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function Topbar() {
  const current = useMetrics((s) => s.current);
  const connected = useMetrics((s) => s.connected);
  const [user, setUser] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    api.me().then((u) => setUser(u.username)).catch(() => {});
  }, []);

  const onLogout = async () => {
    try {
      await api.logout();
    } finally {
      router.push('/login');
    }
  };

  return (
    <header className="h-14 border-b border-bg-border px-4 sm:px-6 flex items-center justify-between bg-bg-subtle/30 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="font-semibold text-sm">
          {current?.host?.hostname ?? 'server-monitor'}
        </div>
        <span className="text-fg-subtle text-xs">·</span>
        <div className="text-xs text-fg-muted">
          {current?.host?.platform ?? '...'} {current?.host?.platform_version ?? ''}
        </div>
        {current?.host?.uptime ? (
          <>
            <span className="text-fg-subtle text-xs">·</span>
            <div className="text-xs text-fg-muted">up {formatDuration(current.host.uptime)}</div>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={`size-2 rounded-full ${connected ? 'bg-accent-green animate-pulse-slow' : 'bg-accent-red'}`}
          />
          <span className="text-fg-muted">{connected ? 'Live' : 'Disconnected'}</span>
        </div>
        {user && (
          <div className="text-xs text-fg-muted">
            <span className="font-medium text-fg">{user}</span>
          </div>
        )}
        <button onClick={onLogout} className="btn-ghost text-xs">
          <LogOut className="size-3.5" />
          Logout
        </button>
      </div>
    </header>
  );
}
