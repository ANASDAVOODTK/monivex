'use client';

import { useMemo, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatPct } from '@/lib/utils';
import { Search } from 'lucide-react';

type SortKey = 'cpu' | 'mem' | 'pid' | 'name';

export default function ProcessesPage() {
  return (
    <DashboardShell>
      <Processes />
    </DashboardShell>
  );
}

function Processes() {
  const procs = useMetrics((s) => s.current?.processes) ?? [];
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('cpu');
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const filtered = q
      ? procs.filter(
          (p) =>
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.command?.toLowerCase().includes(q.toLowerCase()) ||
            String(p.pid).includes(q),
        )
      : procs;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let v = 0;
      switch (sortBy) {
        case 'cpu': v = a.cpu_percent - b.cpu_percent; break;
        case 'mem': v = a.mem_rss - b.mem_rss; break;
        case 'pid': v = a.pid - b.pid; break;
        case 'name': v = a.name.localeCompare(b.name); break;
      }
      return asc ? v : -v;
    });
    return copy;
  }, [procs, q, sortBy, asc]);

  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setAsc(!asc);
    else { setSortBy(k); setAsc(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Processes</h1>
          <p className="text-sm text-fg-muted">Top {procs.length} by CPU. Updates every second.</p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-fg-subtle" />
          <input
            placeholder="Filter by name, PID, command"
            className="input pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle/40 text-xs text-fg-muted uppercase tracking-wider">
              <tr>
                <Th onClick={() => toggleSort('pid')} active={sortBy === 'pid'} asc={asc}>PID</Th>
                <Th onClick={() => toggleSort('name')} active={sortBy === 'name'} asc={asc}>Name</Th>
                <th className="text-left px-3 py-2.5">User</th>
                <Th onClick={() => toggleSort('cpu')} active={sortBy === 'cpu'} asc={asc} align="right">CPU</Th>
                <Th onClick={() => toggleSort('mem')} active={sortBy === 'mem'} asc={asc} align="right">Memory</Th>
                <th className="text-right px-3 py-2.5">Threads</th>
                <th className="text-left px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.pid} className="border-t border-bg-border hover:bg-bg-subtle/30">
                  <td className="px-3 py-2 font-mono text-fg-muted">{p.pid}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[11px] text-fg-subtle truncate max-w-md font-mono">{p.command}</div>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{p.user}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <CpuBar pct={p.cpu_percent} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBytes(p.mem_rss)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{p.num_threads}</td>
                  <td className="px-3 py-2">
                    <span className="badge bg-bg-subtle text-fg-muted">{p.status || '-'}</span>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-fg-muted text-sm">No processes</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({ children, onClick, active, asc, align }: { children: React.ReactNode; onClick: () => void; active: boolean; asc: boolean; align?: 'right' }) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} ${active ? 'text-fg' : ''}`}
    >
      {children}{active ? (asc ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

function CpuBar({ pct }: { pct: number }) {
  const v = Math.min(100, Math.max(0, pct));
  const color = v > 80 ? 'bg-red-500' : v > 50 ? 'bg-amber-500' : 'bg-indigo-500';
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="tabular-nums text-xs">{formatPct(pct)}</span>
      <div className="h-1.5 w-16 rounded-full bg-bg-subtle overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
