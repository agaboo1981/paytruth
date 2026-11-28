'use client';

import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getBoundClient } from '../../../lib/paytruth';
import { isMock, sdk } from '../sdk/client';
import { FIXTURE_LABELS, fixturePda } from '../sdk/fixtures';
import { fetchInvoicesFor, type InvoiceRole, type ListedInvoice } from './query';

async function mockList(role: InvoiceRole, wallet: PublicKey): Promise<ListedInvoice[]> {
  const out: ListedInvoice[] = [];
  for (const label of FIXTURE_LABELS) {
    const pda = new PublicKey(fixturePda(label));
    try {
      const invoice = await sdk.fetchInvoice(pda);
      const who = role === 'merchant' ? invoice.merchant : invoice.payer;
      if (who.equals(wallet)) out.push({ pda, invoice });
    } catch {
      // closed fixtures may not exist
    }
  }
  return out;
}

export type MyInvoicesState = {
  rows: ListedInvoice[] | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
};

export function useMyInvoices(wallet: PublicKey | null, role: InvoiceRole): MyInvoicesState {
  const [rows, setRows] = useState<ListedInvoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const reqId = useRef(0);
  const key = wallet?.toBase58() ?? '';

  useEffect(() => {
    setRows(null);
    setError(null);
  }, [key, role]);

  useEffect(() => {
    if (!key) return;
    const id = ++reqId.current;
    const owner = new PublicKey(key);
    setLoading(true);
    setError(null);
    (async () => {
      if (isMock) return mockList(role, owner);
      const client = getBoundClient();
      return fetchInvoicesFor(client.connection, client.programId, role, owner);
    })()
      .then((list) => {
        if (id !== reqId.current) return;
        setRows(list);
      })
      .catch((err: unknown) => {
        if (id !== reqId.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (id === reqId.current) setLoading(false);
      });
  }, [key, role, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { rows, loading, error, refresh };
}
