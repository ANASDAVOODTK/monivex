'use client';

import { create } from 'zustand';
import type { Snapshot } from './types';

interface MetricsState {
  current: Snapshot | null;
  history: HistoryPoint[];
  connected: boolean;
  setSnapshot: (s: Snapshot) => void;
  setConnected: (c: boolean) => void;
}

export interface HistoryPoint {
  t: number; // unix ms
  cpu: number;
  mem: number;
  gpu: number; // first GPU util, or 0
  netRx: number;
  netTx: number;
}

const MAX_HISTORY = 120; // ~2 min at 1s

export const useMetrics = create<MetricsState>((set) => ({
  current: null,
  history: [],
  connected: false,
  setSnapshot: (s) =>
    set((state) => {
      const hp: HistoryPoint = {
        t: new Date(s.timestamp).getTime(),
        cpu: s.cpu?.overall ?? 0,
        mem: s.memory?.used_percent ?? 0,
        gpu: s.gpus?.[0]?.utilization ?? 0,
        netRx: (s.network ?? []).reduce((a, n) => a + (n.recv_rate || 0), 0),
        netTx: (s.network ?? []).reduce((a, n) => a + (n.send_rate || 0), 0),
      };
      const next = [...state.history, hp];
      if (next.length > MAX_HISTORY) next.shift();
      return { current: s, history: next };
    }),
  setConnected: (c) => set({ connected: c }),
}));
