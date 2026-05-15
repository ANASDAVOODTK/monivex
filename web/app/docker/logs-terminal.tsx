'use client';

import { useEffect, useRef } from 'react';
import { wsUrl } from '@/lib/ws';

export default function DockerLogsTerminal({
  containerId,
}: {
  containerId: string;
}) {
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!termRef.current) return;
    const element = termRef.current;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    let terminal: any;
    let fitAddon: any;
    let ws: WebSocket | null = null;

    function clearReconnectTimer() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function safeWrite(data: unknown) {
      if (!terminal || data == null) return;
      if (data instanceof Uint8Array) {
        terminal.write(data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(data));
        return;
      }
      if (typeof data === 'string') {
        terminal.write(data);
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!disposed) connect();
      }, 1500);
    }

    function logLine(color: string, msg: string) {
      if (!terminal || disposed) return;
      terminal.writeln(`\x1b[${color}m* ${msg}\x1b[0m`);
    }

    async function preflight() {
      // Confirm the backend is reachable + authenticated before the WS upgrade.
      // Same-origin (Next.js dev rewrite proxies to backend), so cookies flow.
      try {
        const res = await fetch('/api/v1/me', {
          credentials: 'include',
        });
        logLine('2;37', `Preflight /api/v1/me → HTTP ${res.status}`);
        if (res.status === 401) {
          logLine('1;31', 'Backend says you are NOT logged in (401). Log out + log in again.');
        }
      } catch (err) {
        logLine('1;31', `Preflight fetch failed: ${(err as Error).message}`);
      }
    }

    function connect() {
      const hasToken = /(?:^|;\s*)sm_token=/.test(document.cookie);
      logLine('2;37', `cookie has sm_token: ${hasToken ? 'yes' : 'NO (cookie is HttpOnly or you are not logged in)'}`);
      if (!hasToken) {
        logLine('1;33', 'No sm_token cookie visible to JS. WS auth will fail with 401.');
        logLine('2;37', '  Fix: clear cookies in DevTools → Application → Cookies, then log out + log in.');
      }

      let url: string;
      try {
        url = wsUrl(`/ws/docker/logs/${encodeURIComponent(containerId)}?tail=200`);
      } catch (err) {
        logLine('1;31', `Failed to build URL: ${(err as Error).message}`);
        return;
      }
      logLine('2;37', `URL: ${url}`);
      logLine('2;37', `page origin: ${window.location.origin}`);

      preflight();

      let constructed: WebSocket;
      try {
        constructed = new WebSocket(url);
      } catch (err) {
        logLine('1;31', `WebSocket constructor failed: ${(err as Error).message}`);
        return;
      }
      ws = constructed;
      ws.binaryType = 'arraybuffer';
      logLine('2;37', `readyState=${ws.readyState} (CONNECTING=0)`);

      const ticks = [2000, 5000, 10000, 20000];
      const tickHandles: ReturnType<typeof setTimeout>[] = [];
      for (const ms of ticks) {
        tickHandles.push(setTimeout(() => {
          if (disposed || !ws) return;
          if (ws.readyState === WebSocket.CONNECTING) {
            logLine('1;33', `Still CONNECTING after ${ms / 1000}s (readyState=${ws.readyState}). No onopen / onerror / onclose fired yet.`);
          }
        }, ms));
      }
      function clearTicks() { tickHandles.forEach(clearTimeout); }

      ws.onopen = () => {
        clearTicks();
        if (disposed) return;
        logLine('1;32', 'Connected. Streaming logs...');
        terminal.writeln('');
      };

      ws.onmessage = async (ev) => {
        if (disposed) return;
        if (ev.data instanceof Blob) {
          safeWrite(await ev.data.text());
          return;
        }
        safeWrite(ev.data);
      };

      ws.onerror = (ev) => {
        clearTicks();
        if (disposed) return;
        console.error('docker logs ws error', ev);
        logLine('1;31', 'Connection error (browser blocked or refused; see DevTools console / Network → WS).');
      };

      ws.onclose = (ev) => {
        clearTicks();
        if (disposed) return;
        const reason = ev.reason ? ` reason="${ev.reason}"` : '';
        logLine('1;33', `Closed (code=${ev.code} clean=${ev.wasClean}${reason}).`);
        if (ev.code === 1006) {
          logLine('2;37', '  code 1006 = abnormal closure: backend not reachable, refused, or terminated handshake.');
        } else if (ev.code === 1008 || ev.code === 4401) {
          logLine('2;37', '  policy/auth violation: token missing or invalid.');
        }
        logLine('2;37', 'Reconnecting in 1.5s...');
        scheduleReconnect();
      };
    }

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      terminal = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        theme: {
          background: '#08090d',
          foreground: '#edf2f7',
          cursor: '#2dd4bf',
          cursorAccent: '#08090d',
          selectionBackground: 'rgba(45, 212, 191, 0.28)',
          black: '#08090d',
          red: '#f43f5e',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#60a5fa',
          magenta: '#a78bfa',
          cyan: '#38bdf8',
          white: '#edf2f7',
          brightBlack: '#647181',
          brightRed: '#fb7185',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#93c5fd',
          brightMagenta: '#c4b5fd',
          brightCyan: '#67e8f9',
          brightWhite: '#ffffff',
        },
        scrollback: 15000,
        convertEol: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(element);
      fitAddon.fit();

      terminal.writeln('\x1b[1;36m* Connecting to log stream... (diag v3)\x1b[0m');
      terminal.writeln('\x1b[2;37m* If you only see this line, your dev frontend was not restarted.\x1b[0m');
      connect();

      resizeObserver = new ResizeObserver(() => {
        if (!disposed) fitAddon.fit();
      });
      resizeObserver.observe(element);

      terminal.focus();
    }

    init().catch((err) => {
      console.error('docker logs terminal init failed', err);
    });

    return () => {
      disposed = true;
      clearReconnectTimer();
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (ws) {
        // Detach handlers so a queued open/close on a torn-down instance
        // can't write to a disposed terminal.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        ws = null;
      }
      if (terminal) {
        terminal.dispose();
      }
    };
  }, [containerId]);

  return (
    <div
      ref={termRef}
      className="w-full"
      style={{ height: '420px', padding: '10px', background: '#08090d' }}
    />
  );
}
