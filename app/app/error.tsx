'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // In real mode this would report to monitoring; never expose secrets.
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-5 py-16">
      <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">Something went wrong</h1>
      <p className="text-body text-muted">
        This page hit an unexpected error. Nothing was sent and no money moved. You can try again.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-sm bg-accent px-4 text-small font-semibold text-accent-fg hover:bg-[var(--fg)] hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Try again
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Go home
        </Link>
      </div>
    </main>
  );
}
