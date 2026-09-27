'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

function serverIdFromPath(path: string): string {
  const m = path.match(/\/servers\/([^/]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

/**
 * Returns the current server id parsed from the URL path (/servers/<id>/...).
 *
 * Why not useParams()? The production build is a Next.js static export. The
 * dynamic /servers/[id] route is pre-rendered against a single sentinel param
 * `_` (see app/servers/[id]/layout.tsx). The Go SPA handler then serves that
 * `_` HTML for ANY /servers/<real-id> request — so useParams() reports `_`,
 * not the real id, and every per-server API/WebSocket call targets a server
 * that doesn't exist.
 *
 * window.location.pathname always holds the true URL, so we parse the id from
 * there — already on the FIRST render. Returning '' first and filling the id
 * in after mount made pages fire their initial API calls against
 * /servers//..., which the hub answers with "server not found". Reading the
 * URL during render is hydration-safe here because every caller sits behind
 * DashboardShell's auth gate: it only mounts its children client-side, after
 * hydration, so there is no pre-rendered HTML for this value to mismatch.
 * usePathname() keeps the id in sync on client-side navigation.
 */
export function useServerId(): string {
  const pathname = usePathname();
  const [id, setId] = useState(() =>
    typeof window !== 'undefined' ? serverIdFromPath(window.location.pathname) : '',
  );

  useEffect(() => {
    setId(serverIdFromPath(window.location.pathname));
  }, [pathname]);

  return id;
}
