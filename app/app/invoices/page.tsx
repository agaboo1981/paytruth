'use client';

import type { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { invoicePath } from '@/lib/routes';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatTimestamp, Money } from '@/components/ui/invoice/fields';
import {
  GROUP_ORDER,
  groupInvoices,
  type InvoiceGroup,
  type InvoiceRole,
  type InvoiceRowStatus,
  type ListedInvoice,
} from '@/components/ui/invoices/query';
import { useMyInvoices } from '@/components/ui/invoices/use-my-invoices';
import { Container } from '@/components/ui/layout/container';
import { Skeleton } from '@/components/ui/skeleton';
import { sdk } from '@/components/ui/sdk/client';
import { decodeMemo } from '@/components/ui/sdk/format';
import { useWalletKey } from '@/components/ui/sdk/use-wallet-key';
import { parsePublicKey } from '@/components/ui/sdk/validate';
import { TxStatus } from '@/components/ui/tx/tx-status';
import { useTxAction } from '@/components/ui/tx/use-tx-action';
import { ConnectButton } from '@/components/ui/wallet/connect-button';
import { isMock } from '@/components/ui/sdk/client';

/** Read-only "view as" for screenshots/tests; compiled in only when the build flag is set. */
const VIEW_AS_ENABLED = process.env.NEXT_PUBLIC_PAYTRUTH_VIEW_AS === '1';

const GROUP_COPY: Record<InvoiceGroup, { title: string; empty: string }> = {
  'needs-action': { title: 'Needs action', empty: 'Nothing needs you right now.' },
  open: { title: 'Open', empty: 'No open invoices.' },
  done: { title: 'Done', empty: 'Nothing finished yet.' },
};

const linkClass =
  'inline-flex min-h-11 items-center rounded-xs px-2 text-small font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export default function InvoicesPage() {
  return (
    <Suspense fallback={<Container><Skeleton className="h-40 w-full rounded-lg" /></Container>}>
      <InvoicesInner />
    </Suspense>
  );
}

function InvoicesInner() {
  const { publicKey } = useWalletKey();
  const search = useSearchParams();
  const viewAs = VIEW_AS_ENABLED ? parsePublicKey(search.get('as') ?? '') : null;
  const wallet = viewAs ?? publicKey;
  const readOnly = Boolean(viewAs) && !(publicKey && viewAs && publicKey.equals(viewAs));
  const [role, setRole] = useState<InvoiceRole>('merchant');

  return (
    <Container className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">My invoices</h1>
          <p className="max-w-[60ch] text-body text-muted">
            Read straight from Solana for your connected wallet. No need to save invoice links.
          </p>
          {readOnly && wallet ? (
            <p role="note" className="text-small text-warning">
              Test view: showing {wallet.toBase58().slice(0, 4)}…{wallet.toBase58().slice(-4)} read-only.
            </p>
          ) : null}
        </div>
        <Link
          href="/merchant/new"
          className="inline-flex min-h-11 w-fit items-center rounded-sm border border-accent bg-accent px-4 text-body font-semibold text-accent-fg hover:bg-[var(--fg)] hover:text-[var(--bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Create invoice
        </Link>
      </div>

      {!wallet ? (
        <NoWallet />
      ) : (
        <>
          <RoleTabs role={role} onChange={setRole} />
          <div role="tabpanel" id={`panel-${role}`} aria-labelledby={`tab-${role}`}>
            <InvoiceList key={`${wallet.toBase58()}-${role}`} wallet={wallet} role={role} canAct={!readOnly} />
          </div>
        </>
      )}
    </Container>
  );
}

function NoWallet() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6 shadow-panel">
      <h2 className="font-display text-title font-bold text-fg">Connect your wallet to see your invoices</h2>
      <p className="max-w-[56ch] text-body text-muted">
        We look up every invoice your wallet created or paid, directly on Solana devnet. Connecting only shares your public address.
      </p>
      {!isMock ? <ConnectButton /> : null}
    </div>
  );
}

