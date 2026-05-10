'use client';

import { useEffect, useRef, useState } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { openLogSocket } from '@/lib/ws';
import { Pause, Play, Trash2 } from 'lucide-react';

export default function LogsPage() {
  return (
    <DashboardShell>
      <Logs />
    </DashboardShell>
  );
}

function Logs() {
  const [sources, setSources] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    api.logSources().then(setSources).catch(() => setSources([]));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLines([]);
    const ws = openLogSocket(
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
    return () => { ws.close(); };
  }, [selected]);

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
    <div className="space-y-4 h-full flex flex-col">
      <div>
        <h1 className="text-xl font-semibold">Logs</h1>
        <p className="text-sm text-fg-muted">Tail whitelisted log files in real time.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input max-w-md"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a log file...</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          className="input flex-1 max-w-sm"
          placeholder="Filter lines (substring)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button onClick={() => setPaused((p) => !p)} className="btn-ghost">
          {paused ? <><Play className="size-3.5" /> Resume</> : <><Pause className="size-3.5" /> Pause</>}
        </button>
        <button onClick={() => setLines([])} className="btn-ghost">
          <Trash2 className="size-3.5" /> Clear
        </button>
        <div className="text-xs text-fg-muted ml-auto tabular-nums">{filtered.length} lines</div>
      </div>

      {sources.length === 0 && (
        <div className="card card-pad text-center text-sm text-fg-muted">
          No log sources configured. Add paths to <span className="kbd">logs.allowed_paths</span> in <span className="kbd">config.yaml</span>.
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="card flex-1 overflow-y-auto font-mono text-xs leading-relaxed p-3 min-h-[400px]"
      >
        {filtered.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-all hover:bg-bg-subtle/30 -mx-1 px-1">
            {l}
          </div>
        ))}
        {filtered.length === 0 && selected && (
          <div className="text-fg-subtle">Waiting for output...</div>
        )}
      </div>
    </div>
  );
}
