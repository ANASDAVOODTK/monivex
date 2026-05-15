import { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';

// Static export requires at least one param to be declared at build time.
// At runtime the Go SPA handler serves index.html for any unknown
// /servers/<id>/... path, and the client-side router renders this layout
// with the actual id from the URL.
export function generateStaticParams() {
  return [{ id: '_' }];
}

export const dynamicParams = false;

export default function ServerLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
