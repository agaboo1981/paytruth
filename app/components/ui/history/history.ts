import {
  PublicKey,
  type Connection,
  type ConfirmedSignatureInfo,
  type TokenBalance,
  type VersionedTransactionResponse,
} from '@solana/web3.js';

import { parseTransaction, type ParsedPaytruthTx } from '../../../lib/paytruth';
import { InvoiceStatus, type Invoice } from '../sdk/types';

/** Real IDL instruction names (snake_case in the Anchor 0.30+ IDL). */
export type PaytruthIxName =
  | 'create_invoice'
  | 'pay_invoice'
  | 'merchant_claim'
  | 'refund_overpayment'
  | 'expire_invoice'
  | 'close_invoice'
  | 'recover_unattributed';

export const ACTION_COPY: Record<PaytruthIxName, string> = {
  create_invoice: 'Invoice created',
  pay_invoice: 'Customer paid',
  merchant_claim: 'Merchant claimed the payment',
  refund_overpayment: 'Extra refunded to customer',
  expire_invoice: 'Marked as expired',
  close_invoice: 'Invoice closed',
  recover_unattributed: 'Leftover funds recovered',
};

/**
 * Where the amount came from:
 *  - 'escrow': escrow token-account balance change in this tx (pre/postTokenBalances, owner = invoice PDA)
 *  - 'args':   the instruction's own arguments (create_invoice.amount_due, pay_invoice.amount)
 */
export type AmountSource = 'escrow' | 'args';

export type HistoryEntry = {
  signature: string;
  blockTime: number | null;
  slot: number;
  ok: boolean;
  action: PaytruthIxName | 'unknown';
  label: string;
  /** Positive = into escrow, negative = out of escrow. Absolute value shown in the UI. */
  amount: bigint | null;
  amountSource: AmountSource | null;
  errorMessage?: string;
  demo?: boolean;
};

function toBig(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  try {
    return BigInt((v as { toString(): string }).toString());
  } catch {
    return null;
  }
}

/** Net change of tokens held by accounts owned by `owner` (the invoice PDA owns its escrow ATA). */
export function escrowDelta(
  pre: TokenBalance[] | null | undefined,
  post: TokenBalance[] | null | undefined,
  owner: string,
): bigint | null {
  const sum = (list: TokenBalance[] | null | undefined) => {
    let found = false;
    let total = 0n;
    for (const b of list ?? []) {
      if (b.owner !== owner) continue;
      found = true;
      total += BigInt(b.uiTokenAmount.amount);
    }
    return { found, total };
  };
  const a = sum(pre);
  const b = sum(post);
  if (!a.found && !b.found) return null;
  return b.total - a.total;
}

const KNOWN = new Set<string>(Object.keys(ACTION_COPY));

/** Turn one parsed Paytruth transaction into history entries that touch `invoicePda`. */
export function entriesFromParsed(
  parsed: ParsedPaytruthTx,
  invoicePda: string,
  balances: { pre?: TokenBalance[] | null; post?: TokenBalance[] | null },
): HistoryEntry[] {
  const delta = escrowDelta(balances.pre, balances.post, invoicePda);
  const relevant = parsed.instructions.filter((ix) => ix.accounts.includes(invoicePda));
  return relevant.map((ix) => {
    const action = (KNOWN.has(ix.name) ? ix.name : 'unknown') as HistoryEntry['action'];
    let amount: bigint | null = null;
    let amountSource: AmountSource | null = null;
    // One Paytruth ix per tx in practice, so the escrow delta belongs to it.
    if (parsed.ok && delta !== null && delta !== 0n && relevant.length === 1) {
      amount = delta;
      amountSource = 'escrow';
    } else if (action === 'pay_invoice') {
      amount = toBig(ix.args.amount);
      amountSource = amount !== null ? 'args' : null;
    } else if (action === 'create_invoice') {
      amount = toBig(ix.args.amount_due);
      amountSource = amount !== null ? 'args' : null;
    }
    return {
      signature: parsed.signature,
      blockTime: parsed.blockTime,
      slot: parsed.slot,
      ok: parsed.ok,
      action,
      label: action === 'unknown' ? ix.name : ACTION_COPY[action],
      amount,
      amountSource,
      errorMessage: parsed.ok ? undefined : parsed.error?.message ?? 'Transaction failed',
    };
  });
}

