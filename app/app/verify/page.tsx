'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/layout/container';
import { parsePublicKey } from '@/components/ui/sdk/validate';

export default function VerifyPage() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = address.trim();
    if (parsePublicKey(value) === null) {
      setError('Enter a valid Solana invoice address.');
      return;
    }
    setError(null);
    router.push(`/verify/${value}`);
  }

  return (
    <Container className="flex max-w-[640px] flex-col gap-6">
      <div>
        <h1 className="font-display text-headline font-bold tracking-[-0.03em] text-fg">Verify an invoice</h1>
        <p className="mt-2 text-body text-muted">
          Paste an invoice address to read its status directly from the Solana devnet program. No wallet needed.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-panel md:p-7" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invoice-address" className="text-small font-semibold text-fg">
            Invoice address
          </label>
          <input
            id="invoice-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Paste the invoice address"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'address-error' : 'address-help'}
            className="min-h-11 w-full rounded-sm border border-border bg-[var(--surface-2)] px-3 font-mono text-small text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          <p id="address-help" className="text-small text-muted">A 32-byte base58 Solana address.</p>
          {error ? (
            <p id="address-error" className="text-small text-danger">{error}</p>
          ) : null}
        </div>
        <div>
          <Button type="submit" size="lg">Verify on-chain</Button>
        </div>
      </form>
    </Container>
  );
}
