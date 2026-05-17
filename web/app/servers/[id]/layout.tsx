import { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';

// Static export requires at least one param at build time. We pre-render the
// sentinel "_" and the Go SPA handler maps any real /servers/<id>/... request
// to that pre-rendered HTML so deep links work. In dev mode `output: 'export'`
// is disabled (see next.config.mjs) so the dev server happily renders any id
// against this layout directly.
export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function ServerLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
