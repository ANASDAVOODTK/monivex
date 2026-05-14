'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/gpu', label: 'GPU', icon: Cpu },
  { href: '/processes', label: 'Processes', icon: Activity },
  { href: '/services', label: 'Services', icon: ListTree },
  { href: '/node-apps', label: 'Node apps', icon: Package },
  { href: '/docker', label: 'Docker', icon: Container },
  { href: '/templates', label: 'Templates', icon: Boxes },
  { href: '/disks', label: 'Disks', icon: HardDrive },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

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

      <nav className="flex-1 px-3 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'group flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-accent/30 bg-accent/[0.12] text-fg shadow-glow'
                  : 'border-transparent text-fg-muted hover:border-white/10 hover:bg-white/[0.045] hover:text-fg',
              )}
            >
              <Icon className={cn('size-4', active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted')} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
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
