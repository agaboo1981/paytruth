'use client';

import { invoicePath, useInvoiceParam } from '@/lib/routes';

import { InvoiceUnavailable } from '@/components/ui/invoice/load-error';

import { isMock } from '@/components/ui/sdk/client';

import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';

import { Address } from '@/components/ui/address';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { CopyLink } from '@/components/ui/invoice/copy-link';
import { Field, formatTimestamp, Money } from '@/components/ui/invoice/fields';
import { Container, TechnicalDetails } from '@/components/ui/layout/container';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { derivedView, decodeMemo } from '@/components/ui/sdk/format';
import { HistorySection } from '@/components/ui/history/invoice-history';
import { useInvoiceView } from '@/components/ui/sdk/use-invoice-view';
import { InvoiceStatus } from '@/components/ui/sdk/types';

type Verdict = {
  heading: string;
  body: string;
  variant: NonNullable<BadgeProps['variant']>;
  tone: string;
  badge?: string;
};

function verdictFor(
  invoice: NonNullable<ReturnType<typeof useInvoiceView>['invoice']>,
  finalized: boolean,
  escrow: bigint,
): Verdict {
  if (invoice.status === InvoiceStatus.Closed) {
    return {
      heading: 'Closed',
      body: 'The merchant closed this invoice after it was settled. Nothing more can happen to it.',
      variant: 'default',
      tone: 'border-border',
      badge: 'Closed',
    };
  }
  if (!finalized) {
    return {
      heading: 'Paid — confirming…',
      body: 'A payment is showing but not yet finalized. Refresh in a few seconds for a verdict you can rely on.',
      variant: 'pending',
      tone: 'border-[var(--pending)]',
    };
  }
  if (invoice.status === InvoiceStatus.Paid) {
    return {
      heading: invoice.claimed ? 'Paid & claimed' : 'Paid & final',
      body: invoice.claimed
        ? 'The merchant has claimed this payment on-chain. The record is final.'
        : 'The invoice was paid in full and the payment is final on Solana.',
      variant: 'success',
      tone: 'border-[var(--success)]',
    };
  }
  if (invoice.status === InvoiceStatus.Expired) {
    return {
      heading: 'Expired — not paid',
      body: 'This invoice expired without a valid payment. No money moved.',
      variant: 'default',
      tone: 'border-[var(--danger)]',
    };
  }
  if (escrow > 0n) {
    return {
      heading: 'Not paid yet',
      body: 'The invoice is open. No payment has been recorded into escrow.',
      variant: 'warning',
      tone: 'border-[var(--warning)]',
    };
  }
  return {
    heading: 'Not paid yet',
    body: 'The invoice is open and waiting for a payment.',
    variant: 'warning',
    tone: 'border-[var(--warning)]',
  };
}

