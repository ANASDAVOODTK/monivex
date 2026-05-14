'use client';

import { useEffect, useRef } from 'react';
import { wsBase } from '@/lib/ws';

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

    function connect() {
      const url = `${wsBase()}/ws/docker/logs/${encodeURIComponent(containerId)}?tail=200`;
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (disposed) return;
        terminal.writeln('\x1b[1;32m* Connected. Streaming logs...\x1b[0m\r\n');
      };

      ws.onmessage = async (ev) => {
        if (disposed) return;
        if (ev.data instanceof Blob) {
          safeWrite(await ev.data.text());
          return;
        }
        safeWrite(ev.data);
      };

      ws.onerror = () => {
        if (disposed) return;
        terminal.writeln('\r\n\x1b[1;31m* Connection error.\x1b[0m');
      };

      ws.onclose = () => {
        if (disposed) return;
        terminal.writeln('\r\n\x1b[1;33m* Log stream disconnected. Reconnecting...\x1b[0m');
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

      terminal.writeln('\x1b[1;36m* Connecting to log stream...\x1b[0m');
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
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
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
