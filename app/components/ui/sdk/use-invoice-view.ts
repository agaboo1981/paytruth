'use client';

import type { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useState } from 'react';

import { sdk } from './client';
import type { Invoice } from './types';

export type InvoiceView = {
  invoice: Invoice | null;
  escrowBalance: bigint | null;
  loading: boolean;
  error: Error | null;
  finalized: boolean;
  refresh: () => void;
};

/**
 * UI-owned read hook. Full-Stack's `useInvoice` will replace this at
 * integration; the returned shape mirrors what we need from it.
 */
export function useInvoiceView(invoicePda: PublicKey | null): InvoiceView {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [escrowBalance, setEscrowBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!invoicePda) {
      setInvoice(null);
      setEscrowBalance(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    void (async () => {
      try {
        const confirmed = await sdk.fetchInvoice(invoicePda, 'confirmed');
        if (!active) return;
        setInvoice(confirmed);
        const [finalizedInvoice, balance] = await Promise.all([
          sdk.fetchInvoice(invoicePda, 'finalized'),
          sdk.fetchEscrowBalance(invoicePda, confirmed.mint),
        ]);
        if (!active) return;
        setEscrowBalance(balance);
        setFinalized(true);
        setInvoice(finalizedInvoice);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setInvoice(null);
        setEscrowBalance(null);
        setFinalized(false);
        setError(caught instanceof Error ? caught : new Error('Could not read the invoice.'));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [invoicePda, nonce]);

  useEffect(() => {
    if (!invoicePda) return undefined;
    const unsubscribe = sdk.subscribeInvoice(invoicePda, (next) => {
      if (!next) return;
      setInvoice(next);
      setFinalized(true);
      void sdk
        .fetchEscrowBalance(invoicePda, next.mint)
        .then((balance) => setEscrowBalance(balance))
        .catch(() => undefined);
    });
    return unsubscribe;
  }, [invoicePda]);

  return { invoice, escrowBalance, loading, error, finalized, refresh };
}
