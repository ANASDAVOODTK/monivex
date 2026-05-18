'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { Terminal as TerminalIcon } from 'lucide-react';
import HostShellTerminal from './host-shell-terminal';

export default function TerminalPage() {
  const params = useParams<{ id: string | string[] }>();
  const serverId = (Array.isArray(params?.id) ? params.id[0] : params?.id) ?? '';

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Host"
        title="Terminal"
        description="Interactive shell on the agent host, running as the agent user. Use with care."
      />
      <div className="overflow-hidden rounded-lg border border-white/10 bg-bg/80 shadow-glow">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-xs text-fg-muted">
          <TerminalIcon className="size-3.5 text-accent" />
          <span>Live PTY · stdin/stdout streamed over WebSocket</span>
        </div>
        {serverId ? (
          <HostShellTerminal serverId={serverId} />
        ) : (
          <div className="p-6 text-sm text-fg-muted">No server selected.</div>
        )}
      </div>
    </div>
  );
}
