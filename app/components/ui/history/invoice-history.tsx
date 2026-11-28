'use client';

import type { PublicKey } from '@solana/web3.js';

import { Badge } from '../badge';
import { Button } from '../button';
import { ExplorerLink } from '../explorer-link';
import { formatTimestamp } from '../invoice/fields';
import { isMock } from '../sdk/client';
import { formatUsdc } from '../sdk/format';
import { Skeleton } from '../skeleton';
import type { HistoryEntry } from './history';
import { useInvoiceHistory } from './use-invoice-history';

function AmountCell({ entry }: { entry: HistoryEntry }) {
  if (entry.amount === null) return <span className="text-small text-muted">No amount</span>;
  const abs = entry.amount < 0n ? -entry.amount : entry.amount;
  const direction =
    entry.amountSource === 'args'
      ? entry.action === 'create_invoice'
        ? 'requested'
        : 'sent (from the instruction)'
      : entry.amount < 0n
        ? 'out of escrow'
        : 'into escrow';
  return (
    <span className="flex flex-col">
      <span className="font-mono tabular-nums text-body text-fg">{formatUsdc(abs)}</span>
      <span className="text-micro text-muted">{direction}</span>
    </span>
  );
}

export function InvoiceHistory({ invoicePda, compact = false }: { invoicePda: PublicKey; compact?: boolean }) {
  const { data, error, loading, refresh } = useInvoiceHistory(invoicePda);

  if (error && !data) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-sm border-l-4 border-[var(--warning)] bg-[var(--surface-2)] p-4">
        <p className="text-small font-semibold text-fg">We couldn&apos;t load the history from Solana.</p>
        <p className="text-small text-muted">The network didn&apos;t answer. Nothing changed on the invoice. Try again in a moment.</p>
        <Button variant="secondary" size="sm" onClick={refresh} loading={loading}>Try again</Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading history">
        <Skeleton className="h-12 w-full rounded-sm" />
        <Skeleton className="h-12 w-full rounded-sm" />
      </div>
    );
  }

  if (data.entries.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-[var(--surface-2)] p-4">
        <p className="text-small text-muted">No Paytruth transactions found for this invoice yet.</p>
        <Button variant="ghost" size="sm" onClick={refresh} loading={loading}>Refresh</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col" aria-label="Invoice history, newest first">
        {data.entries.map((e, i) => (
          <li key={`${e.signature}-${e.action}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            <span aria-hidden="true" className="flex flex-col items-center">
              <span className={'mt-1.5 h-2.5 w-2.5 rounded-pill ' + (e.ok ? 'bg-[var(--accent)]' : 'bg-[var(--danger)]')} />
              {i < data.entries.length - 1 ? <span className="mt-1 w-px flex-1 bg-[var(--border)]" /> : null}
            </span>
            <div className={'flex min-w-0 flex-1 flex-col gap-1 ' + (compact ? '' : 'sm:flex-row sm:items-start sm:justify-between sm:gap-4')}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-small font-semibold text-fg">{e.label}</span>
                  {!e.ok ? <Badge variant="danger">Failed — no effect</Badge> : null}
                  {e.demo ? <Badge variant="default">Demo</Badge> : null}
                </span>
                <span className="text-small text-muted">
                  {e.blockTime ? formatTimestamp(BigInt(e.blockTime)) : 'Time unknown'}
                </span>
                {!e.ok && e.errorMessage ? <span className="break-words text-small text-muted">{e.errorMessage}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {e.ok ? <AmountCell entry={e} /> : null}
                {!e.demo ? <ExplorerLink signature={e.signature}>Explorer</ExplorerLink> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-micro text-muted">
          {data.truncated ? 'Showing the latest 25 transactions. ' : ''}
          Amounts come from the escrow balance change in each transaction, or from the instruction itself where marked.
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} loading={loading}>Refresh history</Button>
      </div>
    </div>
  );
}

export function HistorySection({ invoicePda }: { invoicePda: PublicKey }) {
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5 shadow-panel">
      <h2 id="history-heading" className="font-display text-title font-bold text-fg">History</h2>
      <p className="text-small text-muted">
        {isMock ? 'Demo mode: simulated history, nothing here is on Solana.' : 'Every Paytruth transaction on this invoice, read from Solana devnet.'}
      </p>
      <InvoiceHistory invoicePda={invoicePda} />
    </section>
  );
}
