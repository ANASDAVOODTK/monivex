'use client';

import { ReactNode } from 'react';
import { cn, clampPct } from '@/lib/utils';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  percent?: number;
  accent?: 'indigo' | 'green' | 'amber' | 'red' | 'cyan' | 'violet';
  icon?: ReactNode;
}

const accentMap: Record<NonNullable<Props['accent']>, string> = {
  indigo: 'from-indigo-500/40 to-indigo-500/0 text-indigo-300',
  green: 'from-emerald-500/40 to-emerald-500/0 text-emerald-300',
  amber: 'from-amber-500/40 to-amber-500/0 text-amber-300',
  red: 'from-red-500/40 to-red-500/0 text-red-300',
  cyan: 'from-cyan-500/40 to-cyan-500/0 text-cyan-300',
  violet: 'from-violet-500/40 to-violet-500/0 text-violet-300',
};

const barMap: Record<NonNullable<Props['accent']>, string> = {
  indigo: 'bg-indigo-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  cyan: 'bg-cyan-500',
  violet: 'bg-violet-500',
};

export function StatCard({ label, value, sub, percent, accent = 'indigo', icon }: Props) {
  const pct = percent !== undefined ? clampPct(percent) : undefined;
  return (
    <div className="card card-pad relative overflow-hidden">
      <div className={cn('absolute inset-x-0 -top-12 h-24 bg-gradient-to-b blur-2xl opacity-60', accentMap[accent])} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="text-xs text-fg-muted uppercase tracking-wider">{label}</div>
          {icon && <div className={cn('text-fg-muted', accentMap[accent].split(' ').pop())}>{icon}</div>}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
        {pct !== undefined && (
          <div className="mt-3 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', barMap[accent])}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
