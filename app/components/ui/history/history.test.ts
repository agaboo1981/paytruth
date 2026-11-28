import { BorshInstructionCoder, BN } from '@anchor-lang/core';
import { Keypair, PublicKey, TransactionMessage, type TokenBalance, type VersionedTransactionResponse } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { PAYTRUTH_IDL, parseTransaction } from '../../../lib/paytruth';
import { InvoiceStatus, type Invoice } from '../sdk/types';
import { entriesFromParsed, escrowDelta, mockHistoryFor } from './history';
import { filterCounts, matchesFilter, type StatusFilter } from '../invoices/query';

const programId = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const ixCoder = new BorshInstructionCoder(PAYTRUTH_IDL as never);
const invoice = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;

function tb(owner: string, amount: string, accountIndex = 3): TokenBalance {
  return { accountIndex, mint: mint.toBase58(), owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: '' } };
}

function txWith(name: string, args: Record<string, unknown>, accounts: PublicKey[], meta: Partial<VersionedTransactionResponse['meta']> = {}): VersionedTransactionResponse {
  const data = ixCoder.encode(name, args);
  const msg = new TransactionMessage({
    payerKey: accounts[0],
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [{ programId, data, keys: accounts.map((pubkey, i) => ({ pubkey, isSigner: i === 0, isWritable: true })) }],
  }).compileToLegacyMessage();
  return {
    slot: 10,
    blockTime: 1_700_000_000,
    transaction: { message: msg, signatures: ['sig1'] },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [], preTokenBalances: [], postTokenBalances: [], logMessages: [], ...meta },
  } as unknown as VersionedTransactionResponse;
}

describe('history instruction parser (real IDL coder)', () => {
  it('decodes pay_invoice and takes the amount from the escrow balance change', () => {
    const accts = [payer, Keypair.generate().publicKey, invoice, mint, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const raw = txWith('pay_invoice', { amount: new BN(1_250_000), expected_amount_due: new BN(1_000_000) }, accts, {
      preTokenBalances: [tb(invoice.toBase58(), '0')],
      postTokenBalances: [tb(invoice.toBase58(), '1250000')],
    });
    const parsed = parseTransaction(raw, programId);
    const [e] = entriesFromParsed(parsed, invoice.toBase58(), { pre: raw.meta!.preTokenBalances, post: raw.meta!.postTokenBalances });
    expect(e).toMatchObject({ action: 'pay_invoice', label: 'Customer paid', amount: 1_250_000n, amountSource: 'escrow', ok: true });
  });

  it('falls back to instruction args for create_invoice when escrow did not change', () => {
    const accts = [Keypair.generate().publicKey, Keypair.generate().publicKey, invoice, mint, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const raw = txWith('create_invoice', { invoice_id: new BN(1), amount_due: new BN(2_000_000), expires_at: new BN(9), memo: new Array(64).fill(0) }, accts);
    const [e] = entriesFromParsed(parseTransaction(raw, programId), invoice.toBase58(), {});
    expect(e).toMatchObject({ action: 'create_invoice', amount: 2_000_000n, amountSource: 'args' });
  });

  it('marks failed transactions and ignores instructions for other invoices', () => {
    const accts = [Keypair.generate().publicKey, invoice, mint, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const raw = txWith('merchant_claim', {}, accts, { err: { InstructionError: [0, { Custom: 6004 }] } as never });
    const parsed = parseTransaction(raw, programId);
    const [e] = entriesFromParsed(parsed, invoice.toBase58(), {});
    expect(e.ok).toBe(false);
    expect(e.action).toBe('merchant_claim');
    expect(e.amount).toBeNull();
    expect(entriesFromParsed(parsed, Keypair.generate().publicKey.toBase58(), {})).toHaveLength(0);
  });

  it('escrowDelta handles created and closed escrow accounts', () => {
    const o = invoice.toBase58();
    expect(escrowDelta([], [tb(o, '5')], o)).toBe(5n);
    expect(escrowDelta([tb(o, '5')], [], o)).toBe(-5n);
    expect(escrowDelta([tb('x', '5')], [tb('x', '9')], o)).toBeNull();
  });
});

function inv(p: Partial<Invoice>): Invoice {
  return {
    merchant: Keypair.generate().publicKey, payer: PublicKey.default, mint, invoiceId: 1n, amountDue: 1_000_000n, paidAmount: 0n,
    refundedExcess: 0n, createdAt: 100n, expiresAt: 1_000n, status: InvoiceStatus.Open, claimed: false, bump: 1, memo: new Uint8Array(64), ...p,
  };
}

describe('status filter mapping', () => {
  const now = 500n;
  const match = (i: Invoice) => (['needs-action', 'open', 'paid', 'claimed', 'overpaid', 'expired', 'closed'] as StatusFilter[]).filter((f) => matchesFilter(i, f, now));
  it('maps each state from on-chain fields; an invoice can match several tabs', () => {
    expect(match(inv({}))).toEqual(['open']);
    expect(match(inv({ expiresAt: 400n }))).toEqual(['needs-action', 'expired']);
    expect(match(inv({ status: InvoiceStatus.Paid, paidAmount: 1_000_000n, payer }))).toEqual(['needs-action', 'paid']);
    expect(match(inv({ status: InvoiceStatus.Paid, paidAmount: 1_500_000n, refundedExcess: 500_000n, claimed: true, payer }))).toEqual(['claimed', 'overpaid']);
    expect(match(inv({ status: InvoiceStatus.Paid, paidAmount: 1_500_000n, payer }))).toEqual(['needs-action', 'paid', 'overpaid']);
    expect(match(inv({ status: InvoiceStatus.Expired }))).toEqual(['expired']);
    expect(match(inv({ status: InvoiceStatus.Closed, claimed: true, paidAmount: 1_000_000n }))).toEqual(['claimed', 'closed']);
  });
  it('counts', () => {
    const rows = [inv({}), inv({ status: InvoiceStatus.Closed })].map((invoice) => ({ pda: Keypair.generate().publicKey, invoice }));
    expect(filterCounts(rows, now)).toMatchObject({ all: 2, open: 1, closed: 1, paid: 0 });
  });
});

describe('mock history (demo build only)', () => {
  it('is flagged demo and newest first', () => {
    const h = mockHistoryFor(inv({ status: InvoiceStatus.Paid, paidAmount: 1_000_000n, claimed: true }));
    expect(h.map((e) => e.action)).toEqual(['merchant_claim', 'pay_invoice', 'create_invoice']);
    expect(h.every((e) => e.demo)).toBe(true);
  });
});
