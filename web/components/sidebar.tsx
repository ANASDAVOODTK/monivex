'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  Bot,
  Boxes,
  Container,
  Cpu,
  HardDrive,
  LayoutDashboard,
  ListTree,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_TEMPLATE = [
  { suffix: '', label: 'Overview', icon: LayoutDashboard },
  { suffix: '/gpu', label: 'GPU', icon: Cpu },
  { suffix: '/processes', label: 'Processes', icon: Activity },
  { suffix: '/services', label: 'Services', icon: ListTree },
  { suffix: '/node-apps', label: 'Node apps', icon: Package },
  { suffix: '/docker', label: 'Docker', icon: Container },
  { suffix: '/templates', label: 'Templates', icon: Boxes },
  { suffix: '/llm', label: 'LLM Models', icon: Bot },
  { suffix: '/disks', label: 'Disks', icon: HardDrive },
  { suffix: '/logs', label: 'Logs', icon: ScrollText },
  { suffix: '/terminal', label: 'Terminal', icon: Terminal },
];

export function Sidebar({
  serverId,
  mobile = false,
  onNavigate,
}: {
  serverId?: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = serverId ? `/servers/${encodeURIComponent(serverId)}` : '';

  return (
    <aside
      className={cn(
        'shrink-0 flex-col border-r border-white/10 bg-bg/90 backdrop-blur-xl',
        mobile ? 'absolute left-0 top-0 z-50 flex h-full w-72' : 'hidden w-72 md:flex',
      )}
    >
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg border border-accent/30 bg-accent/10 shadow-glow">
            <Activity className="size-5 text-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">Server Monitor</div>
            <div className="mt-1 text-[11px] text-fg-subtle">Live operations console</div>
          </div>
        </div>
      </div>

      {serverId && (
        <Link
          href="/"
          onClick={onNavigate}
          className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-fg-muted transition-colors hover:border-accent/30 hover:bg-white/[0.04] hover:text-fg"
        >
          <ArrowLeft className="size-3.5" />
          All servers
        </Link>
      )}

      <nav className="flex-1 px-3 space-y-1">
        {serverId &&
          NAV_TEMPLATE.map((item) => {
            const Icon = item.icon;
            const href = base + item.suffix;
            const active =
              item.suffix === ''
                ? pathname === base || pathname === base + '/'
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-accent/30 bg-accent/[0.12] text-fg shadow-glow'
                    : 'border-transparent text-fg-muted hover:border-white/10 hover:bg-white/[0.045] hover:text-fg',
                )}
              >
                <Icon
                  className={cn(
                    'size-4',
                    active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted',
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            'group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
            pathname.startsWith('/settings')
              ? 'border-accent/30 bg-accent/[0.12] text-fg shadow-glow'
              : 'border-transparent text-fg-muted hover:border-white/10 hover:bg-white/[0.045] hover:text-fg',
          )}
        >
          <Settings
            className={cn(
              'size-4',
              pathname.startsWith('/settings')
                ? 'text-accent'
                : 'text-fg-subtle group-hover:text-fg-muted',
            )}
          />
          <span className="truncate">Settings</span>
        </Link>
      </nav>

      <div className="m-4 rounded-lg border border-white/10 bg-white/[0.035] p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-fg">
          <ShieldCheck className="size-4 text-emerald-300" />
          Protected LAN session
        </div>
        <div className="mt-2 text-[11px] leading-5 text-fg-muted">
          Authenticated access with server-side controls.
        </div>
      </div>
    </aside>
  );
}
