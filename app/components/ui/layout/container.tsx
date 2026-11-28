'use client';

import type { ReactNode } from 'react';

import { cn } from '../utils';

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('page-container mx-auto min-w-0 w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 md:px-8 md:py-12', className)}>{children}</div>;
}

export function TechnicalDetails({
  children,
  summary = 'Technical details',
  className,
}: {
  children: ReactNode;
  summary?: string;
  className?: string;
}) {
  return (
    <details className={cn('technical-details group min-w-0 rounded-sm border border-border bg-[var(--surface-2)]', className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-small font-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
        {summary}
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0 transition-transform duration-fast group-open:rotate-180">
          <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-border px-4 py-3 text-small text-muted">{children}</div>
    </details>
  );
}
