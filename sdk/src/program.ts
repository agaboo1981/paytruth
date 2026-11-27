import { AnchorProvider, Program, type Idl } from '@anchor-lang/core';
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import { PAYTRUTH_IDL } from './idl';
import type { Paytruth } from './idl/paytruth';

/** Program id from the real Anchor IDL (local scaffold id). */
export const PLACEHOLDER_PROGRAM_ID = new PublicKey(PAYTRUTH_IDL.address);

/**
 * Resolve the program id: explicit override, then NEXT_PUBLIC_PAYTRUTH_PROGRAM_ID
 * env, then the idl's address.
 */
export function resolveProgramId(override?: PublicKey): PublicKey {
  if (override) return override;
  const env =
    typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_PAYTRUTH_PROGRAM_ID : undefined;
  if (env && env.trim().length > 0) return new PublicKey(env.trim());
  return PLACEHOLDER_PROGRAM_ID;
}

/**
 * A read-only wallet that never signs. Used to build the provider for
 * instruction assembly only; signing goes through the PaytruthWallet path.
 */
function readOnlyWallet(): { publicKey: PublicKey; signTransaction: never; signAllTransactions: never } {
  return {
    publicKey: Keypair.generate().publicKey,
    signTransaction: undefined as never,
    signAllTransactions: undefined as never,
  };
}

/**
 * Construct a read-only Anchor Program with the idl address swapped for the
 * resolved program id. Instruction builders only call `.methods`, never send.
 */
export type PaytruthProgram = Program<Paytruth>;

export function getProgram(connection: Connection, programId: PublicKey = resolveProgramId()): PaytruthProgram {
  const idl = { ...PAYTRUTH_IDL, address: programId.toBase58() } as unknown as Idl;
  const provider = new AnchorProvider(connection, readOnlyWallet() as never, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  return new Program<Paytruth>(idl as unknown as Paytruth, provider);
}

interface MethodsBuilder {
  accountsStrict(accounts: Record<string, unknown>): {
    instruction(): Promise<import('@solana/web3.js').TransactionInstruction>;
  };
}

export type PaytruthMethods = {
  initializeConfig(usdcMint: unknown): MethodsBuilder;
  createInvoice(invoiceId: unknown, amountDue: unknown, expiresAt: unknown, memo: unknown): MethodsBuilder;
  payInvoice(amount: unknown, expectedAmountDue: unknown): MethodsBuilder;
  merchantClaim(): MethodsBuilder;
  refundOverpayment(): MethodsBuilder;
  expireInvoice(): MethodsBuilder;
  recoverUnattributed(): MethodsBuilder;
  closeInvoice(): MethodsBuilder;
};

/**
 * Typed accessor for the program's instruction builders. The IDL is dynamic,
 * so the raw `methods` namespace is indexed loosely; this narrows it to the
 * `.(...args).accountsStrict({...}).instruction()` shape the builders use.
 */
export function getMethods(program: PaytruthProgram): PaytruthMethods {
  return program.methods as unknown as PaytruthMethods;
}
