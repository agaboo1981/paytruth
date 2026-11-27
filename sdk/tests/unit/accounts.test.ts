import { BorshAccountsCoder, BN } from '@anchor-lang/core';
import { PublicKey, type AccountInfo, type Connection } from '@solana/web3.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_ACCOUNT_SIZE,
  INVOICE_ACCOUNT_SIZE,
  decodeConfig,
  decodeInvoice,
  fetchEscrowBalance,
  fetchInvoice,
  fetchInvoiceOrNull,
} from '../../src/accounts';
import { PAYTRUTH_IDL } from '../../src/idl';
import { getEscrowAta, getInvoicePda } from '../../src/pda';
import { InvoiceStatus } from '../../src/types';
import { InvoiceAccountMismatchError, InvoiceNotFoundError } from '../../src/errors';
import { Keypair } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const coder = new BorshAccountsCoder(PAYTRUTH_IDL as never);

function encodeConfig(authority: PublicKey, usdcMint: PublicKey, bump: number): Promise<Buffer> {
  return coder.encode('Config', { authority, usdc_mint: usdcMint, bump }) as unknown as Promise<Buffer>;
}

function encodeInvoice(o: {
  merchant: PublicKey;
  payer: PublicKey;
  mint: PublicKey;
  invoiceId: bigint;
  amountDue: bigint;
  paidAmount?: bigint;
  refundedExcess?: bigint;
  createdAt?: bigint;
  expiresAt?: bigint;
  status?: number;
  claimed?: boolean;
  bump?: number;
  memo?: Uint8Array;
}): Promise<Buffer> {
  const memo = new Uint8Array(64);
  if (o.memo) memo.set(o.memo.slice(0, 64));
  return coder.encode('Invoice', {
    merchant: o.merchant,
    payer: o.payer,
    mint: o.mint,
    invoice_id: new BN(o.invoiceId.toString()),
    amount_due: new BN(o.amountDue.toString()),
    paid_amount: new BN((o.paidAmount ?? 0n).toString()),
    refunded_excess: new BN((o.refundedExcess ?? 0n).toString()),
    created_at: new BN((o.createdAt ?? 1_700_000_000n).toString()),
    expires_at: new BN((o.expiresAt ?? 1_700_100_000n).toString()),
    status: o.status ?? 0,
    claimed: o.claimed ?? false,
    bump: o.bump ?? 255,
    memo,
  }) as unknown as Promise<Buffer>;
}

function accountInfo(data: Buffer, owner: PublicKey): AccountInfo<Buffer> {
  return { data, executable: false, lamports: 1_000_000, owner, rentEpoch: 0 };
}

let cfg73: Buffer;
let inv211: Buffer;
const merchantA = Keypair.generate().publicKey;
const payerA = Keypair.generate().publicKey;

beforeAll(async () => {
  cfg73 = await encodeConfig(Keypair.generate().publicKey, mint, 254);
  inv211 = await encodeInvoice({ merchant: merchantA, payer: payerA, mint, invoiceId: 9n, amountDue: 5_000_000n });
});

describe('account encoding sizes', () => {
  it('Config account is 73 bytes (8 disc + 65 data)', () => {
    expect(CONFIG_ACCOUNT_SIZE).toBe(73);
    expect(cfg73.length).toBe(73);
  });
  it('Invoice data is 211 bytes and account is 219 (8 disc + 211 data)', () => {
    expect(INVOICE_ACCOUNT_SIZE).toBe(219);
    expect(inv211.length).toBe(219);
    expect(inv211.length - 8).toBe(211);
  });
});

describe('decodeConfig', () => {
  it('decodes pubkeys and bump', async () => {
    const authority = Keypair.generate().publicKey;
    const decoded = decodeConfig(await encodeConfig(authority, mint, 254));
    expect(decoded.authority.equals(authority)).toBe(true);
    expect(decoded.usdcMint.equals(mint)).toBe(true);
    expect(decoded.bump).toBe(254);
  });
});

describe('decodeInvoice', () => {
  it('converts BN fields to bigint and status to the enum', async () => {
    const memo = new TextEncoder().encode('order #9');
    const data = await encodeInvoice({
      merchant: merchantA,
      payer: payerA,
      mint,
      invoiceId: 9n,
      amountDue: 5_000_000n,
      paidAmount: 6_000_000n,
      refundedExcess: 0n,
      createdAt: 1_700_000_000n,
      expiresAt: 1_700_100_000n,
      status: 1,
      claimed: true,
      bump: 253,
      memo,
    });
    const inv = decodeInvoice(data);
    expect(inv.invoiceId).toBe(9n);
    expect(inv.amountDue).toBe(5_000_000n);
    expect(inv.paidAmount).toBe(6_000_000n);
    expect(inv.createdAt).toBe(1_700_000_000n);
    expect(inv.expiresAt).toBe(1_700_100_000n);
    expect(inv.status).toBe(InvoiceStatus.Paid);
    expect(inv.claimed).toBe(true);
    expect(inv.bump).toBe(253);
    expect(inv.merchant.equals(merchantA)).toBe(true);
    expect(inv.payer.equals(payerA)).toBe(true);
    expect(inv.mint.equals(mint)).toBe(true);
    expect(inv.memo).toBeInstanceOf(Uint8Array);
    expect(inv.memo.length).toBe(64);
    expect(inv.memo.slice(0, 8)).toEqual(memo);
  });

  it('decodes status 3 as the Closed tombstone', async () => {
    const data = await encodeInvoice({
      merchant: merchantA,
      payer: payerA,
      mint,
      invoiceId: 9n,
      amountDue: 5_000_000n,
      status: 3,
    });
    expect(decodeInvoice(data).status).toBe(InvoiceStatus.Closed);
  });

  it('throws on an unknown status byte', async () => {
    const data = await encodeInvoice({
      merchant: merchantA,
      payer: PublicKey.default,
      mint,
      invoiceId: 1n,
      amountDue: 1n,
      status: 7,
    });
    expect(() => decodeInvoice(data)).toThrow();
  });
});

