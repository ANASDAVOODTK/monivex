'use client';

import { useEffect, useRef } from 'react';
import { useMetrics } from './store';
import type { Snapshot } from './types';

/**
 * Returns the WebSocket base URL (e.g. "ws://localhost:8080").
 * In dev mode Next.js runs on port 3000 while the Go backend is on 8080,
 * and Next.js rewrite rules can't proxy WebSocket upgrades. So we connect
 * directly to the backend host. In production the static export is served
 * by Go, so window.location.host is correct.
 */
export function wsBase(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = process.env.NODE_ENV === 'development'
    ? window.location.hostname + ':8080'
    : window.location.host;
  return `${proto}://${host}`;
}

/**
 * Builds a full WebSocket URL with auth token appended when needed.
 * In dev mode the WS goes cross-origin (port 3000 → 8080) so the browser
 * won't send cookies; we read sm_token from document.cookie and pass it
 * as a query parameter instead.
 */
export function wsUrl(path: string): string {
  const base = wsBase();
  const url = new URL(path, base);
  if (process.env.NODE_ENV === 'development') {
    const match = document.cookie.match(/(?:^|;\s*)sm_token=([^;]+)/);
    if (match) {
      url.searchParams.set('token', match[1]);
    }
  }
  return url.toString();
}

export function useMetricsSocket() {
  const setSnapshot = useMetrics((s) => s.setSnapshot);
  const setConnected = useMetrics((s) => s.setConnected);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const connect = () => {
      if (cancelledRef.current) return;
      const ws = new WebSocket(wsUrl('/ws/metrics'));
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as Snapshot;
          setSnapshot(data);
        } catch {
          /* ignore */
        }
      };
      ws.onerror = () => {
        ws.close();
      };
      ws.onclose = () => {
        setConnected(false);
        if (cancelledRef.current) return;
        retryRef.current = Math.min(retryRef.current + 1, 6);
        const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      cancelledRef.current = true;
      wsRef.current?.close();
    };
  }, [setSnapshot, setConnected]);
}

export function openLogSocket(path: string, onLine: (line: string) => void, onError: (msg: string) => void): WebSocket {
  const ws = new WebSocket(wsUrl(`/ws/logs?path=${encodeURIComponent(path)}`));
  ws.onmessage = (ev) => {
    try {
      const f = JSON.parse(ev.data) as { type: string; line?: string; err?: string };
      if (f.type === 'line' && f.line !== undefined) onLine(f.line);
      else if (f.type === 'error' && f.err) onError(f.err);
    } catch {
      /* ignore */
    }
  };
  return ws;
}
