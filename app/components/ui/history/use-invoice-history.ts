'use client';

import type { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getBoundClient } from '../../../lib/paytruth';
import { isMock, sdk } from '../sdk/client';
import { fetchInvoiceHistory, mockHistoryFor, type HistoryEntry } from './history';

type Result = { entries: HistoryEntry[]; truncated: boolean };
// Session cache so re-expanding a row doesn't hit the RPC again.
const cache = new Map<string, Result>();

export function useInvoiceHistory(invoicePda: PublicKey | null) {
  const key = invoicePda?.toBase58() ?? '';
  const [data, setData] = useState<Result | null>(() => (key ? cache.get(key) ?? null : null));
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const req = useRef(0);

  useEffect(() => {
    if (!invoicePda) return;
    if (tick === 0 && cache.has(key)) {
      setData(cache.get(key)!);
      return;
    }
    const id = ++req.current;
    setLoading(true);
    setError(null);
    (async (): Promise<Result> => {
      if (isMock) {
        const inv = await sdk.fetchInvoice(invoicePda);
        return { entries: mockHistoryFor(inv), truncated: false };
      }
      const client = getBoundClient();
      const r = await fetchInvoiceHistory(client.connection, client.programId, invoicePda);
      return { entries: r.entries, truncated: r.truncated };
    })()
      .then((r) => {
        if (id !== req.current) return;
        cache.set(key, r);
        setData(r);
      })
      .catch((e: unknown) => {
        if (id === req.current) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (id === req.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh };
}