export type FetchHistoryOptions = { limit?: number; batchSize?: number; pauseMs?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|too many requests/i.test(msg) || (e as { code?: number })?.code === 429;
}

/** Retry only on HTTP 429 (public devnet RPC rate limit), with backoff 0.8s, 1.6s, 3.2s. */
async function withRateLimitRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt >= tries - 1) throw e;
      await sleep(800 * 2 ** attempt);
    }
  }
}

/**
 * Real chain history, newest first: 1 getSignaturesForAddress + ceil(n / batchSize) batched getTransaction calls.
 * Defaults keep the public devnet RPC happy (max 25 sigs, batches of 4, 400 ms between batches, backoff retry on 429).
 */
export async function fetchInvoiceHistory(
  connection: Connection,
  programId: PublicKey,
  invoicePda: PublicKey,
  opts: FetchHistoryOptions = {},
): Promise<{ entries: HistoryEntry[]; signatures: number; requests: number; truncated: boolean }> {
  const limit = opts.limit ?? 25;
  const batchSize = opts.batchSize ?? 4;
  const pauseMs = opts.pauseMs ?? 400;
  const sigs: ConfirmedSignatureInfo[] = await withRateLimitRetry(() =>
    connection.getSignaturesForAddress(invoicePda, { limit }, 'confirmed'),
  );
  let requests = 1;
  const pda = invoicePda.toBase58();
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < sigs.length; i += batchSize) {
    if (i > 0 && pauseMs > 0) await sleep(pauseMs);
    const chunk = sigs.slice(i, i + batchSize);
    const txs: (VersionedTransactionResponse | null)[] = await withRateLimitRetry(() =>
      connection.getTransactions(
        chunk.map((s) => s.signature),
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      ),
    );
    requests += 1;
    txs.forEach((tx, j) => {
      const info = chunk[j];
      if (!tx) return;
      const parsed = parseTransaction(tx, programId);
      if (!parsed.signature) parsed.signature = info.signature;
      if (parsed.blockTime === null && info.blockTime) parsed.blockTime = info.blockTime;
      entries.push(...entriesFromParsed(parsed, pda, { pre: tx.meta?.preTokenBalances, post: tx.meta?.postTokenBalances }));
    });
  }
  entries.sort((a, b) => (b.slot - a.slot) || ((b.blockTime ?? 0) - (a.blockTime ?? 0)));
  return { entries, signatures: sigs.length, requests, truncated: sigs.length >= limit };
}

/** Demo-build only (NEXT_PUBLIC_PAYTRUTH_SDK=mock): history implied by the simulated invoice's fields. */
export function mockHistoryFor(invoice: Invoice): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  const base = Number(invoice.createdAt);
  const push = (action: PaytruthIxName, offset: number, amount: bigint | null) =>
    out.push({
      signature: `demo-${action}`,
      blockTime: base + offset,
      slot: base + offset,
      ok: true,
      action,
      label: ACTION_COPY[action],
      amount,
      amountSource: amount === null ? null : action === 'create_invoice' ? 'args' : 'escrow',
      demo: true,
    });
  push('create_invoice', 0, invoice.amountDue);
  if (invoice.paidAmount > 0n) push('pay_invoice', 60, invoice.paidAmount);
  if (invoice.refundedExcess > 0n) push('refund_overpayment', 120, -invoice.refundedExcess);
  if (invoice.claimed) push('merchant_claim', 180, -invoice.amountDue);
  if (invoice.status === InvoiceStatus.Expired) push('expire_invoice', Math.max(240, Number(invoice.expiresAt) - base), null);
  if (invoice.status === InvoiceStatus.Closed) push('close_invoice', 300, null);
  return out.reverse();
}
