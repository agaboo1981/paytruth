import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, PublicKey, type Connection, type VersionedTransactionResponse } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { parseTransaction } from '../../src/indexer/parseTransaction';
import { classifyPaymentAttempt, summarizeInvoicePayments, type PaymentClass } from '../../src/indexer/classify';
import { watchInvoiceSignatures } from '../../src/indexer/watcher';
import type { Invoice } from '../../src/types';
import { InvoiceStatus } from '../../src/types';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const fixturesDir = join(__dirname, '..', 'fixtures', 'tx');

function load(name: string): VersionedTransactionResponse {
  const raw = JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8'));
  return raw as VersionedTransactionResponse;
}

function inv(overrides: Partial<Invoice> = {}): Invoice {
  return {
    merchant: Keypair.generate().publicKey,
    payer: PublicKey.default,
    mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
    invoiceId: 1n,
    amountDue: 5_000_000n,
    paidAmount: 0n,
    refundedExcess: 0n,
    createdAt: 0n,
    expiresAt: 9_999_999_999n,
    status: InvoiceStatus.Open,
    claimed: false,
    bump: 255,
    memo: new Uint8Array(64),
    ...overrides,
  };
}

describe('parseTransaction', () => {
  it('parses a successful pay with its instruction and event', () => {
    const parsed = parseTransaction(load('paid-exact'), PROGRAM_ID);
    expect(parsed.ok).toBe(true);
    expect(parsed.instructions.length).toBe(1);
    expect(parsed.instructions[0]!.name).toBe('pay_invoice');
    expect((parsed.instructions[0]!.args.amount as { toString(): string }).toString()).toBe('5000000');
    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0]!.name).toBe('InvoicePaid');
    expect(parsed.error).toBeUndefined();
  });

  it('parses a failed pay and maps the error', () => {
    const parsed = parseTransaction(load('failed-underpayment'), PROGRAM_ID);
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.kind).toBe('program');
    expect(parsed.error?.code).toBe(6000);
    expect(parsed.error?.name).toBe('Underpayment');
    expect(parsed.instructions[0]!.name).toBe('pay_invoice');
  });

  it('finds no paytrth instructions in a plain SPL transfer', () => {
    const parsed = parseTransaction(load('unattributed-transfer'), PROGRAM_ID);
    expect(parsed.instructions.length).toBe(0);
  });

  it('finds no pay instructions in a System transfer', () => {
    const parsed = parseTransaction(load('not-a-payment'), PROGRAM_ID);
    expect(parsed.instructions.length).toBe(0);
    expect(parsed.ok).toBe(true);
  });
});

describe('classifyPaymentAttempt', () => {
  const open = inv();
  const paidExact = inv({ status: InvoiceStatus.Paid, paidAmount: 5_000_000n });

  it('pending when tx is null', () => {
    expect(classifyPaymentAttempt(null, open)).toBe('pending');
  });

  it('paid for an exact successful pay', () => {
    const parsed = parseTransaction(load('paid-exact'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, open)).toBe('paid');
  });

  it('overpaid for amount > amount_due', () => {
    const parsed = parseTransaction(load('overpaid'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, open)).toBe('overpaid');
  });

  it('failed (Underpayment) includes the reason', () => {
    const parsed = parseTransaction(load('failed-underpayment'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, open)).toBe('failed');
  });

  it('failed (InvoiceExpired)', () => {
    const parsed = parseTransaction(load('failed-expired'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, open)).toBe('failed');
  });

  it('failed InvoiceMismatch stays failed and exposes the reload reason', () => {
    const parsed = parseTransaction(load('failed-invoice-mismatch'), PROGRAM_ID);
    expect(parsed.error?.name).toBe('InvoiceMismatch');
    expect(parsed.error?.message).toBe('The invoice changed since you loaded it; reload and try again.');
    expect(classifyPaymentAttempt(parsed, open)).toBe('failed');
  });

  it('double-pay for a failed DuplicatePayment', () => {
    const parsed = parseTransaction(load('double-pay'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, paidExact)).toBe('double-pay');
  });

  it('double-pay for a second successful pay after another success was seen', () => {
    const parsed = parseTransaction(load('paid-exact'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, paidExact, { priorSuccessfulPay: true })).toBe('double-pay');
  });

  it('not-a-payment for unrelated transactions', () => {
    const parsed = parseTransaction(load('not-a-payment'), PROGRAM_ID);
    expect(classifyPaymentAttempt(parsed, open)).toBe('not-a-payment');
  });
});

