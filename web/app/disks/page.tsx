'use client';

import { DashboardShell } from '@/components/dashboard-shell';
import { useMetrics } from '@/lib/store';
import { formatBytes, formatBytesPerSec, formatPct } from '@/lib/utils';

export default function DisksPage() {
  return (
    <DashboardShell>
      <Disks />
    </DashboardShell>
  );
}

function Disks() {
  const current = useMetrics((s) => s.current);
  const disks = current?.disks ?? [];
  const networks = current?.network ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Disks & Network</h1>
        <p className="text-sm text-fg-muted">Mounted filesystems and per-interface throughput.</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-3">Filesystems</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {disks.map((d) => (
            <div key={d.mountpoint} className="card card-pad">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium font-mono text-sm">{d.mountpoint}</div>
                  <div className="text-[11px] text-fg-subtle">{d.device} · {d.fstype}</div>
                </div>
                <div className="text-sm tabular-nums">{formatPct(d.used_percent)}</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-bg-subtle overflow-hidden">
                <div
                  className={`h-full ${d.used_percent > 90 ? 'bg-red-500' : d.used_percent > 75 ? 'bg-amber-500' : 'bg-cyan-500'}`}
                  style={{ width: `${d.used_percent}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
                <span>{formatBytes(d.used)} used</span>
                <span>{formatBytes(d.free)} free</span>
                <span>{formatBytes(d.total)} total</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3">Network interfaces</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle/40 text-xs text-fg-muted uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2.5">Interface</th>
                <th className="text-right px-3 py-2.5">↓ Rate</th>
                <th className="text-right px-3 py-2.5">↑ Rate</th>
                <th className="text-right px-3 py-2.5">Total RX</th>
                <th className="text-right px-3 py-2.5">Total TX</th>
                <th className="text-right px-3 py-2.5">Pkts RX/TX</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name} className="border-t border-bg-border">
                  <td className="px-3 py-2 font-mono">{n.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBytesPerSec(n.recv_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBytesPerSec(n.send_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{formatBytes(n.bytes_recv)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{formatBytes(n.bytes_sent)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {n.packets_recv.toLocaleString()} / {n.packets_sent.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
