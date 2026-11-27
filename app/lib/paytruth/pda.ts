// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { CONFIG_SEED, INVOICE_SEED, TOKEN_PROGRAM_ID } from './constants';
import { resolveProgramId } from './program';

const U64_MAX = (1n << 64n) - 1n;

/** Derive the Config PDA (`["config"]`). */
export function getConfigPda(programId: PublicKey = resolveProgramId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(CONFIG_SEED)], programId);
}

/**
 * Derive the Invoice PDA (`["invoice", merchant, invoiceId_le_u64]`).
 * Throws if invoiceId is outside [0, 2^64).
 */
export function getInvoicePda(
  merchant: PublicKey,
  invoiceId: bigint,
  programId: PublicKey = resolveProgramId(),
): [PublicKey, number] {
  if (invoiceId < 0n || invoiceId > U64_MAX) {
    throw new RangeError(`invoiceId must be a u64 (0 .. 2^64-1), got ${invoiceId.toString()}`);
  }
  const seed = Buffer.alloc(8);
  seed.writeBigUInt64LE(invoiceId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(INVOICE_SEED), merchant.toBuffer(), seed],
    programId,
  );
}

/** The escrow ATA for an invoice: ATA(mint, invoicePda, allowOwnerOffCurve = true). */
export function getEscrowAta(invoicePda: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, invoicePda, true, TOKEN_PROGRAM_ID);
}
