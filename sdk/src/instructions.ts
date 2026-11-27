import { BN } from '@anchor-lang/core';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, type Connection, type TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from './constants';
import { getConfigPda, getEscrowAta, getInvoicePda } from './pda';
import { getMethods, getProgram, resolveProgramId } from './program';
import type { Invoice } from './types';

const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/**
 * A connection placeholder used only for instruction assembly. Anchor's
 * `.methods(...).accountsStrict(...).instruction()` never performs RPC calls,
 * so builders work offline.
 */
class OfflineConnection {
  readonly rpcEndpoint = 'offline://builder';
}

const OFFLINE_CONNECTION = new OfflineConnection() as unknown as Connection;

function resolveConnection(connection?: Connection): Connection {
  return connection ?? OFFLINE_CONNECTION;
}

function toBn(value: bigint): BN {
  return new BN(value.toString());
}

function payerAta(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);
}

export interface InitializeConfigParams {
  authority: PublicKey;
  usdcMint: PublicKey;
}

export async function buildInitializeConfigIx(
  params: InitializeConfigParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  const program = getProgram(resolveConnection(connection), programId);
  const [configPda] = getConfigPda(programId);
  return getMethods(program)
    .initializeConfig(params.usdcMint)
    .accountsStrict({
      authority: params.authority,
      config: configPda,
      usdcMint: params.usdcMint,
      systemProgram: SYSTEM_PROGRAM_ID,
    })
    .instruction();
}

export interface CreateInvoiceParams {
  merchant: PublicKey;
  invoiceId: bigint;
  amountDue: bigint;
  expiresAt: bigint;
  mint: PublicKey;
  memo: Uint8Array;
}

export async function buildCreateInvoiceIx(
  params: CreateInvoiceParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  if (params.amountDue <= 0n) throw new Error('amountDue must be greater than zero');
  if (params.memo.length > 64) throw new Error('memo must be at most 64 bytes');
  const program = getProgram(resolveConnection(connection), programId);
  const [configPda] = getConfigPda(programId);
  const [invoicePda] = getInvoicePda(params.merchant, params.invoiceId, programId);
  const escrow = getEscrowAta(invoicePda, params.mint);
  return getMethods(program)
    .createInvoice(
      toBn(params.invoiceId),
      toBn(params.amountDue),
      toBn(params.expiresAt),
      Array.from(params.memo),
    )
    .accountsStrict({
      merchant: params.merchant,
      config: configPda,
      invoice: invoicePda,
      mint: params.mint,
      escrow,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
    })
    .instruction();
}

export interface PayInvoiceParams {
  payer: PublicKey;
  invoicePda: PublicKey;
  mint: PublicKey;
  amount: bigint;
  expectedAmountDue: bigint;
}

export async function buildPayInvoiceIx(
  params: PayInvoiceParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  if (typeof params.expectedAmountDue !== 'bigint') {
    // Required by the program (InvoiceMismatch 6022): it must be the amount_due the payer was shown.
    throw new Error('expectedAmountDue (the amount_due shown to the payer) is required to pay an invoice');
  }
  if (params.amount <= 0n) throw new Error('amount must be greater than zero');
  const program = getProgram(resolveConnection(connection), programId);
  const [configPda] = getConfigPda(programId);
  const escrow = getEscrowAta(params.invoicePda, params.mint);
  return getMethods(program)
    .payInvoice(toBn(params.amount), toBn(params.expectedAmountDue))
    .accountsStrict({
      payer: params.payer,
      config: configPda,
      invoice: params.invoicePda,
      mint: params.mint,
      payerAta: payerAta(params.payer, params.mint),
      escrow,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export interface MerchantClaimParams {
  merchant: PublicKey;
  invoicePda: PublicKey;
  mint: PublicKey;
}

export async function buildMerchantClaimIx(
  params: MerchantClaimParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  const program = getProgram(resolveConnection(connection), programId);
  const escrow = getEscrowAta(params.invoicePda, params.mint);
  return getMethods(program)
    .merchantClaim()
    .accountsStrict({
      merchant: params.merchant,
      invoice: params.invoicePda,
      mint: params.mint,
      escrow,
      merchantAta: payerAta(params.merchant, params.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
    })
    .instruction();
}

export interface RefundOverpaymentParams {
  caller: PublicKey;
  invoicePda: PublicKey;
  mint: PublicKey;
  invoice: Invoice;
}

export async function buildRefundOverpaymentIx(
  params: RefundOverpaymentParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  if (params.invoice.payer.equals(PublicKey.default)) {
    throw new Error('invoice has no recorded payer to refund');
  }
  const program = getProgram(resolveConnection(connection), programId);
  const escrow = getEscrowAta(params.invoicePda, params.mint);
  return getMethods(program)
    .refundOverpayment()
    .accountsStrict({
      caller: params.caller,
      invoice: params.invoicePda,
      mint: params.mint,
      escrow,
      payer: params.invoice.payer,
      payerAta: payerAta(params.invoice.payer, params.mint),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
    })
    .instruction();
}

export interface ExpireInvoiceParams {
  caller: PublicKey;
  invoicePda: PublicKey;
}

export async function buildExpireInvoiceIx(
  params: ExpireInvoiceParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  const program = getProgram(resolveConnection(connection), programId);
  return getMethods(program)
    .expireInvoice()
    .accountsStrict({ caller: params.caller, invoice: params.invoicePda })
    .instruction();
}

export interface RecoverUnattributedParams {
  merchant: PublicKey;
  invoicePda: PublicKey;
  mint: PublicKey;
  destinationAta: PublicKey;
}

export async function buildRecoverUnattributedIx(
  params: RecoverUnattributedParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  const program = getProgram(resolveConnection(connection), programId);
  const escrow = getEscrowAta(params.invoicePda, params.mint);
  return getMethods(program)
    .recoverUnattributed()
    .accountsStrict({
      merchant: params.merchant,
      invoice: params.invoicePda,
      mint: params.mint,
      escrow,
      destinationAta: params.destinationAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
    })
    .instruction();
}

export interface CloseInvoiceParams {
  merchant: PublicKey;
  invoicePda: PublicKey;
  mint: PublicKey;
}

export async function buildCloseInvoiceIx(
  params: CloseInvoiceParams,
  programId: PublicKey = resolveProgramId(),
  connection?: Connection,
): Promise<TransactionInstruction> {
  const program = getProgram(resolveConnection(connection), programId);
  const escrow = getEscrowAta(params.invoicePda, params.mint);
  return getMethods(program)
    .closeInvoice()
    .accountsStrict({
      merchant: params.merchant,
      invoice: params.invoicePda,
      mint: params.mint,
      escrow,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

