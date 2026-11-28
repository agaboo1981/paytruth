import { Keypair, PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder, BN } from '@anchor-lang/core';
import { describe, expect, it } from 'vitest';

import { INVOICE_ACCOUNT_SIZE, PAYTRUTH_IDL } from '../../../lib/paytruth';
import { InvoiceStatus, type Invoice } from '../sdk/types';
import { classifyInvoice, groupInvoices, invoiceFilters, MERCHANT_OFFSET, PAYER_OFFSET } from './query';

const coder = new BorshAccountsCoder(PAYTRUTH_IDL as never);
const merchant = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;

async function encoded(): Promise<Buffer> {
  return coder.encode('Invoice', {
    merchant,
    payer,
    mint: PublicKey.default,
    invoice_id: new BN(7),
    amount_due: new BN(1_000_000),
    paid_amount: new BN(0),
    refunded_excess: new BN(0),
    created_at: new BN(1),
    expires_at: new BN(2),
    status: 0,
    claimed: false,
    bump: 255,
    memo: new Array(64).fill(0),
  });
}

function inv(p: Partial<Invoice>): Invoice {
  return {
    merchant,
    payer: PublicKey.default,
    mint: PublicKey.default,
    invoiceId: 1n,
    amountDue: 1_000_000n,
    paidAmount: 0n,
    refundedExcess: 0n,
    createdAt: 100n,
    expiresAt: 1_000n,
    status: InvoiceStatus.Open,
    claimed: false,
    bump: 255,
    memo: new Uint8Array(64),
    ...p,
  };
}

describe('invoice account layout', () => {
  it('merchant at byte 8 and payer at byte 40 (plain Pubkey, not Option)', async () => {
    const data = await encoded();
    expect(data.length).toBe(INVOICE_ACCOUNT_SIZE);
    expect(new PublicKey(data.subarray(MERCHANT_OFFSET, MERCHANT_OFFSET + 32)).equals(merchant)).toBe(true);
    expect(new PublicKey(data.subarray(PAYER_OFFSET, PAYER_OFFSET + 32)).equals(payer)).toBe(true);
  });

  it('builds dataSize + discriminator + role memcmp filters', () => {
    const f = invoiceFilters('payer', payer);
    expect(f).toHaveLength(3);
    expect(f[2]).toEqual({ memcmp: { offset: 40, bytes: payer.toBase58() } });
    expect(invoiceFilters('merchant', merchant)[2]).toEqual({ memcmp: { offset: 8, bytes: merchant.toBase58() } });
  });
});

describe('classifyInvoice', () => {
  const now = 500n;
  it('paid & unclaimed needs action with Claim', () => {
    const s = classifyInvoice(inv({ status: InvoiceStatus.Paid, paidAmount: 1_000_000n, payer }), now);
    expect(s).toMatchObject({ group: 'needs-action', canClaim: true });
  });
  it('claimed but overpay not refunded needs action', () => {
    const s = classifyInvoice(inv({ status: InvoiceStatus.Paid, paidAmount: 1_500_000n, claimed: true, payer }), now);
    expect(s).toMatchObject({ group: 'needs-action', canClaim: false });
  });
  it('open past expiry needs action', () => {
    expect(classifyInvoice(inv({ expiresAt: 400n }), now).group).toBe('needs-action');
  });
  it('open before expiry is open; claimed/expired/closed are done', () => {
    expect(classifyInvoice(inv({}), now).group).toBe('open');
    expect(classifyInvoice(inv({ status: InvoiceStatus.Paid, paidAmount: 1_000_000n, claimed: true }), now).group).toBe('done');
    expect(classifyInvoice(inv({ status: InvoiceStatus.Expired }), now).group).toBe('done');
    expect(classifyInvoice(inv({ status: InvoiceStatus.Closed }), now).group).toBe('done');
  });
  it('groups newest first', () => {
    const a = { pda: Keypair.generate().publicKey, invoice: inv({ createdAt: 1n }) };
    const b = { pda: Keypair.generate().publicKey, invoice: inv({ createdAt: 2n }) };
    const g = groupInvoices([a, b], now);
    expect(g.open.map((r) => r.invoice.createdAt)).toEqual([2n, 1n]);
  });
});
