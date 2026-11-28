import type { ReactNode } from 'react';

import { formatUsdc } from '../sdk/format';
import { cn } from '../utils';

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-sm border border-border bg-[var(--surface-2)] px-4 py-3', className)}>
      <dt className="text-micro font-semibold uppercase tracking-[0.08em] text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere] text-body text-fg">{children}</dd>
    </div>
  );
}

export function Money({ value, className }: { value: bigint; className?: string }) {
  return <span className={cn('font-mono tabular-nums text-body [overflow-wrap:anywhere]', className)}>{formatUsdc(value)}</span>;
}

export function formatTimestamp(seconds: bigint): string {
  if (seconds <= 0n) return '—';
  const date = new Date(Number(seconds) * 1000);
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDate(seconds: bigint): string {
  if (seconds <= 0n) return '—';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(Number(seconds) * 1000));
}
