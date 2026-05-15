'use client';

import { useEffect, useRef } from 'react';
import { useMetrics } from './store';
import type { Snapshot } from './types';

/**
 * Returns the WebSocket base URL using the SAME origin as the page.
 *
 * In dev (Next.js) we rely on the rewrite rules in next.config.mjs to proxy
 * /ws/* (and /api/*) to the Go backend on :8080. This keeps the browser
 * same-origin with the page, so cookies are sent automatically and CORS is
 * not in play.
 *
 * In production the static export is served by Go on the same origin.
 */
export function wsBase(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_BASE?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

/**
 * Builds a full WebSocket URL. We also append the sm_token cookie value as
 * a `token=` query parameter when it's readable, as a belt-and-braces
 * fallback in case the browser strips cookies on the WS upgrade (some
 * SameSite=Lax browsers do this on dev rewrites).
 */
export function wsUrl(path: string): string {
  const base = wsBase();
  const url = new URL(path, base);
  if (typeof document !== 'undefined') {
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
