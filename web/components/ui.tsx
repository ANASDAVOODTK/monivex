'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, ServerCrash } from 'lucide-react';
import { clampPct, cn } from '@/lib/utils';

type Tone = 'teal' | 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'cyan' | 'neutral';

const toneText: Record<Tone, string> = {
  teal: 'text-teal-300',
  blue: 'text-blue-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  violet: 'text-violet-300',
  cyan: 'text-cyan-300',
  neutral: 'text-fg-muted',
};

const toneBg: Record<Tone, string> = {
  teal: 'bg-teal-400',
  blue: 'bg-blue-400',
  green: 'bg-emerald-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  violet: 'bg-violet-400',
  cyan: 'bg-cyan-400',
  neutral: 'bg-fg-subtle',
};

const toneSoft: Record<Tone, string> = {
  teal: 'bg-teal-400/10 text-teal-200 border-teal-300/25',
  blue: 'bg-blue-400/10 text-blue-200 border-blue-300/25',
  green: 'bg-emerald-400/10 text-emerald-200 border-emerald-300/25',
  amber: 'bg-amber-400/10 text-amber-200 border-amber-300/25',
  rose: 'bg-rose-400/10 text-rose-200 border-rose-300/25',
  violet: 'bg-violet-400/10 text-violet-200 border-violet-300/25',
  cyan: 'bg-cyan-400/10 text-cyan-200 border-cyan-300/25',
  neutral: 'bg-white/[0.04] text-fg-muted border-white/10',
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  stats,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  stats?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold text-fg sm:text-3xl">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-sm text-fg-muted">{description}</div>}
        {stats && <div className="mt-4 flex flex-wrap gap-2">{stats}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && <div className="mt-1 text-xs text-fg-muted">{description}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricTile({
  label,
  value,
  detail,
  icon,
  tone = 'teal',
  percent,
  footer,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  percent?: number;
  footer?: ReactNode;
}) {
  const pct = percent == null ? undefined : clampPct(percent);
  return (
    <div className="card card-pad relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-fg">{value}</div>
        </div>
        {icon && (
          <div className={cn('rounded-lg border p-2', toneSoft[tone])}>
            {icon}
          </div>
        )}
      </div>
      {detail && <div className="mt-2 min-h-5 text-xs text-fg-muted">{detail}</div>}
      {pct !== undefined && <ProgressBar value={pct} tone={tone} className="mt-4" />}
      {footer && <div className="mt-4 border-t border-bg-border pt-3 text-xs text-fg-muted">{footer}</div>}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = 'teal',
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = clampPct(value);
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-white/[0.06]', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', toneBg[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function StatusBadge({ state }: { state: string }) {
  const normalized = (state || '').toLowerCase();
  const tone: Tone =
    ['active', 'running', 'online', 'ok', 'healthy'].includes(normalized)
      ? 'green'
      : ['failed', 'dead', 'errored', 'error'].includes(normalized)
        ? 'rose'
        : ['activating', 'deactivating', 'paused', 'restarting', 'launching', 'stopping'].includes(normalized)
          ? 'amber'
          : 'neutral';

  return (
    <span className={cn('badge border', toneSoft[tone])}>
      <span className={cn('size-1.5 rounded-full', toneBg[tone])} />
      {state || '-'}
    </span>
  );
}

export function InfoPill({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs', toneSoft[tone])}>
      {icon}
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </span>
  );
}

export function HealthRing({
  value,
  label,
  tone = 'teal',
}: {
  value: number;
  label: string;
  tone?: Tone;
}) {
  const pct = clampPct(value);
  const color =
    tone === 'green'
      ? '#34d399'
      : tone === 'amber'
        ? '#fbbf24'
        : tone === 'rose'
          ? '#fb7185'
          : tone === 'blue'
            ? '#93c5fd'
            : '#2dd4bf';

  return (
    <div className="flex items-center gap-4">
      <div
        className="grid size-24 place-items-center rounded-full p-2"
        style={{
          background: `conic-gradient(from 190deg, ${color} 0deg, ${color} ${pct * 3.6}deg, rgba(255,255,255,0.09) ${pct * 3.6}deg 360deg)`,
        }}
      >
        <div className="grid size-full place-items-center rounded-full bg-bg-panel text-center">
          <div>
            <div className="text-2xl font-semibold tabular-nums text-fg">{pct.toFixed(0)}</div>
            <div className="text-[10px] uppercase text-fg-subtle">score</div>
          </div>
        </div>
      </div>
      <div>
        <div className={cn('text-sm font-medium', toneText[tone])}>{label}</div>
        <div className="mt-1 text-xs leading-5 text-fg-muted">CPU, memory, disk, and connectivity blended into one live read.</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon,
}: {
  title: string;
  message?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card card-pad flex min-h-48 flex-col items-center justify-center text-center">
      <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-fg-muted">
        {icon ?? <CircleDashed className="size-5" />}
      </div>
      <div className="text-sm font-semibold text-fg">{title}</div>
      {message && <div className="mt-2 max-w-md text-sm text-fg-muted">{message}</div>}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const icon =
    tone === 'success' ? <CheckCircle2 className="size-4" /> :
    tone === 'warning' ? <AlertTriangle className="size-4" /> :
    tone === 'danger' ? <ServerCrash className="size-4" /> :
    <Info className="size-4" />;
  const cls =
    tone === 'success' ? toneSoft.green :
    tone === 'warning' ? toneSoft.amber :
    tone === 'danger' ? toneSoft.rose :
    toneSoft.neutral;

  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', cls)}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>{children}</div>
    </div>
  );
}
