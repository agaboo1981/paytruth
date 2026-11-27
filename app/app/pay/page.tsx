'use client';

import { invoicePath, useInvoiceParam } from '@/lib/routes';

import { InvoiceUnavailable } from '@/components/ui/invoice/load-error';

import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';

import { Address } from '@/components/ui/address';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/ui/invoice/countdown';
import { Field, formatDate, Money } from '@/components/ui/invoice/fields';
import { Container, TechnicalDetails } from '@/components/ui/layout/container';
import { Skeleton } from '@/components/ui/skeleton';
import { derivedView, formatUsdc, parseUsdc } from '@/components/ui/sdk/format';
import { sdk as writeSdk } from '@/components/ui/sdk/client';
import { useInvoiceView } from '@/components/ui/sdk/use-invoice-view';
import { InvoiceStatus } from '@/components/ui/sdk/types';
import { decodeMemo } from '@/components/ui/sdk/format';
import { TxStatus } from '@/components/ui/tx/tx-status';
import { useTxAction } from '@/components/ui/tx/use-tx-action';

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <Container>
      <div role="alert" className="rounded-lg border border-[var(--danger)] bg-surface p-6">
        <h1 className="font-display text-headline font-bold text-fg">{title}</h1>
        <p className="mt-2 text-body text-muted">{body}</p>
        <Link href="/verify" className="mt-4 inline-flex min-h-11 items-center text-small font-semibold text-accent hover:underline">
          Verify an invoice
        </Link>
      </div>
    </Container>
  );
}

function Summary({
  memo,
  merchant,
  amountDue,
  expiresAt,
}: {
  memo: string;
  merchant: string;
  amountDue: bigint;
  expiresAt: bigint;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-panel md:p-7">
      <div className="flex flex-col gap-1">
        <span className="text-micro font-semibold uppercase tracking-[0.08em] text-muted">Invoice from</span>
        <Address address={merchant} chars={6} />
      </div>
      <p className="font-display text-title font-bold text-fg">{memo || 'Payment request'}</p>
      <div className="flex flex-col gap-1">
        <span className="text-micro font-semibold uppercase tracking-[0.08em] text-muted">Amount due</span>
        <Money value={amountDue} />
      </div>
      <p className="text-small text-muted">
        Expires <Countdown expiresAt={expiresAt} />.
      </p>
    </div>
  );
}

