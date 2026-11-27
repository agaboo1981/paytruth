'use client';

import { InvoiceUnavailable } from '@/components/ui/invoice/load-error';

import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Address } from '@/components/ui/address';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActionCard } from '@/components/ui/invoice/action-card';
import { CopyLink } from '@/components/ui/invoice/copy-link';
import { Field, formatTimestamp, Money } from '@/components/ui/invoice/fields';
import { StatusHero } from '@/components/ui/invoice/status-hero';
import { Container, TechnicalDetails } from '@/components/ui/layout/container';
import { Skeleton } from '@/components/ui/skeleton';
import { derivedView } from '@/components/ui/sdk/format';
import { stagedWrites } from '@/components/ui/sdk/staged-writes';
import { useInvoiceView } from '@/components/ui/sdk/use-invoice-view';
import { useWalletKey } from '@/components/ui/sdk/use-wallet-key';
import { parsePublicKey } from '@/components/ui/sdk/validate';
import { InvoiceStatus } from '@/components/ui/sdk/types';
import { TxStatus } from '@/components/ui/tx/tx-status';
import { useTxAction } from '@/components/ui/tx/use-tx-action';

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <Container>
      <div role="alert" className="rounded-lg border border-[var(--danger)] bg-surface p-6">
        <h1 className="font-display text-headline font-bold text-fg">{title}</h1>
        <p className="mt-2 text-body text-muted">{body}</p>
        <Link href="/verify" className="mt-4 inline-flex min-h-11 items-center text-small font-semibold text-accent hover:underline">
          Verify another invoice
        </Link>
      </div>
    </Container>
  );
}

function ClosedStateCard() {
  return (
    <Container>
      <div role="status" className="rounded-lg border border-border bg-surface p-6 shadow-panel">
        <Badge variant="default">Closed</Badge>
        <h1 className="mt-3 font-display text-headline font-bold tracking-[-0.03em] text-fg">
          Closed — the invoice account was removed and its rent returned to you.
        </h1>
        <p className="mt-2 max-w-[60ch] text-body text-muted">
          Nothing more can happen to this invoice. You can still verify the settled payment.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/merchant/new" className="inline-flex min-h-11 items-center rounded-sm border border-[var(--accent)] px-4 text-small font-semibold text-accent hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Create another invoice
          </Link>
        </div>
      </div>
    </Container>
  );
}

