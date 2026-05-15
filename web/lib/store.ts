'use client';

import { create } from 'zustand';
import type { Snapshot } from './types';

export interface HistoryPoint {
  t: number; // unix ms
  cpu: number;
  mem: number;
  gpu: number; // first GPU util, or 0
  netRx: number;
  netTx: number;
}

interface ServerSlice {
  current: Snapshot | null;
  history: HistoryPoint[];
  connected: boolean;
}

const emptySlice: ServerSlice = { current: null, history: [], connected: false };

interface MetricsState {
  byServer: Record<string, ServerSlice>;
  setSnapshot: (serverId: string, s: Snapshot) => void;
  setConnected: (serverId: string, c: boolean) => void;
  resetServer: (serverId: string) => void;
}

const MAX_HISTORY = 120; // ~2 min at 1s

function ensureSlice(state: MetricsState, serverId: string): ServerSlice {
  return state.byServer[serverId] ?? { ...emptySlice };
}

export const useMetricsStore = create<MetricsState>((set) => ({
  byServer: {},
  setSnapshot: (serverId, s) =>
    set((state) => {
      const slice = ensureSlice(state, serverId);
      const hp: HistoryPoint = {
        t: new Date(s.timestamp).getTime(),
        cpu: s.cpu?.overall ?? 0,
        mem: s.memory?.used_percent ?? 0,
        gpu: s.gpus?.[0]?.utilization ?? 0,
        netRx: (s.network ?? []).reduce((a, n) => a + (n.recv_rate || 0), 0),
        netTx: (s.network ?? []).reduce((a, n) => a + (n.send_rate || 0), 0),
      };
      const next = [...slice.history, hp];
      if (next.length > MAX_HISTORY) next.shift();
      return {
        byServer: {
          ...state.byServer,
          [serverId]: { ...slice, current: s, history: next },
        },
      };
    }),
  setConnected: (serverId, c) =>
    set((state) => {
      const slice = ensureSlice(state, serverId);
      return {
        byServer: {
          ...state.byServer,
          [serverId]: { ...slice, connected: c },
        },
      };
    }),
  resetServer: (serverId) =>
    set((state) => {
      const next = { ...state.byServer };
      delete next[serverId];
      return { byServer: next };
    }),
}));

/** Per-server hook. Returns the slice (current/history/connected) for one server. */
export function useServerMetrics(serverId: string): ServerSlice {
  return useMetricsStore((s) => s.byServer[serverId] ?? emptySlice);
}
