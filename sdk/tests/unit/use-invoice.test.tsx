import { PublicKey } from '@solana/web3.js';
import { act, renderHook, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceNotFoundError } from '../../src/errors';
import { InvoiceStatus, type Invoice } from '../../src/types';

vi.mock('@solana/wallet-adapter-react', () => ({
  ConnectionProvider: ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
  WalletProvider: ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
  useConnection: () => ({ connection: { rpcEndpoint: 'http://localhost:8899' } }),
  useWallet: () => ({ connected: false, publicKey: null, signTransaction: undefined }),
}));
vi.mock('@solana/wallet-adapter-react-ui', () => ({
  WalletModalProvider: ({ children }: { children: ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { useInvoice, useInvoiceView } from '../../src/react/index';
import type { PaytruthSdk } from '../../src/types';

const invoicePda = new PublicKey('So11111111111111111111111111111111111111112');

function sampleInvoice(status: InvoiceStatus, paidAmount = 0n, claimed = false): Invoice {
  return {
    merchant: PublicKey.default,
    payer: PublicKey.default,
    mint: PublicKey.default,
    invoiceId: 1n,
    amountDue: 100n,
    paidAmount,
    refundedExcess: 0n,
    createdAt: 0n,
    expiresAt: 9_999_999_999n,
    status,
    claimed,
    bump: 255,
    memo: new Uint8Array(64),
  };
}

function makeClient(overrides: Partial<PaytruthSdk>): PaytruthSdk {
  return {
    getInvoicePda: () => [PublicKey.default, 0],
    getConfigPda: () => [PublicKey.default, 0],
    getEscrowAta: () => PublicKey.default,
    fetchConfig: vi.fn(),
    fetchInvoice: vi.fn(),
    fetchInvoiceByMerchantAndId: vi.fn(),
    fetchEscrowBalance: vi.fn().mockResolvedValue(0n),
    initializeConfig: vi.fn(),
    createInvoice: vi.fn(),
    payInvoice: vi.fn(),
    merchantClaim: vi.fn(),
    refundOverpayment: vi.fn(),
    expireInvoice: vi.fn(),
    recoverUnattributed: vi.fn(),
    closeInvoice: vi.fn(),
    waitForInvoiceState: vi.fn(),
    subscribeInvoice: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  } as PaytruthSdk;
}

describe('useInvoice', () => {
  it('finalized=false when confirmed and finalized accounts differ', async () => {
    const confirmed = sampleInvoice(InvoiceStatus.Paid, 100n);
    const finalized = sampleInvoice(InvoiceStatus.Paid, 200n);
    const fetchInvoice = vi.fn(async (_pda: PublicKey, c?: string) =>
      c === 'finalized' ? finalized : confirmed,
    );
    const client = makeClient({ fetchInvoice, fetchEscrowBalance: vi.fn().mockResolvedValue(100n) });

    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.finalized).toBe(false);
    expect(result.current.invoice?.paidAmount).toBe(100n);
    expect(result.current.escrowBalance).toBe(100n);
    expect(result.current.errorKind).toBeNull();
  });

  it('finalized=true when confirmed and finalized accounts match', async () => {
    const same = sampleInvoice(InvoiceStatus.Paid, 100n);
    const fetchInvoice = vi.fn().mockResolvedValue(same);
    const client = makeClient({ fetchInvoice, fetchEscrowBalance: vi.fn().mockResolvedValue(100n) });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.finalized).toBe(true);
    expect(result.current.invoice?.paidAmount).toBe(100n);
  });

  it('maps InvoiceNotFoundError to errorKind not-found', async () => {
    const fetchInvoice = vi.fn().mockRejectedValue(new InvoiceNotFoundError(invoicePda.toBase58()));
    const client = makeClient({ fetchInvoice });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errorKind).toBe('not-found');
    expect(result.current.error?.message.toLowerCase()).toContain('not found');
  });

  it('maps other errors to errorKind unavailable', async () => {
    const fetchInvoice = vi.fn().mockRejectedValue(new Error('rpc down'));
    const client = makeClient({ fetchInvoice });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errorKind).toBe('unavailable');
  });

  it('null push sets invoice null with errorKind not-found', async () => {
    const open = sampleInvoice(InvoiceStatus.Open);
    let pushCb: ((inv: Invoice | null) => void) | undefined;
    const fetchInvoice = vi.fn().mockResolvedValue(open);
    const subscribeInvoice = vi.fn((_pda: PublicKey, cb: (inv: Invoice | null) => void) => {
      pushCb = cb;
      return () => {};
    });
    const client = makeClient({ fetchInvoice, subscribeInvoice });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      pushCb?.(null);
    });
    await waitFor(() => expect(result.current.invoice).toBeNull());
    expect(result.current.errorKind).toBe('not-found');
  });

  it('push sets finalized false and triggers a refetch', async () => {
    const open = sampleInvoice(InvoiceStatus.Open);
    const paid = sampleInvoice(InvoiceStatus.Paid, 100n);
    let pushCb: ((inv: Invoice | null) => void) | undefined;
    let call = 0;
    const fetchInvoice = vi.fn(async (_pda: PublicKey, c?: string) => {
      // First confirmed fetch = open; after push, refetch = paid.
      if (call++ === 0) return open;
      return c === 'finalized' ? paid : paid;
    });
    const subscribeInvoice = vi.fn((_pda: PublicKey, cb: (inv: Invoice | null) => void) => {
      pushCb = cb;
      return () => {};
    });
    const client = makeClient({ fetchInvoice, subscribeInvoice });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      pushCb?.(paid);
    });
    await waitFor(() => expect(result.current.invoice?.status).toBe(InvoiceStatus.Paid));
  });

  it('returns the exact InvoiceView shape including view', async () => {
    const open = sampleInvoice(InvoiceStatus.Open);
    const client = makeClient({ fetchInvoice: vi.fn().mockResolvedValue(open) });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toHaveProperty('invoice');
    expect(result.current).toHaveProperty('escrowBalance');
    expect(result.current).toHaveProperty('loading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('errorKind');
    expect(result.current).toHaveProperty('finalized');
    expect(typeof result.current.refresh).toBe('function');
    expect(result.current.view?.phase).toBe('open');
  });

  it('null pda clears state without fetching', async () => {
    const fetchInvoice = vi.fn();
    const client = makeClient({ fetchInvoice });
    const { result } = renderHook(() => useInvoice(null, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchInvoice).not.toHaveBeenCalled();
    expect(result.current.invoice).toBeNull();
  });

  it('refresh() re-fetches without re-subscribing', async () => {
    const open = sampleInvoice(InvoiceStatus.Open);
    const fetchInvoice = vi.fn().mockResolvedValue(open);
    const unsub = vi.fn();
    const subscribeInvoice = vi.fn().mockReturnValue(unsub);
    const client = makeClient({ fetchInvoice, subscribeInvoice });
    const { result } = renderHook(() => useInvoice(invoicePda, { client }), { wrapper: pass });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const fetchesBefore = fetchInvoice.mock.calls.length;
    expect(subscribeInvoice).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetchInvoice.mock.calls.length).toBeGreaterThan(fetchesBefore));
    expect(subscribeInvoice).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();
  });

  it('a new PublicKey instance for the same address does not re-subscribe; a new address does', async () => {
    const open = sampleInvoice(InvoiceStatus.Open);
    const unsub = vi.fn();
    const subscribeInvoice = vi.fn().mockReturnValue(unsub);
    const client = makeClient({ fetchInvoice: vi.fn().mockResolvedValue(open), subscribeInvoice });
    const { result, rerender } = renderHook(({ pda }) => useInvoice(pda, { client }), {
      wrapper: pass,
      initialProps: { pda: new PublicKey(invoicePda.toBase58()) },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ pda: new PublicKey(invoicePda.toBase58()) });
    expect(subscribeInvoice).toHaveBeenCalledTimes(1);
    const other = new PublicKey('Gf8EFcdfrj8LJg9pC6T74UqCsv4LsP6S25PjHmktRVdW');
    rerender({ pda: other });
    await waitFor(() => expect(subscribeInvoice).toHaveBeenCalledTimes(2));
    expect(unsub).toHaveBeenCalledTimes(1);
    expect((subscribeInvoice.mock.calls[1]![0] as PublicKey).equals(other)).toBe(true);
  });

  it('exports useInvoiceView as an alias', () => {
    expect(useInvoiceView).toBe(useInvoice);
  });
});

function pass({ children }: { children: ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}
