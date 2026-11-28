'use client';

import { invoicePath } from '@/lib/routes';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Address } from '@/components/ui/address';
import { Button } from '@/components/ui/button';
import { ExplorerLink } from '@/components/ui/explorer-link';
import { CopyLink } from '@/components/ui/invoice/copy-link';
import { Container, TechnicalDetails } from '@/components/ui/layout/container';
import { Input } from '@/components/ui/input';
import { formatUsdc, parseUsdc } from '@/components/ui/sdk/format';
import { sdk as writeSdk } from '@/components/ui/sdk/client';
import { useWalletKey } from '@/components/ui/sdk/use-wallet-key';
import { TxStatus } from '@/components/ui/tx/tx-status';
import { useTxAction } from '@/components/ui/tx/use-tx-action';

const MEMO_LEN = 64;

type ExpiryPreset = '1h' | '24h' | '3d' | '7d' | 'custom';

const presetSeconds: Record<Exclude<ExpiryPreset, 'custom'>, number> = {
  '1h': 3600,
  '24h': 86400,
  '3d': 3 * 86400,
  '7d': 7 * 86400,
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function nowSec(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export default function NewInvoicePage() {
  const { connected, publicKey } = useWalletKey();

  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [expiry, setExpiry] = useState<ExpiryPreset>('24h');
  const [customExpiry, setCustomExpiry] = useState('');
  // Set after mount: a Date.now() initial value differs between server and client render (hydration error #418).
  const [invoiceId, setInvoiceId] = useState('');
  useEffect(() => {
    setInvoiceId((current) => current || BigInt(Date.now()).toString());
  }, []);
  const [touched, setTouched] = useState(false);
  const [successPda, setSuccessPda] = useState<string | null>(null);

  const computedExpiry = useMemo(() => {
    const base = nowSec();
    if (expiry === 'custom') {
      if (!customExpiry) return null;
      const ms = new Date(customExpiry).getTime();
      if (Number.isNaN(ms)) return null;
      return BigInt(Math.floor(ms / 1000));
    }
    return base + BigInt(presetSeconds[expiry]);
  }, [expiry, customExpiry]);

  const parsedAmount = parseUsdc(amount);
  const amountError =
    touched && amount.length > 0 && parsedAmount === null
      ? 'Enter an amount like 25.00. Up to six decimals.'
      : touched && amount.length === 0
        ? 'Enter the amount to invoice.'
        : touched && parsedAmount !== null && parsedAmount <= 0n
          ? 'The amount must be greater than zero.'
          : null;

  const memoBytes = byteLength(memo);
  const memoError = memoBytes > MEMO_LEN ? `Description is ${memoBytes} bytes; the maximum is ${MEMO_LEN}.` : null;

  const expiryError =
    computedExpiry === null
      ? 'Choose an expiry time.'
      : computedExpiry <= nowSec()
        ? 'The expiry time must be in the future.'
        : null;

  let invoiceIdError: string | null = null;
  try {
    const parsed = BigInt(invoiceId);
    if (parsed < 0n) invoiceIdError = 'Invoice number must be zero or greater.';
  } catch {
    invoiceIdError = 'Invoice number must be a whole number.';
  }

  const formValid =
    parsedAmount !== null && parsedAmount > 0n && memoError === null && expiryError === null && invoiceIdError === null && publicKey !== null;

  const resultRef = useRef<{ pda: string; signature: string } | null>(null);

  const tx = useTxAction(
    async (opts) => {
      if (!publicKey) throw new Error('Connect a wallet to create an invoice.');
      if (parsedAmount === null || parsedAmount <= 0n) throw new Error('Enter a valid amount.');
      if (computedExpiry === null) throw new Error('Choose an expiry time.');
      const result = await writeSdk.createInvoice({
        invoiceId: BigInt(invoiceId),
        amountDue: parsedAmount,
        expiresAt: computedExpiry,
        memo,
      }, opts);
      resultRef.current = { pda: result.invoicePda.toBase58(), signature: result.signature };
      return { signature: result.signature };
    },
    {},
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!formValid) return;
    setSuccessPda(null);
    tx.run();
  }

  // Surface the share card once the transaction confirms.
  const confirmedPda = tx.state.status === 'confirmed' && resultRef.current ? resultRef.current.pda : null;
  useEffect(() => {
    if (confirmedPda) setSuccessPda(confirmedPda);
  }, [confirmedPda]);

  if (successPda) {
    return (
      <Container className="flex max-w-[760px] flex-col gap-6">
        <div className="hero-enter rounded-lg border border-[var(--success)] bg-surface p-6 shadow-panel md:p-8">
          <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">Invoice created</h1>
          <p className="mt-2 max-w-[56ch] text-body text-muted">
            Share the pay link with your customer. The status updates from the Solana program as they pay.
          </p>

          <div className="mt-5 flex flex-col gap-2 rounded-sm border border-border bg-[var(--surface-2)] p-4">
            <span className="text-micro font-semibold uppercase tracking-[0.08em] text-muted">Pay link</span>
            <span className="break-all font-mono text-small text-fg">{invoicePath('pay', successPda)}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <CopyLink path={invoicePath('pay', successPda)} />
              <Link
                href={invoicePath('pay', successPda)}
                className="inline-flex min-h-9 items-center rounded-xs border border-[var(--accent)] px-2 text-small font-semibold text-accent hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open pay page
              </Link>
              <Link
                href={invoicePath('verify', successPda)}
                className="inline-flex min-h-9 items-center rounded-xs border border-border px-2 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Verify link
              </Link>
              <Link
                href={invoicePath('merchant', successPda)}
                className="inline-flex min-h-9 items-center rounded-xs border border-border px-2 text-small font-semibold text-fg hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open merchant view
              </Link>
            </div>
          </div>

          {resultRef.current?.pda === successPda ? (
            <div className="mt-4">
              <ExplorerLink signature={resultRef.current.signature}>Creation transaction</ExplorerLink>
            </div>
          ) : null}

          <TechnicalDetails>
            <span className="block">Invoice address</span>
            <Address address={successPda} chars={6} />
          </TechnicalDetails>

          <div className="mt-5">
            <Button variant="secondary" onClick={() => setSuccessPda(null)}>
              Create another invoice
            </Button>
          </div>
        </div>
      </Container>
    );
  }

  return (
    <Container className="flex max-w-[760px] flex-col gap-6">
      <div>
        <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">Create an invoice</h1>
        <p className="mt-2 max-w-[56ch] text-body text-muted">
          Set the amount and a short description. Your customer pays USDC into escrow; you claim it when you&apos;re ready.
        </p>
      </div>

      {!connected ? (
        <div role="alert" className="rounded-md border border-[var(--warning)] bg-[var(--surface-2)] p-4 text-small text-warning">
          Connect your wallet to create an invoice.
        </div>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-panel md:p-7" noValidate>
        <Input
          label="Amount (USDC)"
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="0.00"
          hint={parsedAmount !== null && parsedAmount > 0n ? `You'll be owed ${formatUsdc(parsedAmount)}.` : 'USDC, up to six decimals.'}
          error={amountError ?? undefined}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="memo" className="text-small font-semibold text-fg">
            Description
          </label>
          <input
            id="memo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="What is this invoice for?"
            maxLength={120}
            aria-invalid={memoError ? true : undefined}
            aria-describedby="memo-counter memo-error"
            className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 text-body text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          <div className="flex items-center justify-between gap-3">
            <p id="memo-counter" className={memoError ? 'text-small text-danger' : 'text-small text-muted'}>
              {memoBytes} / {MEMO_LEN} bytes
            </p>
          </div>
          {memoError ? (
            <p id="memo-error" className="text-small text-danger">
              {memoError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="expiry" className="text-small font-semibold text-fg">
            Expires
          </label>
          <select
            id="expiry"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value as ExpiryPreset)}
            className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 text-body text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <option value="1h">In 1 hour</option>
            <option value="24h">In 24 hours</option>
            <option value="3d">In 3 days</option>
            <option value="7d">In 7 days</option>
            <option value="custom">Custom date and time</option>
          </select>
          {expiry === 'custom' ? (
            <input
              type="datetime-local"
              aria-label="Custom expiry date and time"
              value={customExpiry}
              onChange={(event) => setCustomExpiry(event.target.value)}
              aria-invalid={expiryError ? true : undefined}
              className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 text-body text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            />
          ) : null}
          {expiryError ? <p className="text-small text-danger">{expiryError}</p> : null}
        </div>

        <TechnicalDetails summary="Technical details">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invoice-id" className="text-small font-semibold text-fg">
              Invoice number
            </label>
            <input
              id="invoice-id"
              value={invoiceId}
              onChange={(event) => setInvoiceId(event.target.value)}
              inputMode="numeric"
              aria-invalid={invoiceIdError ? true : undefined}
              className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 font-mono text-small text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            />
            {invoiceIdError ? <p className="text-small text-danger">{invoiceIdError}</p> : <p className="text-small text-muted">A unique whole number. Generated from the time; change it if you prefer.</p>}
          </div>
        </TechnicalDetails>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={!connected} loading={tx.isInFlight}>
            Create invoice
          </Button>
          <span className="text-small text-muted">
            {parsedAmount && parsedAmount > 0n ? formatUsdc(parsedAmount) : 'Amount not set'}
          </span>
        </div>

        <TxStatus state={tx.state} />
      </form>
    </Container>
  );
}
