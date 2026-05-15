'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader, ProgressBar, StatusBadge } from '@/components/ui';
import { useServerMetrics } from '@/lib/store';
import type { Process } from '@/lib/types';
import { formatBytes, formatPct } from '@/lib/utils';
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Search, Users } from 'lucide-react';

type SortKey = 'cpu' | 'mem' | 'pid' | 'name';
const EMPTY_PROCS: Process[] = [];

export default function ProcessesPage() {
  return <Processes />;
}

function Processes() {
  const params = useParams<{ id: string }>();
  const serverId = (params?.id ?? '') as string;
  const { current } = useServerMetrics(serverId);
  const procs = current?.processes ?? EMPTY_PROCS;
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('cpu');
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const query = q.trim().toLowerCase();
    const filtered = query
      ? procs.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.command?.toLowerCase().includes(query) ||
            p.user?.toLowerCase().includes(query) ||
            String(p.pid).includes(query),
        )
      : procs;

    return [...filtered].sort((a, b) => {
      let v = 0;
      switch (sortBy) {
        case 'cpu':
          v = a.cpu_percent - b.cpu_percent;
          break;
        case 'mem':
          v = a.mem_rss - b.mem_rss;
          break;
        case 'pid':
          v = a.pid - b.pid;
          break;
        case 'name':
          v = a.name.localeCompare(b.name);
          break;
      }
      return asc ? v : -v;
    });
  }, [procs, q, sortBy, asc]);

  const toggleSort = (k: SortKey) => {
    if (sortBy === k) setAsc(!asc);
    else {
      setSortBy(k);
      setAsc(false);
    }
  };

  const uniqueUsers = new Set(procs.map((p) => p.user).filter(Boolean)).size;
  const totalCpu = procs.reduce((sum, p) => sum + p.cpu_percent, 0);
  const totalMem = procs.reduce((sum, p) => sum + p.mem_rss, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workloads"
        title="Processes"
        description="Live process inventory sorted, filtered, and ranked by host pressure."
        actions={
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              placeholder="Filter name, PID, user, command"
              className="input pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        }
        stats={
          <>
            <SummaryChip icon={<Cpu className="size-3.5" />} label="CPU sum" value={formatPct(totalCpu)} />
            <SummaryChip icon={<MemoryStick className="size-3.5" />} label="RSS" value={formatBytes(totalMem)} />
            <SummaryChip icon={<Users className="size-3.5" />} label="Users" value={uniqueUsers.toString()} />
            <SummaryChip label="Rows" value={`${sorted.length} / ${procs.length}`} />
          </>
        }
      />

      <div className="table-wrap">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="table-head">
              <tr>
                <Th onClick={() => toggleSort('pid')} active={sortBy === 'pid'} asc={asc}>PID</Th>
                <Th onClick={() => toggleSort('name')} active={sortBy === 'name'} asc={asc}>Name</Th>
                <th className="px-4 py-3 text-left">User</th>
                <Th onClick={() => toggleSort('cpu')} active={sortBy === 'cpu'} asc={asc} align="right">CPU</Th>
                <Th onClick={() => toggleSort('mem')} active={sortBy === 'mem'} asc={asc} align="right">Memory</Th>
                <th className="px-4 py-3 text-right">Threads</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.pid} className="table-row">
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">{p.pid}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.name}</div>
                    <div className="mt-1 max-w-[520px] truncate font-mono text-[11px] text-fg-subtle">{p.command}</div>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{p.user}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <CpuBar pct={p.cpu_percent} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className="text-sm">{formatBytes(p.mem_rss)}</div>
                    <div className="text-[11px] text-fg-subtle">{formatPct(p.mem_percent)}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{p.num_threads}</td>
                  <td className="px-4 py-3">
                    <StatusBadge state={p.status || 'unknown'} />
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-sm text-fg-muted">No matching processes</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
      {icon}
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </span>
  );
}

function Th({
  children,
  onClick,
  active,
  asc,
  align,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  asc: boolean;
  align?: 'right';
}) {
  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''} ${active ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}
      >
        {children}
        {active ? asc ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
      </button>
    </th>
  );
}

function CpuBar({ pct }: { pct: number }) {
  const tone = pct > 80 ? 'rose' : pct > 50 ? 'amber' : 'teal';

  return (
    <div className="ml-auto flex max-w-40 items-center gap-3">
      <span className="w-12 text-right text-xs tabular-nums">{formatPct(pct)}</span>
      <ProgressBar value={pct} tone={tone} className="h-1.5 flex-1" />
    </div>
  );
}
