'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { EmptyState, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { openLogSocket } from '@/lib/ws';
import { FileText, Pause, Play, Search, Trash2 } from 'lucide-react';

export default function LogsPage() {
  return <Logs />;
}

function Logs() {
  const params = useParams<{ id: string }>();
  const serverId = (params?.id ?? '') as string;
  const [sources, setSources] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (!serverId) return;
    api.logSources(serverId).then(setSources).catch(() => setSources([]));
  }, [serverId]);

  useEffect(() => {
    if (!selected || !serverId) return;
    setLines([]);
    const ws = openLogSocket(
      serverId,
      selected,
      (line) => {
        if (pausedRef.current) return;
        setLines((prev) => {
          const next = [...prev, line];
          if (next.length > 5000) next.splice(0, next.length - 5000);
          return next;
        });
      },
      (err) => {
        setLines((prev) => [...prev, `[error] ${err}`]);
      },
    );
    wsRef.current = ws;
    return () => {
      ws.close();
    };
  }, [serverId, selected]);

  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, paused]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  };

  const filtered = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)] flex-col space-y-6">
      <PageHeader
        eyebrow="Log tail"
        title="Logs"
        description="Stream configured files with local filtering and pause control."
        stats={
          <>
            <SummaryChip label="Sources" value={sources.length.toString()} />
            <SummaryChip label="Lines" value={filtered.length.toString()} />
            <SummaryChip label="Mode" value={paused ? 'Paused' : 'Live'} tone={paused ? 'amber' : 'green'} />
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(240px,420px)_1fr_auto_auto]">
        <select
          className="input"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a log file</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            className="input pl-8"
            placeholder="Filter lines"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <button onClick={() => setPaused((p) => !p)} className="btn-secondary">
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button onClick={() => setLines([])} className="btn-ghost">
          <Trash2 className="size-4" />
          Clear
        </button>
      </div>

      {sources.length === 0 && (
        <EmptyState
          title="No log sources"
          message={<span>Add allowed paths in <span className="kbd">config.yaml</span>.</span>}
          icon={<FileText className="size-5" />}
        />
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="card min-h-[420px] flex-1 overflow-y-auto bg-[#08090d] p-4 font-mono text-xs leading-relaxed shadow-card"
      >
        {filtered.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-all rounded px-2 py-0.5 text-fg-muted hover:bg-white/[0.04] hover:text-fg">
            {l}
          </div>
        ))}
        {filtered.length === 0 && selected && (
          <div className="p-2 text-fg-subtle">Waiting for output...</div>
        )}
        {!selected && sources.length > 0 && (
          <div className="p-2 text-fg-subtle">Select a source to begin streaming.</div>
        )}
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'amber';
}) {
  const cls =
    tone === 'green'
      ? 'border-emerald-300/25 bg-emerald-400/10'
      : tone === 'amber'
        ? 'border-amber-300/25 bg-amber-400/10'
        : 'border-white/10 bg-white/[0.04]';

  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs ${cls}`}>
      <span className="text-fg-muted">{label}</span>
      <span className="ml-2 font-medium text-fg">{value}</span>
    </span>
  );
}