describe('fetchInvoice security checks', () => {
  function mockConnection(info: AccountInfo<Buffer> | null): Connection {
    return { getAccountInfo: vi.fn().mockResolvedValue(info) } as unknown as Connection;
  }

  it('fetches a valid invoice', async () => {
    const merchant = Keypair.generate().publicKey;
    const [pda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    const data = await encodeInvoice({ merchant, payer: PublicKey.default, mint, invoiceId: 42n, amountDue: 100n });
    const inv = await fetchInvoice(mockConnection(accountInfo(data, PROGRAM_ID)), pda, 'confirmed', PROGRAM_ID);
    expect(inv.invoiceId).toBe(42n);
  });

  it('throws InvoiceNotFoundError when account is missing', async () => {
    const merchant = Keypair.generate().publicKey;
    const [pda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    await expect(fetchInvoice(mockConnection(null), pda, 'confirmed', PROGRAM_ID)).rejects.toBeInstanceOf(
      InvoiceNotFoundError,
    );
  });

  it('rejects wrong owner', async () => {
    const merchant = Keypair.generate().publicKey;
    const [pda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    const data = await encodeInvoice({ merchant, payer: PublicKey.default, mint, invoiceId: 42n, amountDue: 100n });
    const wrongOwner = Keypair.generate().publicKey;
    await expect(
      fetchInvoice(mockConnection(accountInfo(data, wrongOwner)), pda, 'confirmed', PROGRAM_ID),
    ).rejects.toThrow(/owner/i);
  });

  it('rejects a PDA/address mismatch', async () => {
    const merchant = Keypair.generate().publicKey;
    const [actualPda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    const [wrongPda] = getInvoicePda(merchant, 43n, PROGRAM_ID);
    const data = await encodeInvoice({ merchant, payer: PublicKey.default, mint, invoiceId: 42n, amountDue: 100n });
    await expect(
      fetchInvoice(mockConnection(accountInfo(data, PROGRAM_ID)), wrongPda, 'confirmed', PROGRAM_ID),
    ).rejects.toBeInstanceOf(InvoiceAccountMismatchError);
    const ok = await fetchInvoice(mockConnection(accountInfo(data, PROGRAM_ID)), actualPda, 'confirmed', PROGRAM_ID);
    expect(ok.invoiceId).toBe(42n);
  });

  it('rejects wrong data length', async () => {
    const merchant = Keypair.generate().publicKey;
    const [pda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    const full = await encodeInvoice({ merchant, payer: PublicKey.default, mint, invoiceId: 42n, amountDue: 100n });
    const short = full.subarray(0, 100);
    await expect(
      fetchInvoice(mockConnection(accountInfo(short, PROGRAM_ID)), pda, 'confirmed', PROGRAM_ID),
    ).rejects.toThrow();
  });

  it('fetchInvoiceOrNull returns null when closed/never created', async () => {
    const merchant = Keypair.generate().publicKey;
    const [pda] = getInvoicePda(merchant, 42n, PROGRAM_ID);
    const inv = await fetchInvoiceOrNull(mockConnection(null), pda, 'confirmed', PROGRAM_ID);
    expect(inv).toBeNull();
  });
});

describe('fetchEscrowBalance', () => {
  const invoicePda = getInvoicePda(Keypair.generate().publicKey, 1n, PROGRAM_ID)[0];
  const escrow = getEscrowAta(invoicePda, mint);

  it('returns 0n when the escrow ATA does not exist', async () => {
    const conn = { getAccountInfo: vi.fn().mockResolvedValue(null) } as unknown as Connection;
    expect(await fetchEscrowBalance(conn, invoicePda, mint, 'confirmed', PROGRAM_ID)).toBe(0n);
  });

  it('reads the balance when owner and mint match', async () => {
    const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0);
    invoicePda.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(1_234_567n, 64);
    const conn = {
      getAccountInfo: vi.fn().mockResolvedValue({ data, executable: false, lamports: 2_039_280, owner: TOKEN, rentEpoch: 0 }),
    } as unknown as Connection;
    expect(await fetchEscrowBalance(conn, invoicePda, mint, 'confirmed', PROGRAM_ID)).toBe(1_234_567n);
    expect((conn.getAccountInfo as ReturnType<typeof vi.fn>).mock.calls[0]![0].equals(escrow)).toBe(true);
  });

  it('rejects when the token account authority is not the invoice PDA', async () => {
    const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0);
    Keypair.generate().publicKey.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(5n, 64);
    const conn = {
      getAccountInfo: vi.fn().mockResolvedValue({ data, executable: false, lamports: 2_039_280, owner: TOKEN, rentEpoch: 0 }),
    } as unknown as Connection;
    await expect(fetchEscrowBalance(conn, invoicePda, mint, 'confirmed', PROGRAM_ID)).rejects.toThrow();
  });
});
