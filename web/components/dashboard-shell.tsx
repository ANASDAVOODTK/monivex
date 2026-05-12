'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { useMetricsSocket } from '@/lib/ws';
import { api } from '@/lib/api';
import { Activity } from 'lucide-react';

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
      <div className="app-bg flex h-screen items-center justify-center text-sm text-fg-muted">
        <div className="glass-panel flex items-center gap-3 px-4 py-3">
          <Activity className="size-4 animate-pulse text-accent" />
          Warming up telemetry
        </div>
      </div>
    );
  }
  return <Inner>{children}</Inner>;
}

function Inner({ children }: { children: ReactNode }) {
  useMetricsSocket();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app-bg flex h-screen overflow-hidden text-fg">
      <Sidebar onNavigate={() => setMobileNavOpen(false)} />
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar onMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
