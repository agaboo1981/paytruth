// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import { BorshAccountsCoder, BN } from '@anchor-lang/core';
import { PublicKey, type AccountInfo, type Commitment, type Connection } from '@solana/web3.js';
import type { Config, Invoice } from './types';
import { InvoiceStatus } from './types';
import { PAYTRUTH_IDL } from './idl';
import { InvoiceAccountMismatchError, InvoiceNotFoundError } from './errors';
import { getConfigPda, getEscrowAta, getInvoicePda } from './pda';
import { resolveProgramId } from './program';

const coder = new BorshAccountsCoder(PAYTRUTH_IDL as never);

export const CONFIG_ACCOUNT_SIZE = 73;
// Invoice data = 211 bytes (3 pubkeys + 6 x u64/i64 + 3 flags + 64 memo);
// full account = 8-byte discriminator + 211 = 219. See README "Spec discrepancy".
export const INVOICE_ACCOUNT_SIZE = 219;

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (BN.isBN(value)) return (value as BN).toString() === '' ? 0n : BigInt((value as BN).toString());
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  if (value && typeof value === 'object' && 'toString' in value) {
    const s = (value as { toString(): string }).toString();
    if (/^-?\d+$/.test(s)) return BigInt(s);
  }
  throw new TypeError(`cannot convert to bigint: ${String(value)}`);
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  if (value && typeof value === 'object' && 'length' in value) {
    return Uint8Array.from(value as ArrayLike<number>);
  }
  throw new TypeError('memo is not byte-like');
}

/** Decode raw Config account data (8-byte disc + fields) via the Anchor coder. */
export function decodeConfig(data: Uint8Array | Buffer): Config {
  const raw = coder.decode('Config', data as Buffer) as Record<string, unknown>;
  return {
    authority: raw.authority as PublicKey,
    usdcMint: raw.usdc_mint as PublicKey,
    bump: Number(raw.bump),
  };
}

/** Decode raw Invoice account data via the Anchor coder, BN -> bigint. */
export function decodeInvoice(data: Uint8Array | Buffer): Invoice {
  const raw = coder.decode('Invoice', data as Buffer) as Record<string, unknown>;
  const statusNum = Number(raw.status);
  if (
    statusNum !== InvoiceStatus.Open &&
    statusNum !== InvoiceStatus.Paid &&
    statusNum !== InvoiceStatus.Expired &&
    statusNum !== InvoiceStatus.Closed
  ) {
    throw new Error(`unknown invoice status: ${statusNum}`);
  }
  return {
    merchant: raw.merchant as PublicKey,
    payer: raw.payer as PublicKey,
    mint: raw.mint as PublicKey,
    invoiceId: toBigInt(raw.invoice_id),
    amountDue: toBigInt(raw.amount_due),
    paidAmount: toBigInt(raw.paid_amount),
    refundedExcess: toBigInt(raw.refunded_excess),
    createdAt: toBigInt(raw.created_at),
    expiresAt: toBigInt(raw.expires_at),
    status: statusNum,
    claimed: Boolean(raw.claimed),
    bump: Number(raw.bump),
    memo: toBytes(raw.memo),
  };
}

function accountData(info: AccountInfo<Buffer>): Buffer {
  return Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data);
}

// ---------------------------------------------------------------------------
// Standalone fetchers (explicit connection + programId)
// ---------------------------------------------------------------------------

export async function fetchConfig(
  connection: Connection,
  commitment: Commitment = 'confirmed',
  programId: PublicKey = resolveProgramId(),
): Promise<Config> {
  const [pda] = getConfigPda(programId);
  const info = await connection.getAccountInfo(pda, commitment);
  if (!info) throw new InvoiceNotFoundError(pda.toBase58());
  if (!info.owner.equals(programId)) throw new Error(`config account owner mismatch: ${info.owner.toBase58()}`);
  const data = accountData(info);
  if (data.length !== CONFIG_ACCOUNT_SIZE) throw new Error(`config account size ${data.length} != 73`);
  return decodeConfig(data);
}

interface FetchOptions {
  commitment?: Commitment;
  programId?: PublicKey;
}