function RoleTabs({ role, onChange }: { role: InvoiceRole; onChange: (r: InvoiceRole) => void }) {
  const tabs: { id: InvoiceRole; label: string }[] = [
    { id: 'merchant', label: 'Created by me' },
    { id: 'payer', label: 'Paid by me' },
  ];
  return (
    <div role="tablist" aria-label="Which invoices" className="inline-flex w-fit gap-1 rounded-sm border border-border bg-[var(--surface-2)] p-1">
      {tabs.map((t) => {
        const selected = t.id === role;
        return (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const next = role === 'merchant' ? 'payer' : 'merchant';
                onChange(next);
                requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
              }
            }}
            tabIndex={selected ? 0 : -1}
            className={
              'min-h-11 rounded-xs px-4 text-small font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
              (selected ? 'bg-surface text-fg shadow-panel' : 'text-muted hover:text-fg')
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function InvoiceList({ wallet, role, canAct }: { wallet: PublicKey; role: InvoiceRole; canAct: boolean }) {
  const { rows, loading, error, refresh } = useMyInvoices(wallet, role);
  const [now, setNow] = useState<bigint | null>(null);
  useEffect(() => {
    setNow(BigInt(Math.floor(Date.now() / 1000)));
  }, [rows]);

  const groups = useMemo(() => (rows && now !== null ? groupInvoices(rows, now, role) : null), [rows, now, role]);

  if (error && !rows) {
    return (
      <div role="alert" className="rounded-lg border-l-4 border-[var(--warning)] bg-surface p-6 shadow-panel">
        <Badge variant="warning">Can&apos;t read Solana</Badge>
        <h2 className="mt-3 font-display text-title font-bold text-fg">We couldn&apos;t load your invoices</h2>
        <p className="mt-2 max-w-[60ch] text-body text-muted">
          The Solana network didn&apos;t answer. Your invoices and money are safe — this is only a reading problem. Try again in a moment.
        </p>
        <p className="mt-2 break-words font-mono text-small text-muted">{error.message}</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={refresh} loading={loading}>Try again</Button>
        </div>
      </div>
    );
  }

  if (!groups) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading invoices">
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    );
  }

  const total = GROUP_ORDER.reduce((n, g) => n + groups[g].length, 0);
  if (total === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6 shadow-panel">
        <h2 className="font-display text-title font-bold text-fg">
          {role === 'merchant' ? 'No invoices yet' : 'You haven’t paid any invoices'}
        </h2>
        <p className="max-w-[56ch] text-body text-muted">
          {role === 'merchant'
            ? 'Create your first invoice and share the pay link with your customer. It will show up here automatically.'
            : 'Invoices you pay with this wallet will appear here.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {role === 'merchant' ? (
            <Link href="/merchant/new" className={linkClass}>Create an invoice</Link>
          ) : null}
          <Button variant="ghost" size="sm" onClick={refresh} loading={loading}>Refresh</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small text-muted" aria-live="polite">
          {total} invoice{total === 1 ? '' : 's'}
          {groups['needs-action'].length > 0 ? ` · ${groups['needs-action'].length} need${groups['needs-action'].length === 1 ? 's' : ''} action` : ''}
        </p>
        <Button variant="ghost" size="sm" onClick={refresh} loading={loading}>Refresh</Button>
      </div>
      {error ? (
        <p role="alert" className="text-small text-warning">Couldn&apos;t refresh just now. Showing the last list we read.</p>
      ) : null}
      {GROUP_ORDER.map((g) =>
        groups[g].length === 0 && g !== 'needs-action' ? null : (
          <section key={g} aria-labelledby={`group-${g}`} className="flex flex-col gap-3">
            <h2 id={`group-${g}`} className="flex items-center gap-2 font-display text-title font-bold text-fg">
              {GROUP_COPY[g].title}
              <span className="rounded-pill border border-border px-2 text-small font-semibold text-muted">{groups[g].length}</span>
            </h2>
            {groups[g].length === 0 ? (
              <p className="text-small text-muted">{GROUP_COPY[g].empty}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {groups[g].map((row) => (
                  <li key={row.pda.toBase58()}>
                    <InvoiceRow row={row} role={role} canAct={canAct && role === 'merchant'} onChanged={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ),
      )}
    </div>
  );
}

function InvoiceRow({
  row,
  role,
  canAct,
  onChanged,
}: {
  row: ListedInvoice & { status: InvoiceRowStatus };
  role: InvoiceRole;
  canAct: boolean;
  onChanged: () => void;
}) {
  const { invoice, pda, status } = row;
  const address = pda.toBase58();
  const memo = decodeMemo(invoice.memo) || 'No description';
  const highlight = status.group === 'needs-action';

  return (
    <article
      className={
        'flex flex-col gap-3 rounded-md border bg-surface p-4 shadow-panel md:flex-row md:items-center md:justify-between ' +
        (highlight ? 'border-[var(--warning)]' : 'border-border')
      }
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Money value={invoice.amountDue} className="font-semibold text-fg" />
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <p className="truncate text-body font-semibold text-fg" title={memo}>{memo}</p>
        <p className="text-small text-muted">
          Created {formatTimestamp(invoice.createdAt)} · {status.hint}
        </p>
        <nav aria-label={`Links for ${memo}`} className="-ml-2 flex flex-wrap items-center">
          {role === 'merchant' ? <Link href={invoicePath('merchant', address)} className={linkClass}>Manage</Link> : null}
          <Link href={invoicePath('pay', address)} className={linkClass}>Pay page</Link>
          <Link href={invoicePath('verify', address)} className={linkClass}>Verify</Link>
        </nav>
      </div>
      {status.canClaim && canAct ? <ClaimInline invoicePda={pda} onDone={onChanged} /> : null}
    </article>
  );
}

function ClaimInline({ invoicePda, onDone }: { invoicePda: PublicKey; onDone: () => void }) {
  const tx = useTxAction((opts) => sdk.merchantClaim({ invoicePda }, opts), {
    invoicePda,
    waitFor: (inv) => inv.claimed,
    onConfirmed: onDone,
  });
  return (
    <div className="flex shrink-0 flex-col gap-2 md:max-w-[280px] md:items-end">
      {tx.state.status !== 'confirmed' ? (
        <Button variant="primary" onClick={tx.run} loading={tx.isInFlight}>
          Claim payment
        </Button>
      ) : null}
      {tx.state.status !== 'idle' ? <TxStatus state={tx.state} /> : null}
    </div>
  );
}
