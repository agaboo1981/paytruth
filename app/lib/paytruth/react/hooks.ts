'use client';
// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bindPaytruth, paytruthSdk } from '../bound';
import { PaytruthClient } from '../client';
import { InvoiceNotFoundError, WalletNotSupportedError } from '../errors';
import { deriveInvoiceView, type InvoiceView as MachineView } from '../state';
import type { PaytruthWallet } from '../send';
import type { Commitment, Invoice, PaytruthSdk } from '../types';

/**
 * Build a PaytruthClient from the wallet-adapter connection + wallet. The
 * wallet is attached only when connected AND it exposes signTransaction; if it
 * lacks that surface the wallet stays unbound and writes throw a friendly
 * connection error (we never fall back to the wallet's sendTransaction).
 */
export function usePaytruthClient(): PaytruthSdk {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  return useMemo(() => {
    let wallet: PaytruthWallet | undefined;
    if (connected && publicKey) {
      if (typeof signTransaction === 'function') {
        wallet = {
          publicKey,
          signTransaction: signTransaction as <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
        };
      }
      // If signTransaction is missing, wallet stays undefined (write-time error).
    }
    return new PaytruthClient({ connection, wallet });
  }, [connection, publicKey, signTransaction, connected]);
}

/** Assert the connected wallet supports signTransaction, else throw. */
export function assertWalletSupportsSigning(wallet: unknown): asserts wallet is PaytruthWallet {
  const w = wallet as { publicKey?: PublicKey; signTransaction?: unknown } | null;
  if (!w || !w.publicKey || typeof w.signTransaction !== 'function') {
    throw new WalletNotSupportedError(
      'This wallet does not expose signTransaction. Paytruth will not fall back to wallet sendTransaction.',
    );
  }
}

export type InvoiceErrorKind = 'not-found' | 'unavailable' | null;

/**
 * Mirrors app/components/ui/sdk/use-invoice-view.ts plus a derived `view`.
 */
export interface InvoiceView {
  invoice: Invoice | null;
  escrowBalance: bigint | null;
  loading: boolean;
  error: Error | null;
  errorKind: InvoiceErrorKind;
  finalized: boolean;
  refresh: () => void;
  view: MachineView | null;
}

export interface UseInvoiceOptions {
  commitment?: Commitment;
  client?: PaytruthSdk;
}

function matches(a: Invoice, b: Invoice): boolean {
  return (
    a.status === b.status &&
    a.claimed === b.claimed &&
    a.paidAmount === b.paidAmount &&
    a.refundedExcess === b.refundedExcess
  );
}

function toErrorKind(err: unknown): InvoiceErrorKind {
  if (err instanceof InvoiceNotFoundError) return 'not-found';
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message)) return 'not-found';
  return 'unavailable';
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : 'Could not read the invoice.');
}

/**
 * Read an invoice + escrow balance from chain and live-update. Status always
 * comes from the account. `finalized` is true only when the finalized account
 * matches the confirmed one on the fields that matter for settlement.
 */
export function useInvoice(invoicePda: PublicKey | null, opts?: UseInvoiceOptions): InvoiceView {
  const client = opts?.client ?? paytruthSdk;
  const commitment = opts?.commitment ?? 'confirmed';

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [escrowBalance, setEscrowBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [errorKind, setErrorKind] = useState<InvoiceErrorKind>(null);
  const [finalized, setFinalized] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((v) => v + 1), []);
  // Stable key: callers often pass a fresh PublicKey each render. Effects
  // depend on this memoized instance so they only re-run when the address
  // actually changes.
  const pdaKey = invoicePda ? invoicePda.toBase58() : null;
  const pda = useMemo(() => (pdaKey ? new PublicKey(pdaKey) : null), [pdaKey]);
  const recheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch / reconcile effect: re-runs on refresh (nonce), commitment, client
  // or address change. Never touches the websocket subscription.
  useEffect(() => {
    if (!pda) {
      setInvoice(null);
      setEscrowBalance(null);
      setLoading(false);
      setError(null);
      setErrorKind(null);
      setFinalized(false);
      return undefined;
    }

    let active = true;
    if (recheckTimer.current) {
      clearTimeout(recheckTimer.current);
      recheckTimer.current = null;
    }
    setLoading(true);

    const load = async () => {
      try {
        const confirmed = await client.fetchInvoice(pda, 'confirmed');
        if (!active) return;
        setInvoice(confirmed);
        setEscrowBalance(await client.fetchEscrowBalance(pda, confirmed.mint).catch(() => null));
        setError(null);
        setErrorKind(null);

        const [finalizedInvoice, balance] = await Promise.all([
          client.fetchInvoice(pda, 'finalized').catch(() => null),
          client.fetchEscrowBalance(pda, confirmed.mint).catch(() => null),
        ]);
        if (!active) return;
        setEscrowBalance(balance);
        if (finalizedInvoice && matches(confirmed, finalizedInvoice)) {
          setFinalized(true);
          setInvoice(finalizedInvoice);
        } else {
          // Not yet finalized: show the confirmed account and re-check later.
          setFinalized(false);
          setInvoice(confirmed);
          recheckTimer.current = setTimeout(() => {
            if (active) setNonce((v) => v + 1);
          }, 2000);
        }
      } catch (caught) {
        if (!active) return;
        setInvoice(null);
        setEscrowBalance(null);
        setFinalized(false);
        setError(asError(caught));
        setErrorKind(toErrorKind(caught));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
      if (recheckTimer.current) {
        clearTimeout(recheckTimer.current);
        recheckTimer.current = null;
      }
    };
  }, [client, pda, commitment, nonce]);

  // Subscription effect: depends only on the client (connection) and the
  // address, so refresh() never tears down / re-opens the websocket.
  useEffect(() => {
    if (!pda) return undefined;
    let active = true;
    const unsubscribe = client.subscribeInvoice(pda, (next) => {
      if (!active) return;
      if (next === null) {
        // Account removed.
        setInvoice(null);
        setEscrowBalance(0n);
        setFinalized(false);
        setError(new InvoiceNotFoundError(pda.toBase58()));
        setErrorKind('not-found');
        return;
      }
      // A push indicates a change not yet reflected at the confirmed read.
      setFinalized(false);
      setInvoice(next);
      void client
        .fetchEscrowBalance(pda, next.mint)
        .then((b) => {
          if (active) setEscrowBalance(b);
        })
        .catch(() => undefined);
      // Trigger a fresh confirmed+finalized reconcile (re-fetch only).
      setNonce((v) => v + 1);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, pda]);

  const view = useMemo(() => {
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (pda === null) return null;
    return deriveInvoiceView(invoice, escrowBalance, { commitment, nowSec });
  }, [invoice, escrowBalance, commitment, pda]);

  return { invoice, escrowBalance, loading, error, errorKind, finalized, refresh, view };
}

/** Alias matching the UI-owned hook name. */
export const useInvoiceView = useInvoice;

/**
 * Inner bridge: keeps the bound singleton in sync with the connected
 * wallet/connection so `paytruthSdk` (used by real-sdk / hooks) is always
 * current. Renders nothing.
 */
export function PaytruthBridge(): null {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  useEffect(() => {
    let wallet: PaytruthWallet | null = null;
    if (connected && publicKey && typeof signTransaction === 'function') {
      wallet = {
        publicKey,
        signTransaction: signTransaction as <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
      };
    }
    bindPaytruth({ connection, wallet });
  }, [connection, publicKey, signTransaction, connected]);

  return null;
}