describe('summarizeInvoicePayments', () => {
  it('never says paid when the account is Open, even if a pay tx was observed', () => {
    const parsed = parseTransaction(load('paid-exact'), PROGRAM_ID);
    const attempts: { cls: PaymentClass }[] = [{ cls: classifyPaymentAttempt(parsed, inv()) }];
    const summary = summarizeInvoicePayments(attempts.map((a) => ({ tx: null, cls: a.cls })), inv(), 'confirmed');
    expect(summary.chainStatus).toBe('unpaid');
    expect(summary.discrepancy).toContain('account not yet Paid');
  });

  it('unpaid when account is Open and no attempts', () => {
    const summary = summarizeInvoicePayments([], inv(), 'confirmed');
    expect(summary.chainStatus).toBe('unpaid');
    expect(summary.observed.paid).toBe(0);
  });

  it('paid when account is Paid with paid_amount == amount_due', () => {
    const summary = summarizeInvoicePayments([], inv({ status: InvoiceStatus.Paid, paidAmount: 5_000_000n }), 'finalized');
    expect(summary.chainStatus).toBe('paid');
  });

  it('overpaid only from account fields (paid_amount > amount_due)', () => {
    const summary = summarizeInvoicePayments([], inv({ status: InvoiceStatus.Paid, paidAmount: 6_000_000n }), 'finalized');
    expect(summary.chainStatus).toBe('overpaid');
  });

  it('expired from account', () => {
    const summary = summarizeInvoicePayments([], inv({ status: InvoiceStatus.Expired }), 'finalized');
    expect(summary.chainStatus).toBe('expired');
  });

  it('closed from the account tombstone, with paid history still observed', () => {
    const attempts: { tx: null; cls: PaymentClass }[] = [
      { tx: null, cls: 'paid' },
      { tx: null, cls: 'failed' },
    ];
    const summary = summarizeInvoicePayments(
      attempts,
      inv({ status: InvoiceStatus.Closed, paidAmount: 5_000_000n }),
      'confirmed',
    );
    expect(summary.chainStatus).toBe('closed');
    expect(summary.observed.paid).toBe(1);
    expect(summary.observed.failed).toBe(1);
    expect(summary.discrepancy).toBeUndefined();
  });

  it('not_found when account is null', () => {
    const summary = summarizeInvoicePayments([], null, 'finalized');
    expect(summary.chainStatus).toBe('not_found');
  });

  it('counts observed classes', () => {
    const summary = summarizeInvoicePayments(
      [
        { tx: null, cls: 'paid' },
        { tx: null, cls: 'double-pay' },
        { tx: null, cls: 'failed' },
      ],
      inv({ status: InvoiceStatus.Paid, paidAmount: 5_000_000n }),
      'confirmed',
    );
    expect(summary.observed.paid).toBe(1);
    expect(summary.observed['double-pay']).toBe(1);
    expect(summary.observed.failed).toBe(1);
  });
});

describe('watchInvoiceSignatures', () => {
  it('polls signatures, parses, classifies and calls onUpdate; no writes', async () => {
    const invoicePda = new PublicKey('So11111111111111111111111111111111111111112');
    const escrow = Keypair.generate().publicKey;
    const paidTx = load('paid-exact');
    const getSignaturesForAddress = vi.fn().mockImplementation(async (addr: PublicKey) => {
      if (addr.equals(invoicePda)) return [{ signature: 'SIG_A', slot: 1, blockTime: 1, err: null }];
      return [];
    });
    const getTransaction = vi.fn().mockResolvedValue(paidTx);
    const conn = {
      getSignaturesForAddress,
      getTransaction,
      getAccountInfo: vi.fn(),
    } as unknown as Connection;

    const updates: unknown[] = [];
    const stop = await watchInvoiceSignatures(conn, invoicePda, {
      escrowAddress: escrow,
      commitment: 'confirmed',
      pollMs: 5,
      onUpdate: (s) => updates.push(s),
      until: (s) => (s as { observed: { paid: number } }).observed.paid > 0,
      fetchInvoice: async () => inv({ status: InvoiceStatus.Paid, paidAmount: 5_000_000n }),
    });

    // Wait for at least one update then stop.
    for (let i = 0; i < 50 && updates.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    stop();
    expect(updates.length).toBeGreaterThan(0);
    // Should have queried both the invoice and the escrow address.
    const queried = getSignaturesForAddress.mock.calls.map((c) => (c[0] as PublicKey).toBase58());
    expect(queried).toContain(escrow.toBase58());
  });
});
