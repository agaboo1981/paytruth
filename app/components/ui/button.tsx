'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from './utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg border border-accent hover:bg-[var(--fg)] hover:border-[var(--fg)] hover:text-[var(--bg)]',
  secondary:
    'bg-surface text-fg border border-border hover:bg-[var(--surface-2)] hover:border-[var(--accent)]',
  ghost:
    'bg-transparent text-fg border border-transparent hover:bg-[var(--surface-2)] hover:border-[var(--border)]',
  danger:
    'bg-danger text-danger-fg border border-danger hover:bg-[var(--fg)] hover:border-[var(--fg)] hover:text-[var(--bg)]',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 text-small gap-1.5',
  md: 'min-h-11 px-4 text-body gap-2',
  lg: 'min-h-12 px-5 text-body gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center justify-center py-2 text-center rounded-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,transform] duration-fast active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="kit-spinner" aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
});
