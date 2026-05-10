'use client';

import { useMemo, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { useMetrics } from '@/lib/store';
import { Search } from 'lucide-react';

export default function ServicesPage() {
  return (
    <DashboardShell>
      <Services />
    </DashboardShell>
  );
}

function Services() {
  const services = useMetrics((s) => s.current?.services) ?? [];
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'failed'>('all');

  const filtered = useMemo(() => {
    return services
      .filter((s) => (q ? s.name.toLowerCase().includes(q.toLowerCase()) || s.description?.toLowerCase().includes(q.toLowerCase()) : true))
      .filter((s) => {
        if (filter === 'active') return s.active_state === 'active';
        if (filter === 'failed') return s.active_state === 'failed';
        return true;
      });
  }, [services, q, filter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Services</h1>
          <p className="text-sm text-fg-muted">Read-only systemd unit list.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-bg-border overflow-hidden text-xs">
            {(['all', 'active', 'failed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 ${filter === f ? 'bg-bg-subtle text-fg' : 'text-fg-muted hover:text-fg'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" />
            <input className="input pl-8" placeholder="Filter services" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-subtle/40 text-xs text-fg-muted uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2.5">Name</th>
              <th className="text-left px-3 py-2.5">Description</th>
              <th className="text-left px-3 py-2.5">Load</th>
              <th className="text-left px-3 py-2.5">Active</th>
              <th className="text-left px-3 py-2.5">Sub</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.name} className="border-t border-bg-border hover:bg-bg-subtle/30">
                <td className="px-3 py-2 font-mono text-xs">{s.name}</td>
                <td className="px-3 py-2 text-fg-muted">{s.description}</td>
                <td className="px-3 py-2"><Badge text={s.load_state} /></td>
                <td className="px-3 py-2"><StateBadge state={s.active_state} /></td>
                <td className="px-3 py-2 text-fg-muted">{s.sub_state}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-fg-muted">No services</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ text }: { text: string }) {
  return <span className="badge bg-bg-subtle text-fg-muted">{text}</span>;
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    failed: 'bg-red-500/15 text-red-300 border border-red-500/30',
    inactive: 'bg-bg-subtle text-fg-muted border border-bg-border',
    activating: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    deactivating: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  };
  const cls = map[state] || 'bg-bg-subtle text-fg-muted border border-bg-border';
  return <span className={`badge ${cls}`}>{state}</span>;
}
