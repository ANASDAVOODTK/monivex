'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

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
 * there. We return '' on the first render (matching the build-time HTML) and
 * fill in the real id after mount to avoid a hydration mismatch. usePathname()
 * is used as the effect trigger so the id updates on client-side navigation.
 */
export function useServerId(): string {
  const pathname = usePathname();
  const [id, setId] = useState('');

  useEffect(() => {
    const path =
      typeof window !== 'undefined' ? window.location.pathname : pathname ?? '';
    const m = path.match(/\/servers\/([^/]+)/);
    setId(m && m[1] ? decodeURIComponent(m[1]) : '');
  }, [pathname]);

  return id;
}
