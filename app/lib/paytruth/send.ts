// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Connection,
  type VersionedTransaction,
} from '@solana/web3.js';
import { mapError, WalletModifiedTransactionError } from './errors';
import type { Commitment } from './types';

/** A wallet that can sign transactions (compatible with wallet-adapter useWallet / useAnchorWallet). */
export interface PaytruthWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

export interface SignAndSendOptions {
  commitment?: Commitment;
  /** Optional write-stage callback hooks. Exceptions thrown here are ignored. */
  write?: WriteOptions;
}

/** A coarse lifecycle stage during a write. */
export type WriteStage = 'awaiting-signature' | 'signed' | 'sent' | 'confirmed';

export interface WriteStageInfo {
  signature?: string;
}

/**
 * Optional callbacks threaded through the write path. Any exception thrown by a
 * callback is caught and ignored so it can never break the send.
 */
export interface WriteOptions {
  onStage?: (stage: WriteStage, info?: WriteStageInfo) => void;
  onSigned?: (signature: string) => void;
}

/** Fire a stage callback, swallowing any thrown exception. */
export function fireStage(
  opts: WriteOptions | undefined,
  stage: WriteStage,
  info?: WriteStageInfo,
): void {
  try {
    opts?.onStage?.(stage, info);
  } catch {
    // ignore callback errors
  }
}

/** Fire the onSigned callback, swallowing any thrown exception. */
export function fireSigned(opts: WriteOptions | undefined, signature: string): void {
  try {
    opts?.onSigned?.(signature);
  } catch {
    // ignore callback errors
  }
}

interface InstructionLike {
  programId: PublicKey;
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  data: Buffer | Uint8Array;
}

function isAllowedExtra(ix: InstructionLike): boolean {
  return ix.programId.equals(ComputeBudgetProgram.programId);
}

function sameInstruction(a: InstructionLike, b: InstructionLike): boolean {
  if (!a.programId.equals(b.programId)) return false;
  if (a.keys.length !== b.keys.length) return false;
  for (let i = 0; i < a.keys.length; i++) {
    const ka = a.keys[i]!;
    const kb = b.keys[i]!;
    if (!ka.pubkey.equals(kb.pubkey)) return false;
    if (ka.isSigner !== kb.isSigner) return false;
    if (ka.isWritable !== kb.isWritable) return false;
  }
  return Buffer.from(a.data).equals(Buffer.from(b.data));
}

/**
 * Verify the wallet returned a transaction we still trust: same fee payer,
 * every expected instruction present in the same relative order with identical
 * program id, keys and data, extra instructions allowed only from the
 * ComputeBudget program, and signatures present and valid.
 */
export function verifySignedTransaction(expected: Transaction, signed: Transaction): void {
  if (!signed.feePayer || !expected.feePayer || !signed.feePayer.equals(expected.feePayer)) {
    throw new WalletModifiedTransactionError('The wallet changed the fee payer.');
  }

  if (signed.recentBlockhash !== expected.recentBlockhash) {
    throw new WalletModifiedTransactionError(
      'The wallet changed the recent blockhash; confirmation uses our lastValidBlockHeight.',
    );
  }

  const signedIxs = signed.instructions;
  const expectedIxs = expected.instructions;

  let cursor = 0;
  for (const exp of expectedIxs) {
    let found = false;
    while (cursor < signedIxs.length) {
      const cand = signedIxs[cursor]!;
      cursor++;
      if (sameInstruction(exp, cand)) {
        found = true;
        break;
      }
      if (!isAllowedExtra(cand)) {
        throw new WalletModifiedTransactionError('The wallet modified the transaction instructions.');
      }
    }
    if (!found) {
      throw new WalletModifiedTransactionError('The wallet removed or reordered an instruction.');
    }
  }

  // Any remaining signed instructions must be allowed extras.
  for (let i = cursor; i < signedIxs.length; i++) {
    if (!isAllowedExtra(signedIxs[i]!)) {
      throw new WalletModifiedTransactionError('The wallet added an unexpected instruction.');
    }
  }

  try {
    const valid = signed.verifySignatures();
    if (!valid) throw new Error('invalid signatures');
  } catch {
    throw new WalletModifiedTransactionError('The signed transaction is missing valid signatures.');
  }

  // Ensure the signers we require actually produced (non-empty) signatures.
  const requiredSigners = requiredSignerKeys(signedIxs);
  const present = new Set<string>();
  for (const sig of signed.signatures) {
    if (sig.publicKey && sig.signature && sig.signature.length > 0) present.add(sig.publicKey.toBase58());
  }
  for (const pk of requiredSigners) {
    if (!present.has(pk)) {
      throw new WalletModifiedTransactionError(`Missing signature for ${pk}.`);
    }
  }
}

function requiredSignerKeys(ixs: { keys: { pubkey: PublicKey; isSigner: boolean }[] }[]): string[] {
  const out: PublicKey[] = [];
  for (const ix of ixs) {
    for (const k of ix.keys) {
      if (k.isSigner) out.push(k.pubkey);
    }
  }
  // Fee payer isn't an instruction key necessarily; resolved separately by caller.
  return [...new Set(out.map((p) => p.toBase58()))];
}

/** Deep-copy an instruction so later mutation of the original cannot affect it. */
function cloneInstruction(ix: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey,
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

/**
 * Build, sign (through the wallet's signTransaction only), verify, send raw and
 * confirm. Never uses wallet.sendTransaction so the final bytes can be checked.
 */
export async function signAndSend(
  connection: Connection,
  wallet: PaytruthWallet,
  instructions: TransactionInstruction[],
  opts: SignAndSendOptions = {},
): Promise<string> {
  const commitment = opts.commitment ?? 'confirmed';
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = blockhash;
  tx.add(...instructions);

  // Build `expected` from an independent deep copy so a wallet that mutates the
  // instructions it was given cannot also mutate our reference copy.
  const expected = new Transaction();
  expected.feePayer = wallet.publicKey;
  expected.recentBlockhash = blockhash;
  expected.add(...instructions.map(cloneInstruction));

  fireStage(opts.write, 'awaiting-signature');
  const signed = await wallet.signTransaction(tx);
  if (!(signed instanceof Transaction)) {
    throw new WalletModifiedTransactionError('The wallet returned a non-legacy transaction.');
  }
  verifySignedTransaction(expected, signed);

  // 'signed': the base58 signature of the fee payer (the wallet's publicKey).
  const signedSig = wallet.publicKey.toBase58();
  fireStage(opts.write, 'signed', { signature: signedSig });
  fireSigned(opts.write, signedSig);

  const raw = signed.serialize();
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
  } catch (err) {
    throw mapToPaytruthError(err);
  }
  fireStage(opts.write, 'sent', { signature });

  const confirmation = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    commitment,
  );
  if (confirmation.value.err) {
    throw mapToPaytruthError(confirmation.value.err);
  }
  fireStage(opts.write, 'confirmed', { signature });
  return signature;
}

class PaytruthMappedError extends Error {
  override name = 'PaytruthError';
  readonly mapped: ReturnType<typeof mapError>;
  constructor(mapped: ReturnType<typeof mapError>) {
    super(mapped.message);
    this.mapped = mapped;
  }
}

/** Convert an arbitrary error into a friendly Error carrying the mapped detail. */
export function mapToPaytruthError(err: unknown): Error {
  const mapped = mapError(err);
  if (err instanceof Error && /already escalated/i.test(err.message)) return err;
  const out = new PaytruthMappedError(mapped);
  if (err instanceof Error) out.cause = err;
  return out;
}
