'use client';

import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { sdk } from './client';
import type { Invoice } from './types';

export type InvoiceView = {
  invoice: Invoice | null;
  escrowBalance: bigint | null;
  loading: boolean;
  error: Error | null;
  /** 'not-found' = account does not exist; 'unavailable' = could not read (RPC/SDK). */
  errorKind: 'not-found' | 'unavailable' | null;
  finalized: boolean;
  refresh: () => void;
};

/**
 * UI-owned read hook. Full-Stack's `useInvoice` will replace this at
 * integration; the returned shape mirrors what we need from it.
 */
function sameSettlementState(a: Invoice, b: Invoice): boolean {
  return (
    a.status === b.status &&
    a.claimed === b.claimed &&
    a.paidAmount === b.paidAmount &&
    a.refundedExcess === b.refundedExcess
  );
}

export function useInvoiceView(invoicePdaInput: PublicKey | null): InvoiceView {
  // Callers often construct a fresh PublicKey every render; key effects by the
  // base58 string so we do not refetch/resubscribe in a render loop.
  const pdaKey = invoicePdaInput ? invoicePdaInput.toBase58() : null;
  const invoicePda = useMemo(() => (pdaKey ? new PublicKey(pdaKey) : null), [pdaKey]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [escrowBalance, setEscrowBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [nonce, setNonce] = useState(0);

  const loadedKey = useRef<string | null>(null);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!invoicePda) {
      setInvoice(null);
      setEscrowBalance(null);
      setLoading(false);
      return;
    }

    let active = true;
    // Skeleton only on first load of this address; background refreshes keep the current view.
    if (loadedKey.current !== pdaKey) setLoading(true);

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
        setError(null);
        if (sameSettlementState(confirmed, finalizedInvoice)) {
          setFinalized(true);
          setInvoice(finalizedInvoice);
        } else {
          // Newer state is only confirmed so far: show it as "confirming…" and re-check shortly.
          setFinalized(false);
          setInvoice(confirmed);
          setTimeout(() => {
            if (active) setNonce((value) => value + 1);
          }, 2000);
        }
      } catch (caught) {
        if (!active) return;
        setInvoice(null);
        setEscrowBalance(null);
        setFinalized(false);
        setError(caught instanceof Error ? caught : new Error('Could not read the invoice.'));
      } finally {
        if (active) {
          loadedKey.current = pdaKey;
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [invoicePda, pdaKey, nonce]);

  useEffect(() => {
    if (!invoicePda) return undefined;
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = sdk.subscribeInvoice(invoicePda, (next) => {
        if (!next) return;
        setInvoice(next);
        // A push update is not proof of finality: drop to "confirming" and
        // re-read at finalized before showing a final badge.
        setFinalized(false);
        setNonce((value) => value + 1);
        void sdk
          .fetchEscrowBalance(invoicePda, next.mint)
          .then((balance) => setEscrowBalance(balance))
          .catch(() => undefined);
      });
    } catch (caught) {
      // Live updates unavailable (e.g. SDK not wired); the fetch effect reports the error.
      setError(caught instanceof Error ? caught : new Error('Live updates are unavailable.'));
    }
    return () => unsubscribe();
  }, [invoicePda]);

  const errorKind = error
    ? /not found|does not exist|could not find account|account.*no data/i.test(error.message)
      ? 'not-found'
      : 'unavailable'
    : null;

  return { invoice, escrowBalance, loading, error, errorKind, finalized, refresh };
}
