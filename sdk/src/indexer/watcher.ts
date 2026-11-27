import { PublicKey, type Connection } from '@solana/web3.js';
import type { Commitment, Invoice } from '../types';
import { resolveProgramId } from '../program';
import { fetchInvoiceOrNull } from '../accounts';
import { parseTransaction } from './parseTransaction';
import {
  classifyPaymentAttempt,
  summarizeInvoicePayments,
  type InvoicePaymentAttempt,
  type InvoicePaymentSummary,
  type PaymentClass,
} from './classify';

export interface WatchInvoiceOptions {
  commitment?: Commitment;
  pollMs?: number;
  onUpdate: (summary: InvoicePaymentSummary) => void;
  /** Stop when this predicate returns true for a summary. */
  until?: (summary: InvoicePaymentSummary) => boolean;
  /** Extra address to watch for signatures (the escrow ATA), so direct transfers are seen. */
  escrowAddress?: PublicKey;
  programId?: PublicKey;
  /** Invoice account fetcher; defaults to the SDK fetchInvoice at the given commitment. */
  fetchInvoice?: (commitment: Commitment) => Promise<Invoice | null>;
}

/**
 * Read-only invoice watcher. Polls signatures for the invoice and (optionally)
 * its escrow ATA, parses each new transaction, classifies it, and re-reads the
 * Invoice account to build a summary. Never writes; status always comes from
 * the account. Returns a stop() function.
 */
export async function watchInvoiceSignatures(
  connection: Connection,
  invoicePda: PublicKey,
  opts: WatchInvoiceOptions,
): Promise<() => void> {
  const commitment = opts.commitment ?? 'confirmed';
  const pollMs = opts.pollMs ?? 4_000;
  const programId = opts.programId ?? resolveProgramId();
  const fetcher = opts.fetchInvoice ?? ((c: Commitment) => fetchInvoiceOrNull(connection, invoicePda, c, programId));

  const seen = new Set<string>();
  const attempts: InvoicePaymentAttempt[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function pollOnce(): Promise<void> {
    const addresses = [invoicePda];
    if (opts.escrowAddress) addresses.push(opts.escrowAddress);

    let newAttempts = false;
    for (const address of addresses) {
      let signatures: Awaited<ReturnType<Connection['getSignaturesForAddress']>>;
      try {
        signatures = await connection.getSignaturesForAddress(address, { limit: 25 }, commitment as never);
      } catch {
        continue;
      }
      for (const sigInfo of signatures) {
        if (!sigInfo.signature || seen.has(sigInfo.signature)) continue;
        seen.add(sigInfo.signature);
        let parsed = null;
        try {
          const raw = await connection.getTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: commitment as never,
          } as never);
          parsed = raw ? parseTransaction(raw, programId) : null;
        } catch {
          parsed = null;
        }
        attempts.push({ tx: parsed, cls: 'pending' });
        newAttempts = true;
      }
    }

    // Re-classify all attempts against a fresh account read.
    if (newAttempts || attempts.length === 0) {
      let account: Invoice | null = null;
      try {
        account = await fetcher(commitment);
      } catch {
        account = null;
      }
      // Classify every attempt against the latest account snapshot.
      let priorSuccessful = false;
      for (const a of attempts) {
        if (a.tx) {
          a.cls = classifyPaymentAttempt(a.tx, account ?? placeholderInvoice(), { priorSuccessfulPay: priorSuccessful });
          if (a.cls === 'paid' || a.cls === 'overpaid') priorSuccessful = true;
        }
      }
      const summary = summarizeInvoicePayments(attempts, account, commitment);
      opts.onUpdate(summary);
      if (opts.until?.(summary)) {
        stopped = true;
      }
    }
  }

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      await pollOnce();
    } catch {
      // swallow; next tick retries
    }
    if (stopped) return;
    timer = setTimeout(() => void loop(), pollMs);
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  }

  await loop();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function placeholderInvoice(): Invoice {
  return {
    merchant: PublicKey.default,
    payer: PublicKey.default,
    mint: PublicKey.default,
    invoiceId: 0n,
    amountDue: 0n,
    paidAmount: 0n,
    refundedExcess: 0n,
    createdAt: 0n,
    expiresAt: 0n,
    status: 0 as Invoice['status'],
    claimed: false,
    bump: 0,
    memo: new Uint8Array(64),
  };
}

export type { PaymentClass };
