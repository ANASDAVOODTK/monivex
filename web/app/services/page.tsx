'use client';

import { useMemo, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { PageHeader, StatusBadge } from '@/components/ui';
import { useMetrics } from '@/lib/store';
import type { ServiceUnit } from '@/lib/types';
import { CheckCircle2, Search, ServerCog, TriangleAlert } from 'lucide-react';

type Filter = 'all' | 'active' | 'failed';
const EMPTY_SERVICES: ServiceUnit[] = [];

export default function ServicesPage() {
  return (
    <DashboardShell>
      <Services />
    </DashboardShell>
  );
}

function Services() {
  const services = useMetrics((s) => s.current?.services ?? EMPTY_SERVICES);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    return services.reduce(
      (acc, s) => {
        if (s.active_state === 'active') acc.active += 1;
        if (s.active_state === 'failed') acc.failed += 1;
        return acc;
      },
      { active: 0, failed: 0 },
    );
  }, [services]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return services
      .filter((s) => (query ? s.name.toLowerCase().includes(query) || s.description?.toLowerCase().includes(query) : true))
      .filter((s) => {
        if (filter === 'active') return s.active_state === 'active';
        if (filter === 'failed') return s.active_state === 'failed';
        return true;
      });
  }, [services, q, filter]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Systemd"
        title="Services"
        description="Read-only unit state across load, active, and sub-state channels."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-bg-border bg-white/[0.035] p-1 text-xs">
              {(['all', 'active', 'failed'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1.5 capitalize transition ${filter === f ? 'bg-accent text-bg' : 'text-fg-muted hover:text-fg'}`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
              <input className="input pl-8" placeholder="Filter services" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        }
        stats={
          <>
            <SummaryChip icon={<ServerCog className="size-3.5" />} label="Units" value={services.length.toString()} />
            <SummaryChip icon={<CheckCircle2 className="size-3.5" />} label="Active" value={counts.active.toString()} tone="green" />
            <SummaryChip icon={<TriangleAlert className="size-3.5" />} label="Failed" value={counts.failed.toString()} tone={counts.failed ? 'rose' : 'neutral'} />
          </>
        }
      />

      <div className="table-wrap">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-left">Load</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3 text-left">Sub</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.name} className="table-row">
                  <td className="px-4 py-3 font-mono text-xs">{s.name}</td>
                  <td className="px-4 py-3 text-fg-muted">{s.description}</td>
                  <td className="px-4 py-3"><StatusBadge state={s.load_state} /></td>
                  <td className="px-4 py-3"><StatusBadge state={s.active_state} /></td>
                  <td className="px-4 py-3 text-fg-muted">{s.sub_state}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-14 text-center text-sm text-fg-muted">No matching services</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryChip({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'rose';
}) {
  const cls =
    tone === 'green'
      ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200'
      : tone === 'rose'
        ? 'border-rose-300/25 bg-rose-400/10 text-rose-200'
        : 'border-white/10 bg-white/[0.04] text-fg';

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${cls}`}>
      {icon}
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </span>
  );
}
