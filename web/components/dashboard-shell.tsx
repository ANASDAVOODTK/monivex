'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { useMetricsSocket } from '@/lib/ws';
import { api } from '@/lib/api';

export function DashboardShell({ children }: { children: ReactNode }) {
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
      <div className="h-screen flex items-center justify-center text-fg-muted text-sm">
        Loading...
      </div>
    );
  }
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: ReactNode }) {
  useMetricsSocket();
  return (
    <div className="h-screen flex bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