export function InvoiceDetail() {
  const invoicePda = useInvoiceParam();
  const view = useInvoiceView(invoicePda);

  if (!invoicePda) {
    return (
      <Container className="max-w-[720px]">
        <div role="alert" className="rounded-lg border border-[var(--danger)] bg-surface p-6">
          <h1 className="font-display text-headline font-bold text-fg">That address isn&apos;t valid</h1>
          <p className="mt-2 text-body text-muted">
            An invoice address must be a 32-byte base58 Solana address. Check the link or paste it again.
          </p>
          <Link href="/verify" className="mt-4 inline-flex min-h-11 items-center text-small font-semibold text-accent hover:underline">
            Try another address
          </Link>
        </div>
      </Container>
    );
  }

  // Skeleton only on the first load: background refetches keep the page (and any
  // in-flight transaction status) mounted.
  if (view.loading && !view.invoice && !view.error) {
    return (
      <Container className="flex max-w-[720px] flex-col gap-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </Container>
    );
  }

  if (view.errorKind === 'unavailable') {
    return <InvoiceUnavailable message={view.error?.message} onRetry={view.refresh} />;
  }

  if (view.error || !view.invoice) {
    return (
      <Container className="max-w-[720px]">
        <div role="status" className="rounded-lg border border-border bg-surface p-6 shadow-panel">
          <Badge variant="default">Not found</Badge>
          <h1 className="mt-3 font-display text-headline font-bold text-fg">No invoice at this address</h1>
          <p className="mt-2 text-body text-muted">
            It may have been closed by the merchant (closing removes the account), or the link is wrong.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/verify" className="inline-flex min-h-11 items-center rounded-sm border border-[var(--accent)] px-4 text-small font-semibold text-accent hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Verify another invoice
            </Link>
          </div>
          <TechnicalDetails className="mt-4">
            <span className="break-all font-mono">{invoicePda.toBase58()}</span>
          </TechnicalDetails>
        </div>
      </Container>
    );
  }

  const invoice = view.invoice;
  const finalized = view.finalized;
  const verdict = verdictFor(invoice, finalized, view.escrowBalance ?? 0n);
  const memo = decodeMemo(invoice.memo);
  const derived = derivedView(invoice, Math.floor(Date.now() / 1000), view.escrowBalance ?? 0n);
  const readAt = new Date().toLocaleString('en', { dateStyle: 'medium', timeStyle: 'medium' });

  return (
    <Container className="flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">Invoice verdict</h1>
        <CopyLink path={invoicePath('verify', invoicePda.toBase58())} label="Copy link" />
      </div>

      <section
        aria-label="Verdict"
        className={`rounded-lg border-l-4 bg-surface p-6 shadow-panel ${verdict.tone} ${finalized ? '' : 'motion-status'}`}
      >
        <Badge variant={verdict.variant}>
          {verdict.badge ?? (finalized ? 'Final' : 'Confirming')}
        </Badge>
        <h2 className="mt-3 font-display text-headline font-bold tracking-[-0.03em] text-fg">{verdict.heading}</h2>
        <p className="mt-2 max-w-[60ch] text-body text-muted">{verdict.body}</p>
        <button
          type="button"
          onClick={view.refresh}
          className="mt-4 inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Refresh
        </button>
      </section>

      <section aria-labelledby="fields-heading" className="flex flex-col gap-3">
        <h2 id="fields-heading" className="font-display text-title font-bold text-fg">On-chain details</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label="Status"><span className="font-semibold">{['Open', 'Paid', 'Expired', 'Closed'][invoice.status]}</span></Field>
          <Field label="Merchant"><Address address={invoice.merchant.toBase58()} /></Field>
          <Field label="Paid by">
            {invoice.payer.equals(PublicKey.default) ? 'Not paid yet' : <Address address={invoice.payer.toBase58()} />}
          </Field>
          <Field label="Amount due"><Money value={invoice.amountDue} /></Field>
          <Field label="Paid"><Money value={invoice.paidAmount} /></Field>
          <Field label="Extra"><Money value={derived.excess} /></Field>
          <Field label="Refunded"><Money value={invoice.refundedExcess} /></Field>
          <Field label="Claimed"><span className="font-semibold">{invoice.claimed ? 'Yes' : 'No'}</span></Field>
          <Field label="Expires">{formatTimestamp(invoice.expiresAt)}</Field>
          <Field label="Escrow balance"><Money value={view.escrowBalance ?? 0n} /></Field>
          <Field label="Description" className="sm:col-span-2">{memo || '—'}</Field>
        </dl>
      </section>

      <div className="print:break-inside-avoid">
        <HistorySection invoicePda={invoicePda} />
      </div>

      <section aria-labelledby="trust-heading" className="flex flex-col gap-3 rounded-md border border-border bg-[var(--surface-2)] p-5">
        <h2 id="trust-heading" className="font-display text-title font-bold text-fg">Why you can trust this</h2>
        <p className="text-small text-muted">
          {isMock
            ? 'Demo mode: these values come from the in-browser simulator, not Solana. In the live app this page reads the invoice account and escrow balance straight from the Solana devnet program.'
            : 'This page reads the invoice account and escrow balance straight from the Solana devnet program. There is no server to tell us "paid" — the program is the only source of truth.'}
        </p>
        <dl className="grid gap-2 text-small">
          <div className="flex justify-between gap-3"><dt className="text-muted">Read at</dt><dd className="font-semibold text-fg">{finalized ? 'finalized' : 'confirmed'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{isMock ? 'Read from the demo simulator at' : 'Read directly from Solana devnet at'}</dt><dd className="text-right font-semibold text-fg">{readAt}</dd></div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>Print this page</Button>
        <Link href="/verify" className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Verify another
        </Link>
      </div>

      <TechnicalDetails>
        <dl className="grid gap-2">
          <div className="flex justify-between gap-3"><dt>Invoice address</dt><dd className="break-all font-mono text-fg">{invoicePda.toBase58()}</dd></div>
          <div className="flex justify-between gap-3"><dt>Mint</dt><dd className="break-all font-mono text-fg">{invoice.mint.toBase58()}</dd></div>
          <div className="flex justify-between gap-3"><dt>Invoice number</dt><dd className="font-mono text-fg">{invoice.invoiceId.toString()}</dd></div>
        </dl>
      </TechnicalDetails>
    </Container>
  );
}
