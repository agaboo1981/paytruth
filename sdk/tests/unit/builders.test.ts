import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  buildCloseInvoiceIx,
  buildCreateInvoiceIx,
  buildExpireInvoiceIx,
  buildInitializeConfigIx,
  buildMerchantClaimIx,
  buildPayInvoiceIx,
  buildRecoverUnattributedIx,
  buildRefundOverpaymentIx,
} from '../../src/instructions';
import { getConfigPda, getEscrowAta, getInvoicePda } from '../../src/pda';
import { InvoiceStatus, type Invoice } from '../../src/types';

// ---------------------------------------------------------------------------
// A minimal in-memory "connection" for instruction building. Builders only call
// Program.methods(...).accountsStrict(...).instruction(), which does not touch
// the network, so we never need a real RPC here.
// ---------------------------------------------------------------------------
const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROG = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const merchant = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;

function disc(name: string): Buffer {
  // global discriminator computed independently (sha256 of "global:<name>").
  // We rely on the builder producing exactly these bytes.
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}

function keyMeta(ix: TransactionInstruction) {
  return ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable }));
}

function baseInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    merchant,
    payer,
    mint,
    invoiceId: 1n,
    amountDue: 5_000_000n,
    paidAmount: 5_000_000n,
    refundedExcess: 0n,
    createdAt: 1_700_000_000n,
    expiresAt: 1_700_100_000n,
    status: InvoiceStatus.Paid,
    claimed: false,
    bump: 255,
    memo: new Uint8Array(64),
    ...overrides,
  };
}

describe('buildInitializeConfigIx', () => {
  it('has correct programId, disc, args and account order', async () => {
    const authority = Keypair.generate().publicKey;
    const [configPda] = getConfigPda(PROGRAM_ID);
    const ix = await buildInitializeConfigIx({ authority, usdcMint: mint }, PROGRAM_ID);
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true);
    expect(ix.data.subarray(0, 8)).toEqual(disc('initialize_config'));
    expect(ix.data.subarray(8)).toEqual(mint.toBuffer());
    expect(keyMeta(ix)).toEqual([
      { pubkey: authority.toBase58(), isSigner: true, isWritable: true },
      { pubkey: configPda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: SYSTEM.toBase58(), isSigner: false, isWritable: false },
    ]);
  });
});

describe('buildCreateInvoiceIx', () => {
  it('encodes id/amount/expires/memo and orders accounts', async () => {
    const memo = new Uint8Array(64);
    memo.set(new TextEncoder().encode('hello'));
    const [configPda] = getConfigPda(PROGRAM_ID);
    const [invoicePda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const ix = await buildCreateInvoiceIx(
      { merchant, invoiceId: 42n, amountDue: 5_000_000n, expiresAt: 1_700_100_000n, mint, memo },
      PROGRAM_ID,
    );
    expect(ix.data.subarray(0, 8)).toEqual(disc('create_invoice'));
    const expected = Buffer.concat([u64le(42n), u64le(5_000_000n), i64le(1_700_100_000n), Buffer.from(memo)]);
    expect(ix.data.subarray(8)).toEqual(expected);
    expect(keyMeta(ix)).toEqual([
      { pubkey: merchant.toBase58(), isSigner: true, isWritable: true },
      { pubkey: configPda.toBase58(), isSigner: false, isWritable: false },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: escrow.toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false },
      { pubkey: ATA_PROG.toBase58(), isSigner: false, isWritable: false },
      { pubkey: SYSTEM.toBase58(), isSigner: false, isWritable: false },
    ]);
  });

  it('rejects a zero amount and an over-long memo (client-side)', async () => {
    const memo = new Uint8Array(64);
    await expect(
      buildCreateInvoiceIx({ merchant, invoiceId: 1n, amountDue: 0n, expiresAt: 1n, mint, memo }, PROGRAM_ID),
    ).rejects.toThrow();
    await expect(
      buildCreateInvoiceIx({ merchant, invoiceId: 1n, amountDue: 1n, expiresAt: 1n, mint, memo: new Uint8Array(65) }, PROGRAM_ID),
    ).rejects.toThrow();
  });
});

describe('buildPayInvoiceIx', () => {
  it('encodes amount plus expected_amount_due and derives payer ATA', async () => {
    const [configPda] = getConfigPda(PROGRAM_ID);
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const payerAta = getAssociatedTokenAddressSync(mint, payer, false, TOKEN);
    const ix = await buildPayInvoiceIx(
      { payer, invoicePda, mint, amount: 5_000_000n, expectedAmountDue: 4_000_000n },
      PROGRAM_ID,
    );
    expect(ix.data.subarray(0, 8)).toEqual(disc('pay_invoice'));
    expect(ix.data.subarray(8)).toEqual(Buffer.concat([u64le(5_000_000n), u64le(4_000_000n)]));
    expect(keyMeta(ix)).toEqual([
      { pubkey: payer.toBase58(), isSigner: true, isWritable: false },
      { pubkey: configPda.toBase58(), isSigner: false, isWritable: false },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: payerAta.toBase58(), isSigner: false, isWritable: true },
      { pubkey: escrow.toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false },
    ]);
  });

  it('rejects a zero amount', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    await expect(
      buildPayInvoiceIx({ payer, invoicePda, mint, amount: 0n, expectedAmountDue: 5_000_000n }, PROGRAM_ID),
    ).rejects.toThrow();
  });
});

