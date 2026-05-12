'use client';

import type { ReactNode } from 'react';
import { Activity, LockKeyhole, Server, ShieldCheck } from 'lucide-react';

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app-bg min-h-screen p-5 text-fg">
      <div className="mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1fr_420px]">
        <div className="hidden lg:block">
          <div className="glass-panel relative min-h-[620px] overflow-hidden p-8">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:34px_34px]" />
            <div className="relative z-10 flex h-full min-h-[560px] flex-col justify-between">
              <div>
                <div className="mb-8 flex items-center gap-3">
                  <div className="grid size-12 place-items-center rounded-lg border border-accent/30 bg-accent/10 shadow-glow">
                    <Activity className="size-6 text-accent" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Server Monitor</div>
                    <div className="mt-1 text-xs text-fg-muted">Secure telemetry console</div>
                  </div>
                </div>
                <h1 className="max-w-xl text-4xl font-semibold leading-tight">See the machine clearly.</h1>
                <p className="mt-4 max-w-lg text-sm leading-6 text-fg-muted">
                  A focused operating surface for host health, workloads, containers, services, logs, and accelerators.
                </p>
              </div>

              <div className="relative h-72">
                <div className="absolute left-1/2 top-1/2 grid size-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-accent/30 bg-bg/80 shadow-glow">
                  <Server className="size-10 text-accent" />
                </div>
                <AuthNode icon={<ShieldCheck className="size-4" />} label="Auth" className="left-12 top-8" />
                <AuthNode icon={<Activity className="size-4" />} label="Metrics" className="right-12 top-14" />
                <AuthNode icon={<LockKeyhole className="size-4" />} label="Session" className="bottom-8 left-1/2 -translate-x-1/2" />
                <div className="absolute left-20 right-20 top-1/2 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
                <div className="absolute bottom-20 top-16 left-1/2 w-px bg-gradient-to-b from-transparent via-accent/45 to-transparent" />
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="grid size-10 place-items-center rounded-lg border border-accent/30 bg-accent/10 shadow-glow">
              <Activity className="size-5 text-accent" />
            </div>
            <div>
              <div className="text-sm font-semibold">Server Monitor</div>
              <div className="text-xs text-fg-muted">Secure telemetry console</div>
            </div>
          </div>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <div className="mt-2 text-sm leading-6 text-fg-muted">{subtitle}</div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function AuthNode({ icon, label, className }: { icon: ReactNode; label: string; className: string }) {
  return (
    <div className={`absolute ${className}`}>
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-bg/80 px-3 py-2 text-xs text-fg-muted backdrop-blur">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
    </div>
  );
}
