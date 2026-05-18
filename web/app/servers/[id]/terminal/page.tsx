'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { Terminal as TerminalIcon } from 'lucide-react';
import HostShellTerminal from './host-shell-terminal';

export default function TerminalPage() {
  const params = useParams<{ id: string | string[] }>();
  const serverId = (Array.isArray(params?.id) ? params.id[0] : params?.id) ?? '';

  // Fixed-viewport flex column: topbar (h-16 = 64px) + main padding
  // (p-4/p-6/p-8 → 32/48/64px total) leave the rest for content. We size the
  // outer wrapper exactly so the terminal can flex-1 into it instead of
  // overflowing past the bottom of the page.
  return (
    <div className="flex h-[calc(100vh-96px)] flex-col gap-4 overflow-hidden sm:h-[calc(100vh-112px)] lg:h-[calc(100vh-128px)]">
      <PageHeader
        eyebrow="Host"
        title="Terminal"
        description="Interactive shell on the agent host, running as the agent user. Use with care."
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/10 bg-bg/80 shadow-glow">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-2 text-xs text-fg-muted">
          <TerminalIcon className="size-3.5 text-accent" />
          <span>Live PTY · stdin/stdout streamed over WebSocket</span>
        </div>
        <div className="min-h-0 flex-1">
          {serverId ? (
            <HostShellTerminal serverId={serverId} />
          ) : (
            <div className="p-6 text-sm text-fg-muted">No server selected.</div>
          )}
        </div>
      </div>
    </div>
  );
}
