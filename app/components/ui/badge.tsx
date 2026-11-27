import type { HTMLAttributes } from 'react';

import { cn } from './utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'pending';

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const variants: Record<BadgeVariant, string> = {
  default: 'border-border text-muted',
  success: 'border-[var(--success)] text-success',
  warning: 'border-[var(--warning)] text-warning',
  danger: 'border-[var(--danger)] text-danger',
  pending: 'border-[var(--pending)] text-pending',
};

const dots: Record<BadgeVariant, string> = {
  default: 'bg-[var(--muted)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--danger)]',
  pending: 'bg-[var(--pending)]',
};

export function Badge({ className, variant = 'default', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-pill border bg-[var(--surface-2)] px-2.5 py-1 text-small font-semibold',
        variants[variant],
        className,
      )}
      {...props}
    >
      <span className={cn('h-1.5 w-1.5 rounded-pill', dots[variant])} aria-hidden="true" />
      {children}
    </span>
  );
}
