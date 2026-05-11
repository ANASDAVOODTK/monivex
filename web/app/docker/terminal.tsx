'use client';

import { useEffect, useRef } from 'react';

// Dynamically imported to avoid SSR issues with xterm
export default function DockerExecTerminal({
  containerId,
  onClose,
}: {
  containerId: string;
  onClose: () => void;
}) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || !termRef.current) return;
    initRef.current = true;

    let terminal: any;
    let fitAddon: any;
    let ws: WebSocket;

    async function init() {
      // Dynamic import to avoid SSR
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      // Import CSS
      await import('@xterm/xterm/css/xterm.css');

      terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        theme: {
          background: '#0b0d10',
          foreground: '#e6e8ee',
          cursor: '#6366f1',
          cursorAccent: '#0b0d10',
          selectionBackground: 'rgba(99, 102, 241, 0.35)',
          black: '#0b0d10',
          red: '#ef4444',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#6366f1',
          magenta: '#8b5cf6',
          cyan: '#06b6d4',
          white: '#e6e8ee',
          brightBlack: '#5d667a',
          brightRed: '#f87171',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#818cf8',
          brightMagenta: '#a78bfa',
          brightCyan: '#22d3ee',
          brightWhite: '#ffffff',
        },
        scrollback: 5000,
        convertEol: true,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current!);
      fitAddon.fit();

      terminal.writeln('\x1b[1;34m● Connecting to container...\x1b[0m');

      // Connect WebSocket
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${window.location.host}/ws/docker/exec/${encodeURIComponent(containerId)}`;
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        terminal.writeln('\x1b[1;32m● Connected.\x1b[0m\r\n');
        // Send initial resize
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
        terminal.writeln('\r\n\x1b[1;31m● Connection error.\x1b[0m');
      };

      ws.onclose = () => {
        terminal.writeln('\r\n\x1b[1;33m● Session ended.\x1b[0m');
      };

      // Terminal input → WebSocket as binary
      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          const encoder = new TextEncoder();
          ws.send(encoder.encode(data));
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        }
      });
      resizeObserver.observe(termRef.current!);

      terminal.focus();

      // Store cleanup ref
      (termRef.current as any)._cleanup = () => {
        resizeObserver.disconnect();
        ws.close();
        terminal.dispose();
      };
    }

    init();

    return () => {
      if (termRef.current && (termRef.current as any)._cleanup) {
        (termRef.current as any)._cleanup();
      }
    };
  }, [containerId]);

  return (
    <div
      ref={termRef}
      className="w-full"
      style={{ height: '400px', padding: '8px', background: '#0b0d10' }}
    />
  );
}