async function loadInvoiceAccount(
  connection: Connection,
  invoicePda: PublicKey,
  programId: PublicKey,
  commitment: Commitment,
): Promise<Invoice | null> {
  const info = await connection.getAccountInfo(invoicePda, commitment);
  if (!info) return null;
  if (!info.owner.equals(programId)) {
    throw new Error(`invoice account owner mismatch: ${info.owner.toBase58()} != ${programId.toBase58()}`);
  }
  if (info.data.length < 8) throw new Error('invoice account data too short');
  const expectedDisc = Buffer.from(
    PAYTRUTH_IDL.accounts.find((a) => a.name === 'Invoice')!.discriminator,
  );
  const data = accountData(info);
  if (!data.subarray(0, 8).equals(expectedDisc)) {
    throw new Error('invoice account discriminator mismatch');
  }
  if (data.length !== INVOICE_ACCOUNT_SIZE) throw new Error(`invoice account size ${data.length} != ${INVOICE_ACCOUNT_SIZE}`);
  return decodeInvoice(data);
}

/**
 * Fetch and verify an Invoice. Throws InvoiceNotFoundError if the account does
 * not exist. Verifies owner, discriminator, length, and that the stored
 * (merchant, invoice_id) derive back to the queried PDA.
 */
export async function fetchInvoice(
  connection: Connection,
  invoicePda: PublicKey,
  commitment: Commitment = 'confirmed',
  programId: PublicKey = resolveProgramId(),
): Promise<Invoice> {
  const invoice = await loadInvoiceAccount(connection, invoicePda, programId, commitment);
  if (!invoice) throw new InvoiceNotFoundError(invoicePda.toBase58());
  const [expectedPda] = getInvoicePda(invoice.merchant, invoice.invoiceId, programId);
  if (!expectedPda.equals(invoicePda)) {
    throw new InvoiceAccountMismatchError(
      `Invoice account at ${invoicePda.toBase58()} does not match its recorded seeds (${expectedPda.toBase58()}).`,
    );
  }
  return invoice;
}

/** Fetch an Invoice, returning null when the account does not exist (never created or fully removed). */
export async function fetchInvoiceOrNull(
  connection: Connection,
  invoicePda: PublicKey,
  commitment: Commitment = 'confirmed',
  programId: PublicKey = resolveProgramId(),
): Promise<Invoice | null> {
  const invoice = await loadInvoiceAccount(connection, invoicePda, programId, commitment);
  if (!invoice) return null;
  const [expectedPda] = getInvoicePda(invoice.merchant, invoice.invoiceId, programId);
  if (!expectedPda.equals(invoicePda)) {
    throw new InvoiceAccountMismatchError(
      `Invoice account at ${invoicePda.toBase58()} does not match its recorded seeds (${expectedPda.toBase58()}).`,
    );
  }
  return invoice;
}

export async function fetchInvoiceByMerchantAndId(
  connection: Connection,
  merchant: PublicKey,
  invoiceId: bigint,
  commitment: Commitment = 'confirmed',
  programId: PublicKey = resolveProgramId(),
): Promise<Invoice> {
  const [pda] = getInvoicePda(merchant, invoiceId, programId);
  return fetchInvoice(connection, pda, commitment, programId);
}

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/**
 * Read the escrow ATA balance. Returns 0n if the ATA does not exist. Verifies
 * the token account owner field == invoicePda and mint matches.
 */
export async function fetchEscrowBalance(
  connection: Connection,
  invoicePda: PublicKey,
  mint: PublicKey,
  commitment: Commitment = 'confirmed',
  _programId: PublicKey = resolveProgramId(),
): Promise<bigint> {
  const escrow = getEscrowAta(invoicePda, mint);
  const info = await connection.getAccountInfo(escrow, commitment);
  if (!info) return 0n;
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error(`escrow account is not owned by the SPL Token program: ${info.owner.toBase58()}`);
  }
  const data = accountData(info);
  if (data.length !== 165) throw new Error(`escrow token account size ${data.length} != 165`);
  const accountMint = new PublicKey(data.subarray(0, 32));
  const authority = new PublicKey(data.subarray(32, 64));
  if (!accountMint.equals(mint)) {
    throw new Error(`escrow token account mint ${accountMint.toBase58()} != ${mint.toBase58()}`);
  }
  if (!authority.equals(invoicePda)) {
    throw new Error(`escrow token account authority ${authority.toBase58()} != invoice ${invoicePda.toBase58()}`);
  }
  return data.readBigUInt64LE(64);
}

export type { FetchOptions };