function PayInvoiceInner() {
  const invoicePda = useInvoiceParam();
  const view = useInvoiceView(invoicePda);
  const [showDifferent, setShowDifferent] = useState(false);
  const [customAmount, setCustomAmount] = useState('');

  const payTx = useTxAction(
    async (opts) => {
      if (!invoicePda) throw new Error('Invalid invoice address.');
      const amount = parseUsdc(customAmount) ?? view.invoice?.amountDue ?? 0n;
      if (amount <= 0n) throw new Error('Enter a valid amount.');
      if (!view.invoice) throw new Error('Invoice not loaded.');
      return writeSdk.payInvoice(
        { invoicePda, amount, expectedAmountDue: view.invoice.amountDue },
        opts,
      );
    },
    {
      invoicePda: invoicePda ?? undefined,
      waitFor: (inv) => inv.status === InvoiceStatus.Paid,
    },
  );

  const refundTx = useTxAction(
    async (opts) => {
      if (!invoicePda) throw new Error('Invalid invoice address.');
      return writeSdk.refundOverpayment({ invoicePda }, opts);
    },
    {
      invoicePda: invoicePda ?? undefined,
      waitFor: (inv) => inv.refundedExcess > 0n,
    },
  );

  if (!invoicePda) {
    return <ErrorCard title="That address isn't valid" body="An invoice address must be a 32-byte base58 Solana address. Ask the merchant for a new link." />;
  }

  // Skeleton only on the first load: background refetches keep the page (and any
  // in-flight transaction status) mounted.
  if (view.loading && !view.invoice && !view.error) {
    return (
      <Container className="flex flex-col gap-4">
        <Skeleton className="h-64 w-full rounded-lg" />
      </Container>
    );
  }

  if (view.errorKind === 'unavailable') {
    return <InvoiceUnavailable message={view.error?.message} onRetry={view.refresh} />;
  }

  if (view.error || !view.invoice) {
    return (
      <ErrorCard
        title="No invoice at this address"
        body="It may have been closed by the merchant (closing removes the account), or the link is wrong."
      />
    );
  }

  const invoice = view.invoice;
  const memo = decodeMemo(invoice.memo);
  const now = Math.floor(Date.now() / 1000);
  const derived = derivedView(invoice, now, view.escrowBalance ?? 0n);
  const payLink = invoicePath('pay', invoicePda.toBase58());

  const customParsed = parseUsdc(customAmount);
  const customUnderpay = customParsed !== null && customParsed < invoice.amountDue;
  const customOverpay = customParsed !== null && customParsed > invoice.amountDue;
  const customExtra = customOverpay ? customParsed - invoice.amountDue : 0n;

  const afterPayConfirmed = payTx.state.status === 'confirmed';

  if (invoice.status === InvoiceStatus.Closed) {
    return (
      <Container className="flex max-w-[640px] flex-col gap-5">
        <div role="status" className="rounded-lg border-l-4 border-border bg-surface p-6 shadow-panel">
          <Badge variant="default">Closed</Badge>
          <h1 className="mt-3 font-display text-headline font-bold text-fg">
            This invoice was closed by the merchant
          </h1>
          <p className="mt-2 text-body text-muted">{derived.explanation}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={invoicePath('verify', invoicePda.toBase58())} className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              View on-chain status
            </Link>
          </div>
        </div>
        <Summary memo={memo} merchant={invoice.merchant.toBase58()} amountDue={invoice.amountDue} expiresAt={invoice.expiresAt} />
      </Container>
    );
  }

  // Paid already (or just paid) and no extra outstanding: show paid state, no pay button.
  if (invoice.status === InvoiceStatus.Paid && !afterPayConfirmed) {
    if (derived.excess > 0n && (invoice.refundedExcess === 0n || refundTx.state.status !== 'idle')) {
      return (
        <Container className="flex max-w-[640px] flex-col gap-5">
          <div className="rounded-lg border-l-4 border-[var(--warning)] bg-surface p-6 shadow-panel">
            {refundTx.state.status === 'confirmed' || invoice.refundedExcess > 0n ? (
              <>
                <Badge variant="success">Extra refunded</Badge>
                <h1 className="mt-3 font-display text-headline font-bold text-fg">Your extra {formatUsdc(derived.excess)} was refunded</h1>
                <p className="mt-2 text-body text-muted">It went back to the wallet that paid. Nothing else to do.</p>
              </>
            ) : (
              <>
                <Badge variant="warning">Extra payment</Badge>
                <h1 className="mt-3 font-display text-headline font-bold text-fg">You paid {formatUsdc(derived.excess)} extra</h1>
                <p className="mt-2 text-body text-muted">
                  Get it back. The refund always goes to the wallet that paid, so it&apos;s safe for anyone to trigger.
                </p>
              </>
            )}
            {refundTx.state.status === 'confirmed' ? (
              <div className="mt-4 flex flex-col gap-3">
                <p className="rounded-sm border border-[var(--success)] p-3 text-small font-semibold text-success">
                  Refunded {formatUsdc(derived.excess)} to your wallet.
                </p>
                <TxStatus state={refundTx.state} />
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                <Button variant="primary" size="lg" onClick={refundTx.run} loading={refundTx.isInFlight}>
                  Refund {formatUsdc(derived.excess)}
                </Button>
                <TxStatus state={refundTx.state} />
              </div>
            )}
          </div>
          <Summary memo={memo} merchant={invoice.merchant.toBase58()} amountDue={invoice.amountDue} expiresAt={invoice.expiresAt} />
        </Container>
      );
    }

    return (
      <Container className="flex max-w-[640px] flex-col gap-5">
        <div className="rounded-lg border-l-4 border-[var(--success)] bg-surface p-6 shadow-panel">
          <Badge variant="success">Already paid</Badge>
          <h1 className="mt-3 font-display text-headline font-bold text-fg">This invoice is already paid</h1>
          <p className="mt-2 text-body text-muted">No further payment is needed. Anyone can confirm it on-chain.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={invoicePath('verify', invoicePda.toBase58())} className="inline-flex min-h-11 items-center rounded-sm border border-[var(--accent)] px-4 text-small font-semibold text-accent hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Verify this payment
            </Link>
          </div>
        </div>
        <Summary memo={memo} merchant={invoice.merchant.toBase58()} amountDue={invoice.amountDue} expiresAt={invoice.expiresAt} />
      </Container>
    );
  }

  // Expired or expiring-unpaid: no pay button.
  if (invoice.status === InvoiceStatus.Expired || derived.canExpire) {
    return (
      <Container className="flex max-w-[640px] flex-col gap-5">
        <div role="status" className="rounded-lg border-l-4 border-[var(--danger)] bg-surface p-6 shadow-panel">
          <Badge variant="danger">Expired</Badge>
          <h1 className="mt-3 font-display text-headline font-bold text-fg">This invoice has expired</h1>
          <p className="mt-2 text-body text-muted">
            This invoice expired on {formatDate(invoice.expiresAt)}. No payment can be made. Ask the merchant for a new one.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={invoicePath('verify', invoicePda.toBase58())} className="inline-flex min-h-11 items-center rounded-sm border border-border px-4 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              View on-chain status
            </Link>
          </div>
        </div>
        <Summary memo={memo} merchant={invoice.merchant.toBase58()} amountDue={invoice.amountDue} expiresAt={invoice.expiresAt} />
      </Container>
    );
  }

  return (
    <Container className="flex max-w-[640px] flex-col gap-5">
      {afterPayConfirmed ? (
        <div role="status" className="rounded-lg border-l-4 border-[var(--success)] bg-surface p-6 shadow-panel">
          <Badge variant="success">Paid</Badge>
          <h1 className="mt-3 font-display text-headline font-bold text-fg">Payment sent into escrow</h1>
          <p className="mt-2 text-body text-muted">The merchant can now claim it. Verify the payment on-chain below.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={invoicePath('verify', invoicePda.toBase58())} className="inline-flex min-h-11 items-center rounded-sm border border-[var(--accent)] px-4 text-small font-semibold text-accent hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Verify this payment
            </Link>
          </div>
        </div>
      ) : (
        <Summary memo={memo} merchant={invoice.merchant.toBase58()} amountDue={invoice.amountDue} expiresAt={invoice.expiresAt} />
      )}

      {afterPayConfirmed ? <TxStatus state={payTx.state} /> : null}

      {!afterPayConfirmed ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-panel md:p-7">
          <Button size="lg" onClick={payTx.run} loading={payTx.isInFlight}>
            Pay {formatUsdc(invoice.amountDue)}
          </Button>

          <div>
            <button
              type="button"
              onClick={() => setShowDifferent((value) => !value)}
              aria-expanded={showDifferent}
              className="inline-flex min-h-11 items-center text-small font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {showDifferent ? 'Pay the full amount' : 'Pay a different amount'}
            </button>
          </div>

          {showDifferent ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="custom-amount" className="text-small font-semibold text-fg">
                Amount to pay (USDC)
              </label>
              <input
                id="custom-amount"
                inputMode="decimal"
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
                placeholder={formatUsdc(invoice.amountDue).replace(' USDC', '')}
                aria-invalid={customUnderpay ? true : undefined}
                aria-describedby="custom-amount-help"
                className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 text-body text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              />
              {customUnderpay ? (
                <p id="custom-amount-help" className="text-small text-danger">
                  That&apos;s less than the amount due. Paytruth doesn&apos;t accept partial payments.
                </p>
              ) : customOverpay ? (
                <p id="custom-amount-help" className="text-small text-warning">
                  You&apos;ll pay {formatUsdc(customExtra)} extra. The extra is held in escrow and can be refunded to you.
                </p>
              ) : (
                <p id="custom-amount-help" className="text-small text-muted">
                  Enter at least {formatUsdc(invoice.amountDue)}.
                </p>
              )}
              <div>
                <Button onClick={payTx.run} loading={payTx.isInFlight} disabled={customParsed === null || customUnderpay}>
                  Pay {customParsed !== null && !customUnderpay ? formatUsdc(customParsed) : 'this amount'}
                </Button>
              </div>
            </div>
          ) : null}

          <TxStatus state={payTx.state} />
        </div>
      ) : null}

      <TechnicalDetails>
        <div className="flex flex-col gap-2">
          <span className="flex justify-between gap-3"><span>Invoice address</span><span className="break-all font-mono text-fg">{invoicePda.toBase58()}</span></span>
          <span className="flex justify-between gap-3"><span>Mint</span><span className="break-all font-mono text-fg">{invoice.mint.toBase58()}</span></span>
          <span className="flex justify-between gap-3"><span>Pay link</span><span className="break-all font-mono text-fg">{payLink}</span></span>
        </div>
      </TechnicalDetails>
    </Container>
  );
}

export default function PayInvoicePage() {
  return (
    <Suspense fallback={<Container className="py-10"><Skeleton className="h-40 w-full" /></Container>}>
      <PayInvoiceInner />
    </Suspense>
  );
}