function Timeline({ invoice }: { invoice: import('@/components/ui/sdk/types').Invoice }) {
  type Step = { label: string; at: bigint | null; done: boolean };
  const steps: Step[] = [
    { label: 'Created', at: invoice.createdAt, done: true },
    { label: 'Paid', at: invoice.status === InvoiceStatus.Open ? null : null, done: invoice.status !== InvoiceStatus.Open },
  ];
  if (invoice.status === InvoiceStatus.Closed) {
    steps.push({ label: 'Closed', at: null, done: true });
  } else if (invoice.status === InvoiceStatus.Expired) {
    steps.push({ label: 'Expired', at: invoice.expiresAt, done: true });
  } else if (invoice.claimed) {
    steps.push({ label: 'Claimed', at: null, done: true });
  } else if (invoice.refundedExcess > 0n) {
    steps.push({ label: 'Extra refunded', at: null, done: true });
  }

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-3">
          <span
            className={
              step.done
                ? 'grid h-6 w-6 place-items-center rounded-pill bg-[var(--success)] text-[var(--success-fg)]'
                : 'grid h-6 w-6 place-items-center rounded-pill border border-border text-muted'
            }
            aria-hidden="true"
          >
            {step.done ? (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M3 6.5l2 2 4-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          <span className="text-small font-semibold text-fg">{step.label}</span>
          {step.at !== null ? <span className="text-small text-muted">{formatTimestamp(step.at)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export default function MerchantInvoicePage() {
  const params = useParams<{ invoicePda: string }>();
  const raw = params?.invoicePda ?? '';
  const invoicePda = parsePublicKey(raw);
  const { publicKey } = useWalletKey();
  const view = useInvoiceView(invoicePda);
  const [closedLocally, setClosedLocally] = useState(false);

  if (!invoicePda) {
    return <ErrorCard title="That address isn't valid" body="An invoice address must be a 32-byte base58 Solana address. Check the link and try again." />;
  }

  if (view.loading) {
    return (
      <Container className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </Container>
    );
  }

  if (closedLocally) return <ClosedStateCard />;

  if (view.errorKind === 'unavailable') {
    return <InvoiceUnavailable message={view.error?.message} onRetry={view.refresh} />;
  }

  if (view.error || !view.invoice) {
    return <ErrorCard title="Invoice not found" body="We couldn't read this invoice from Solana devnet. It may have been closed, or the address is wrong." />;
  }

  const invoice = view.invoice;
  const now = Math.floor(Date.now() / 1000);
  const derived = derivedView(invoice, now, view.escrowBalance ?? 0n);
  const isMerchant = publicKey ? publicKey.equals(invoice.merchant) : false;
  const closedState = derived.kind === 'closed';

  return (
    <Container className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-small text-muted">
          <Link href="/" className="hover:text-accent">Home</Link> <span aria-hidden="true">/</span>{' '}
          <span className="text-fg">Merchant view</span>
        </nav>
        <CopyLink path={`/merchant/${invoicePda.toBase58()}`} label="Copy link" />
      </div>

      <StatusHero kind={derived.kind} headline={derived.headline} explanation={derived.explanation} />

      <section aria-labelledby="amounts-heading" className="flex flex-col gap-3">
        <h2 id="amounts-heading" className="font-display text-title font-bold text-fg">Amounts</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Field label="Amount due"><Money value={invoice.amountDue} /></Field>
          <Field label="Paid"><Money value={invoice.paidAmount} /></Field>
          <Field label="Extra paid"><Money value={derived.excess} /></Field>
          <Field label="Refunded"><Money value={invoice.refundedExcess} /></Field>
          <Field label="Held in escrow"><Money value={view.escrowBalance ?? 0n} /></Field>
          <Field label="Claimed"><span className="font-semibold">{invoice.claimed ? 'Yes' : 'No'}</span></Field>
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="timeline-heading" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5 shadow-panel">
          <h2 id="timeline-heading" className="font-display text-title font-bold text-fg">Timeline</h2>
          <Timeline invoice={invoice} />
        </section>

        <section aria-labelledby="details-heading" className="flex flex-col gap-3 rounded-md border border-border bg-surface p-5 shadow-panel">
          <h2 id="details-heading" className="font-display text-title font-bold text-fg">Details</h2>
          <dl className="grid gap-3">
            <Field label="Merchant"><Address address={invoice.merchant.toBase58()} /></Field>
            <Field label="Customer">
              {invoice.payer.equals(PublicKey.default) ? 'Not paid yet' : <Address address={invoice.payer.toBase58()} />}
            </Field>
            <Field label="Expires">{formatTimestamp(invoice.expiresAt)}</Field>
          </dl>
        </section>
      </div>

      <section aria-labelledby="actions-heading" className="flex flex-col gap-3">
        <h2 id="actions-heading" className="font-display text-title font-bold text-fg">Actions</h2>
        {!isMerchant ? (
          <div role="note" className="rounded-md border border-[var(--warning)] bg-[var(--surface-2)] p-4 text-small text-warning">
            Only the merchant wallet can claim. You&apos;re viewing this read-only.
          </div>
        ) : (
          <ActionPanel
            invoicePda={invoicePda}
            invoice={invoice}
            derived={derived}
            finalized={view.finalized}
            closed={closedState}
            onRefresh={view.refresh}
            onClosed={() => setClosedLocally(true)}
          />
        )}
      </section>
    </Container>
  );
}

function ActionPanel({
  invoicePda,
  invoice,
  derived,
  finalized,
  closed,
  onRefresh,
  onClosed,
}: {
  invoicePda: PublicKey;
  invoice: import('@/components/ui/sdk/types').Invoice;
  derived: ReturnType<typeof derivedView>;
  finalized: boolean;
  closed: boolean;
  onRefresh: () => void;
  onClosed: () => void;
}) {
  const [destination, setDestination] = useState('');
  const destinationAta = useMemo(() => parsePublicKey(destination), [destination]);
  const closeTx = useTxAction(async (opts) => stagedWrites.closeInvoice({ invoicePda }, opts), {
    invoicePda,
    waitFor: (inv) => inv.status === InvoiceStatus.Closed,
    skipWaitFor: true,
    onConfirmed: () => {
      onClosed();
      onRefresh();
    },
  });

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {derived.canClaim ? (
        <ActionCard
          invoicePda={invoicePda}
          action={{
            key: 'claim',
            label: 'Claim payment',
            description: 'Move the amount due from escrow into your wallet.',
            note: finalized ? null : "Wait for 'Final' before handing over goods.",
            variant: 'primary',
            send: async (opts) => stagedWrites.merchantClaim({ invoicePda }, opts),
            waitFor: (inv) => inv.claimed,
          }}
        />
      ) : null}

      {derived.canRefund ? (
        <ActionCard
          invoicePda={invoicePda}
          action={{
            key: 'refund',
            label: 'Refund extra to customer',
            description: 'Send the overpayment back to the wallet that paid.',
            send: async (opts) => stagedWrites.refundOverpayment({ invoicePda }, opts),
            waitFor: (inv) => inv.refundedExcess > 0n,
          }}
        />
      ) : null}

      {derived.canExpire ? (
        <ActionCard
          invoicePda={invoicePda}
          action={{
            key: 'expire',
            label: 'Mark as expired',
            description: 'The expiry time has passed. Mark it expired so it can no longer be paid.',
            send: async (opts) => stagedWrites.expireInvoice({ invoicePda }, opts),
            waitFor: (inv) => inv.status === InvoiceStatus.Expired,
          }}
        />
      ) : null}

      {derived.canRecover ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-title font-bold text-fg">Recover leftover funds</h3>
            <p className="text-small text-muted">Send any funds still held in escrow to your wallet&apos;s USDC token account.</p>
          </div>
          <label htmlFor="destination-ata" className="text-small font-semibold text-fg">
            Destination token account
          </label>
          <input
            id="destination-ata"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Your USDC token account address"
            spellCheck={false}
            aria-describedby="destination-help"
            className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 font-mono text-small text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          <p id="destination-help" className="text-small text-muted">Use your USDC token account address, not your wallet address.</p>
          <RecoverButton invoicePda={invoicePda} destination={destinationAta} />
        </div>
      ) : null}

      {derived.canClose ? (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-panel">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-title font-bold text-fg">Close invoice</h3>
            <p className="text-small text-muted">Remove the invoice and escrow accounts. Rent goes back to your wallet.</p>
          </div>
          <div>
            <Button variant="danger" onClick={closeTx.run} loading={closeTx.isInFlight}>
              Close invoice
            </Button>
          </div>
          <TxStatus state={closeTx.state} />
          {closeTx.state.status === 'confirmed' ? (
            <div className="flex flex-col gap-2 rounded-sm border border-[var(--success)] p-3">
              <p className="text-small font-semibold text-success">
                Closed — the invoice account was removed and its rent returned to you.
              </p>
              <Button variant="ghost" onClick={onRefresh}>Refresh</Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!derived.canClaim && !derived.canRefund && !derived.canExpire && !derived.canRecover && !derived.canClose ? (
        <div className="rounded-md border border-border bg-[var(--surface-2)] p-4 text-small text-muted md:col-span-2">
          There are no actions available for this invoice right now.
        </div>
      ) : null}

      <div className="md:col-span-2">
        <TechnicalDetails>
          <dl className="grid gap-2">
            <div className="flex justify-between gap-3"><dt>Invoice address</dt><dd className="break-all font-mono text-fg">{invoicePda.toBase58()}</dd></div>
            <div className="flex justify-between gap-3"><dt>Invoice number</dt><dd className="font-mono text-fg">{invoice.invoiceId.toString()}</dd></div>
            <div className="flex justify-between gap-3"><dt>Status</dt><dd className="text-fg">{['Open', 'Paid', 'Expired', 'Closed'][invoice.status]}</dd></div>
            <div className="flex justify-between gap-3"><dt>Closed</dt><dd className="text-fg">{closed ? 'Yes' : 'No'}</dd></div>
          </dl>
        </TechnicalDetails>
      </div>
    </div>
  );
}

function RecoverButton({ invoicePda, destination }: { invoicePda: PublicKey; destination: PublicKey | null }) {
  const tx = useTxAction(
    async (opts) => {
      if (!destination) throw new Error('Enter the destination token account address.');
      return stagedWrites.recoverUnattributed({ invoicePda, destinationAta: destination }, opts);
    },
    { invoicePda },
  );

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={tx.run} loading={tx.isInFlight} disabled={!destination}>
        Recover funds
      </Button>
      {!destination ? <p className="text-small text-muted">Enter a valid token account address to continue.</p> : null}
      {tx.state.status !== 'idle' ? <TxStatus state={tx.state} /> : null}
    </div>
  );
}
