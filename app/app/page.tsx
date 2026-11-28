'use client';

import { invoicePath } from '@/lib/routes';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout/container';
import { isMock } from '@/components/ui/sdk/client';
import { FIXTURE_LABELS, fixtureSpecs } from '@/components/ui/sdk/fixtures';
import { parsePublicKey } from '@/components/ui/sdk/validate';
import { useWalletKey } from '@/components/ui/sdk/use-wallet-key';

const LANDED_KEY = 'paytruth:landed-invoices';

const steps = [
  {
    title: 'Create an invoice',
    body: 'Enter an amount and a short description. Paytruth opens an escrow account for it on Solana.',
  },
  {
    title: 'Your customer pays into escrow',
    body: 'They pay USDC straight into escrow. No account, no sign-up, no sharing card details.',
  },
  {
    title: 'Anyone can verify on-chain',
    body: 'A public page shows paid, claimed and expired straight from the program. Not from our server.',
  },
];

function isValidAddress(value: string): boolean {
  return parsePublicKey(value) !== null;
}

export default function LandingPage() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { connected } = useWalletKey();

  // After a wallet connects on the home page, land on My invoices (once per tab session,
  // so the home page stays reachable). Pay links never redirect.
  useEffect(() => {
    if (isMock || !connected) return;
    try {
      if (window.sessionStorage.getItem(LANDED_KEY)) return;
      window.sessionStorage.setItem(LANDED_KEY, '1');
    } catch {
      // storage blocked: still redirect
    }
    router.replace('/invoices/');
  }, [connected, router]);

  function verify(event: React.FormEvent) {
    event.preventDefault();
    const value = address.trim();
    if (!isValidAddress(value)) {
      setError('Enter a valid Solana invoice address.');
      return;
    }
    setError(null);
    router.push(invoicePath('verify', value));
  }

  return (
    <Container className="flex flex-col gap-16 py-10 md:py-16">
      <section className="grid items-center gap-10 md:grid-cols-[1.15fr_0.85fr]">
        <div className="hero-enter flex flex-col gap-6">
          <p className="inline-flex w-fit items-center gap-2 rounded-pill border border-[var(--accent)] px-3 py-1 text-micro font-semibold text-accent">
            USDC invoices · Solana devnet · on-chain escrow
          </p>
          <h1 className="font-display text-display font-bold tracking-[-0.045em] text-fg">
            Invoices that prove they were paid.
          </h1>
          <p className="max-w-[46ch] text-body text-muted">
            Paytruth moves USDC from one wallet to another through escrow. When a customer pays, the
            Solana program records it — so you never have to take anyone&apos;s word for it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={() => router.push('/merchant/new')}>
              Create an invoice
            </Button>
            <Link
              href="/verify"
              className="inline-flex min-h-12 items-center justify-center rounded-sm border border-border bg-surface px-5 font-semibold text-fg transition-colors duration-fast hover:border-[var(--accent)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Verify an invoice
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5 shadow-panel md:p-6">
          <form onSubmit={verify} className="flex flex-col gap-3" noValidate>
            <label htmlFor="verify-address" className="text-small font-semibold text-fg">
              Verify an invoice
            </label>
            <p id="verify-help" className="text-small text-muted">
              Paste an invoice address to see its on-chain status.
            </p>
            <input
              id="verify-address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Invoice address"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'verify-error' : 'verify-help'}
              className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 font-mono text-small text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            />
            {error ? (
              <p id="verify-error" className="text-small text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" size="md">
              Verify on-chain
            </Button>
          </form>
        </div>
      </section>

      <section aria-labelledby="how-it-works">
        <h2 id="how-it-works" className="font-display text-headline font-bold tracking-[-0.03em] text-fg">
          How it works
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-md border border-border bg-surface p-5 shadow-panel">
              <span className="font-mono text-small font-bold text-accent" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2 font-display text-title font-bold text-fg">{step.title}</h3>
              <p className="mt-2 text-small text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {isMock ? (
        <section aria-labelledby="demo-invoices">
          <h2 id="demo-invoices" className="font-display text-headline font-bold tracking-[-0.03em] text-fg">
            Try a demo invoice
          </h2>
          <p className="mt-2 max-w-[60ch] text-body text-muted">
            These are simulated invoices in each state. Open one to see the customer or verify view.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIXTURE_LABELS.map((label) => {
              const spec = fixtureSpecs[label];
              return (
                <li key={label}>
                  <Link
                    href={invoicePath('pay', spec.pda)}
                    className="flex h-full flex-col gap-1 rounded-md border border-border bg-surface p-4 transition-[border-color,transform] duration-fast hover:-translate-y-0.5 hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    <span className="text-micro font-semibold uppercase tracking-[0.08em] text-muted">
                      {spec.memo}
                    </span>
                    <span className="font-display text-title font-bold text-fg">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
