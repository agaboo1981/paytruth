/**
 * UI-owned mirror of the Paytruth SDK surface, copied verbatim from
 * paytruth/docs/INTERFACES.md (signatures only). Full-Stack owns the real
 * implementation (sdk/** or app/lib/paytruth/**). Do not add logic here.
 */
import type { PublicKey } from '@solana/web3.js';

export type Commitment = 'processed' | 'confirmed' | 'finalized';

export enum InvoiceStatus {
  Open = 0,
  Paid = 1,
  Expired = 2,
}

export interface Config {
  authority: PublicKey;
  usdcMint: PublicKey;
  bump: number;
}

export interface Invoice {
  merchant: PublicKey;
  payer: PublicKey; // PublicKey.default until paid
  mint: PublicKey;
  invoiceId: bigint;
  amountDue: bigint;
  paidAmount: bigint;
  refundedExcess: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  status: InvoiceStatus;
  claimed: boolean;
  bump: number;
  memo: Uint8Array; // 64 bytes, zero-padded
}

export interface PaytruthSdk {
  // PDA derivation
  getInvoicePda(merchant: PublicKey, invoiceId: bigint): [PublicKey, number];
  getConfigPda(): [PublicKey, number];
  getEscrowAta(invoicePda: PublicKey, mint: PublicKey): PublicKey;

  // Reads
  fetchConfig(commitment?: Commitment): Promise<Config>;
  fetchInvoice(invoicePda: PublicKey, commitment?: Commitment): Promise<Invoice>;
  fetchInvoiceByMerchantAndId(merchant: PublicKey, invoiceId: bigint, commitment?: Commitment): Promise<Invoice>;
  fetchEscrowBalance(invoicePda: PublicKey, mint: PublicKey): Promise<bigint>;

  // Writes (return confirmed signature; caller polls state)
  initializeConfig(args: { usdcMint: PublicKey }): Promise<{ signature: string; configPda: PublicKey }>;
  createInvoice(args: { invoiceId: bigint; amountDue: bigint; expiresAt: bigint; memo: string | Uint8Array }): Promise<{ signature: string; invoicePda: PublicKey }>;
  payInvoice(args: { invoicePda: PublicKey; amount: bigint }): Promise<{ signature: string }>;
  merchantClaim(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;
  refundOverpayment(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;
  expireInvoice(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;
  recoverUnattributed(args: { invoicePda: PublicKey; destinationAta: PublicKey }): Promise<{ signature: string }>;
  closeInvoice(args: { invoicePda: PublicKey }): Promise<{ signature: string }>;

  // State helpers
  waitForInvoiceState(
    invoicePda: PublicKey,
    predicate: (inv: Invoice) => boolean,
    opts?: { commitment?: Commitment; timeoutMs?: number },
  ): Promise<Invoice>;
  subscribeInvoice(invoicePda: PublicKey, cb: (inv: Invoice | null) => void): () => void;
}
