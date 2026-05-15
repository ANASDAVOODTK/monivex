'use client';

import { useEffect, useRef } from 'react';
import { wsUrl } from '@/lib/ws';

export default function DockerExecTerminal({
  containerId,
  shell = 'auto',
  onClose,
}: {
  containerId: string;
  shell?: 'auto' | 'bash' | 'sh';
  onClose: () => void;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || !termRef.current) return;
    initRef.current = true;
    const element = termRef.current;

    let terminal: any;
    let fitAddon: any;
    let ws: WebSocket;

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      terminal = new Terminal({
        cursorBlink: true,
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
        scrollback: 5000,
        convertEol: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(element);
      fitAddon.fit();

      terminal.writeln('\x1b[1;36m* Connecting to container...\x1b[0m');

      const q = new URLSearchParams({ shell });
      const url = wsUrl(`/ws/docker/exec/${encodeURIComponent(containerId)}?${q}`);
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        terminal.writeln('\x1b[1;32m* Connected.\x1b[0m\r\n');
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(ev.data));
        } else {
          terminal.write(ev.data);
        }
      };

      ws.onerror = () => {
        terminal.writeln('\r\n\x1b[1;31m* Connection error.\x1b[0m');
      };

      ws.onclose = () => {
        terminal.writeln('\r\n\x1b[1;33m* Session ended.\x1b[0m');
      };

      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          const encoder = new TextEncoder();
          ws.send(encoder.encode(data));
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        }
      });
      resizeObserver.observe(element);

      terminal.focus();

      (element as any)._cleanup = () => {
        resizeObserver.disconnect();
        ws.close();
        terminal.dispose();
      };
    }

    init();

    return () => {
      if ((element as any)._cleanup) {
        (element as any)._cleanup();
      }
    };
  }, [containerId, shell]);

  return (
    <div
      ref={termRef}
      className="w-full"
      style={{ height: '420px', padding: '10px', background: '#08090d' }}
    />
  );
}
