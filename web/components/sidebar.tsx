'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Cpu, HardDrive, LayoutDashboard, ListTree, ScrollText, Settings, Container } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/gpu', label: 'GPU', icon: Cpu },
  { href: '/processes', label: 'Processes', icon: Activity },
  { href: '/services', label: 'Services', icon: ListTree },
  { href: '/docker', label: 'Docker', icon: Container },
  { href: '/disks', label: 'Disks', icon: HardDrive },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-bg-border bg-bg-subtle/40">
      <div className="px-5 py-5 flex items-center gap-2">
        <div className="size-8 rounded-md bg-gradient-to-br from-accent to-accent-violet flex items-center justify-center">
          <Activity className="size-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-none">Server Monitor</div>
          <div className="text-[10px] text-fg-subtle mt-1">v0.1</div>
        </div>
      </div>
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-accent/15 text-fg border border-accent/30'
                  : 'text-fg-muted hover:text-fg hover:bg-bg-subtle border border-transparent',
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 text-[10px] text-fg-subtle border-t border-bg-border">
        Read-only • LAN
      </div>
    </aside>
  );
}
