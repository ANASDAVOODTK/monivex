'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock3, LogOut, Menu, Server, Wifi, WifiOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useServerMetrics } from '@/lib/store';
import { useServerId } from '@/lib/use-server-id';
import { formatDuration } from '@/lib/utils';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const serverId = useServerId();
  const { current, connected } = useServerMetrics(serverId);
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
    <header className="h-16 shrink-0 border-b border-white/10 bg-bg/75 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="btn-ghost p-2 md:hidden"
            onClick={onMenu}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="hidden rounded-lg border border-white/10 bg-white/[0.045] p-2 text-accent sm:block">
            <Server className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {current?.host?.hostname ?? 'server-monitor'}
            </div>
            <div className="mt-0.5 hidden truncate text-xs text-fg-muted sm:block">
              {current?.host?.platform ?? 'pending'} {current?.host?.platform_version ?? ''}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
          {current?.host?.uptime ? (
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-fg-muted lg:flex">
              <Clock3 className="size-3.5 text-fg-subtle" />
              <span>up {formatDuration(current.host.uptime)}</span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs">
            {connected ? <Wifi className="size-3.5 text-emerald-300" /> : <WifiOff className="size-3.5 text-rose-300" />}
            <span className={connected ? 'text-emerald-200' : 'text-rose-200'}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>

          {user && (
            <div className="hidden max-w-32 truncate rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-fg-muted sm:block">
              <span className="font-medium text-fg">{user}</span>
            </div>
          )}

          <button onClick={onLogout} className="btn-ghost px-2.5 sm:px-3" title="Logout">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
