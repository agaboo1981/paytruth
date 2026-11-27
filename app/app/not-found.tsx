import Link from 'next/link';

import { Container } from '@/components/ui/layout/container';

export default function NotFound() {
  return (
    <Container className="flex max-w-[640px] flex-col gap-4 py-16">
      <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">Page not found</h1>
      <p className="text-body text-muted">
        We couldn&apos;t find this page. It may have moved, or the link is wrong.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-sm bg-accent px-4 text-small font-semibold text-accent-fg hover:bg-[var(--fg)] hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Go home
        </Link>
        <Link href="/verify" className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Verify an invoice
        </Link>
      </div>
    </Container>
  );
}
