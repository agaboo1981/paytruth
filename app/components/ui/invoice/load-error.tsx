'use client';

import { Badge } from '../badge';
import { Button } from '../button';
import { Container } from '../layout/container';

/**
 * Shown when the invoice could not be READ (RPC down, SDK not wired), as opposed
 * to the account not existing. Never claims anything about payment state.
 */
export function InvoiceUnavailable({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Container className="max-w-[720px]">
      <div role="alert" className="rounded-lg border-l-4 border-[var(--warning)] bg-surface p-6 shadow-panel">
        <Badge variant="warning">Can&apos;t read Solana</Badge>
        <h1 className="mt-3 font-display text-headline font-bold text-fg">We couldn&apos;t load this invoice</h1>
        <p className="mt-2 text-body text-muted">
          The network didn&apos;t answer, so we can&apos;t say whether this invoice is paid. Nothing was sent and no money
          moved. Try again in a moment.
        </p>
        {message ? <p className="mt-2 break-words font-mono text-small text-muted">{message}</p> : null}
        <div className="mt-4">
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </Container>
  );
}