describe('buildMerchantClaimIx', () => {
  it('derives merchant ATA and orders accounts', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const merchantAta = getAssociatedTokenAddressSync(mint, merchant, false, TOKEN);
    const ix = await buildMerchantClaimIx({ merchant, invoicePda, mint }, PROGRAM_ID);
    expect(ix.data.subarray(0, 8)).toEqual(disc('merchant_claim'));
    expect(ix.data.length).toBe(8);
    expect(keyMeta(ix)).toEqual([
      { pubkey: merchant.toBase58(), isSigner: true, isWritable: true },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: escrow.toBase58(), isSigner: false, isWritable: true },
      { pubkey: merchantAta.toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false },
      { pubkey: ATA_PROG.toBase58(), isSigner: false, isWritable: false },
      { pubkey: SYSTEM.toBase58(), isSigner: false, isWritable: false },
    ]);
  });
});

describe('buildRefundOverpaymentIx', () => {
  it('uses the ATA of the recorded payer', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const caller = Keypair.generate().publicKey;
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const payerAta = getAssociatedTokenAddressSync(mint, payer, false, TOKEN);
    const ix = await buildRefundOverpaymentIx({ caller, invoicePda, mint, invoice: baseInvoice() }, PROGRAM_ID);
    expect(ix.data.subarray(0, 8)).toEqual(disc('refund_overpayment'));
    expect(keyMeta(ix)).toEqual([
      { pubkey: caller.toBase58(), isSigner: true, isWritable: true },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: escrow.toBase58(), isSigner: false, isWritable: true },
      { pubkey: payer.toBase58(), isSigner: false, isWritable: false },
      { pubkey: payerAta.toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false },
      { pubkey: ATA_PROG.toBase58(), isSigner: false, isWritable: false },
      { pubkey: SYSTEM.toBase58(), isSigner: false, isWritable: false },
    ]);
  });

  it('rejects when invoice.payer is the default pubkey', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    await expect(
      buildRefundOverpaymentIx(
        { caller: Keypair.generate().publicKey, invoicePda, mint, invoice: baseInvoice({ payer: PublicKey.default }) },
        PROGRAM_ID,
      ),
    ).rejects.toThrow();
  });
});

describe('buildExpireInvoiceIx', () => {
  it('has no args and only caller+invoice accounts', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const caller = Keypair.generate().publicKey;
    const ix = await buildExpireInvoiceIx({ caller, invoicePda }, PROGRAM_ID);
    expect(ix.data).toEqual(disc('expire_invoice'));
    expect(keyMeta(ix)).toEqual([
      { pubkey: caller.toBase58(), isSigner: true, isWritable: false },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
    ]);
  });
});

describe('buildRecoverUnattributedIx', () => {
  it('uses destination ATA and orders accounts', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const destinationAta = getEscrowAta(Keypair.generate().publicKey, mint);
    const ix = await buildRecoverUnattributedIx({ merchant, invoicePda, mint, destinationAta }, PROGRAM_ID);
    expect(ix.data).toEqual(disc('recover_unattributed'));
    expect(keyMeta(ix)).toEqual([
      { pubkey: merchant.toBase58(), isSigner: true, isWritable: true },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: escrow.toBase58(), isSigner: false, isWritable: true },
      { pubkey: destinationAta.toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false },
      { pubkey: ATA_PROG.toBase58(), isSigner: false, isWritable: false },
      { pubkey: SYSTEM.toBase58(), isSigner: false, isWritable: false },
    ]);
  });
});

describe('buildCloseInvoiceIx', () => {
  it('orders merchant/invoice/mint/escrow/token', async () => {
    const [invoicePda] = getInvoicePda(merchant, 7n, PROGRAM_ID);
    const escrow = getEscrowAta(invoicePda, mint);
    const ix = await buildCloseInvoiceIx({ merchant, invoicePda, mint }, PROGRAM_ID);
    expect(ix.data).toEqual(disc('close_invoice'));
    expect(keyMeta(ix)).toEqual([
      { pubkey: merchant.toBase58(), isSigner: true, isWritable: true },
      { pubkey: invoicePda.toBase58(), isSigner: false, isWritable: true },
      { pubkey: mint.toBase58(), isSigner: false, isWritable: false },
      { pubkey: escrow.toBase58(), isSigner: false, isWritable: true },
      { pubkey: TOKEN.toBase58(), isSigner: false, isWritable: false },
    ]);
  });
});

describe('buildPayInvoiceIx requires expectedAmountDue', () => {
  it('throws a clear error when a caller (e.g. an older UI type) omits it', async () => {
    const params = {
      payer: Keypair.generate().publicKey,
      invoicePda: Keypair.generate().publicKey,
      mint: Keypair.generate().publicKey,
      amount: 1_000_000n,
    } as unknown as Parameters<typeof buildPayInvoiceIx>[0];
    await expect(buildPayInvoiceIx(params)).rejects.toThrow(/expectedAmountDue/);
  });
});
