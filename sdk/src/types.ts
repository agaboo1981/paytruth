import type { PublicKey } from '@solana/web3.js';

export type Commitment = 'processed' | 'confirmed' | 'finalized';

export enum InvoiceStatus {
  Open = 0,
  Paid = 1,
  Expired = 2,
  Closed = 3,
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

/**
 * Structural mirror of the UI-owned `PaytruthSdk` interface in
 * app/components/ui/sdk/types.ts (canonical: docs/INTERFACES.md).
 */
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
  createInvoice(args: {
    invoiceId: bigint;
    amountDue: bigint;
    expiresAt: bigint;
    memo: string | Uint8Array;
  }): Promise<{ signature: string; invoicePda: PublicKey }>;
  payInvoice(args: { invoicePda: PublicKey; amount: bigint; expectedAmountDue: bigint }): Promise<{ signature: string }>;
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
