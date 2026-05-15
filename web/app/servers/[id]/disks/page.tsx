'use client';

import { useParams } from 'next/navigation';
import { EmptyState, MetricTile, PageHeader, ProgressBar, SectionHeader } from '@/components/ui';
import { useServerMetrics } from '@/lib/store';
import { formatBytes, formatBytesPerSec, formatPct } from '@/lib/utils';
import { Database, HardDrive, Network, Route } from 'lucide-react';

export default function DisksPage() {
  return <Disks />;
}

function Disks() {
  const params = useParams<{ id: string }>();
  const serverId = (params?.id ?? '') as string;
  const { current } = useServerMetrics(serverId);
  const disks = current?.disks ?? [];
  const networks = current?.network ?? [];

  const totalDisk = disks.reduce((sum, d) => sum + d.total, 0);
  const usedDisk = disks.reduce((sum, d) => sum + d.used, 0);
  const rx = networks.reduce((sum, n) => sum + n.recv_rate, 0);
  const tx = networks.reduce((sum, n) => sum + n.send_rate, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Storage and network"
        title="Disks and interfaces"
        description="Mounted filesystems, capacity posture, and per-interface traffic counters."
        stats={
          <>
            <SummaryChip label="Mounts" value={disks.length.toString()} />
            <SummaryChip label="Interfaces" value={networks.length.toString()} />
            <SummaryChip label="RX" value={formatBytesPerSec(rx)} />
            <SummaryChip label="TX" value={formatBytesPerSec(tx)} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricTile
          label="Disk allocation"
          value={formatPct(totalDisk ? (usedDisk / totalDisk) * 100 : 0)}
          detail={`${formatBytes(usedDisk)} of ${formatBytes(totalDisk)}`}
          percent={totalDisk ? (usedDisk / totalDisk) * 100 : 0}
          tone="amber"
          icon={<Database className="size-4" />}
        />
        <MetricTile label="Receive rate" value={formatBytesPerSec(rx)} tone="green" icon={<Network className="size-4" />} />
        <MetricTile label="Transmit rate" value={formatBytesPerSec(tx)} tone="teal" icon={<Route className="size-4" />} />
      </div>

      <section>
        <SectionHeader title="Filesystems" />
        {disks.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {disks.map((d) => (
              <div key={d.mountpoint} className="card card-pad">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-medium">{d.mountpoint}</div>
                    <div className="mt-1 truncate text-[11px] text-fg-subtle">{d.device} / {d.fstype}</div>
                  </div>
                  <HardDrive className="size-4 shrink-0 text-accent" />
                </div>
                <div className="mt-5">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-fg-muted">Used</span>
                    <span className="tabular-nums">{formatPct(d.used_percent)}</span>
                  </div>
                  <ProgressBar value={d.used_percent} tone={d.used_percent > 90 ? 'rose' : d.used_percent > 75 ? 'amber' : 'cyan'} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-fg-muted">
                  <Mini label="Used" value={formatBytes(d.used)} />
                  <Mini label="Free" value={formatBytes(d.free)} />
                  <Mini label="Total" value={formatBytes(d.total)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No filesystem data" icon={<HardDrive className="size-5" />} />
        )}
      </section>

      <section>
        <SectionHeader title="Network interfaces" />
        <div className="table-wrap">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3 text-left">Interface</th>
                  <th className="px-4 py-3 text-right">Receive rate</th>
                  <th className="px-4 py-3 text-right">Transmit rate</th>
                  <th className="px-4 py-3 text-right">Total RX</th>
                  <th className="px-4 py-3 text-right">Total TX</th>
                  <th className="px-4 py-3 text-right">Packets RX/TX</th>
                </tr>
              </thead>
              <tbody>
                {networks.map((n) => (
                  <tr key={n.name} className="table-row">
                    <td className="px-4 py-3 font-mono">{n.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBytesPerSec(n.recv_rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatBytesPerSec(n.send_rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{formatBytes(n.bytes_recv)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{formatBytes(n.bytes_sent)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                      {n.packets_recv.toLocaleString()} / {n.packets_sent.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {networks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-14 text-center text-sm text-fg-muted">No network interfaces</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2">
      <div className="text-[10px] uppercase text-fg-subtle">{label}</div>
      <div className="mt-1 truncate text-xs font-medium text-fg">{value}</div>
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
      <span className="text-fg-muted">{label}</span>
      <span className="ml-2 font-medium text-fg">{value}</span>
    </span>
  );
}
