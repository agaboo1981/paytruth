// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Connection,
  type Message,
  type VersionedTransaction,
} from '@solana/web3.js';
import { utils } from '@anchor-lang/core';
import { mapError, TxTimeoutError, WalletModifiedTransactionError } from './errors';
import type { Commitment } from './types';

/** A wallet that can sign transactions (compatible with wallet-adapter useWallet / useAnchorWallet). */
export interface PaytruthWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
}

/**
 * Information about the attempt that was actually signed, filled in as soon as
 * it is known (before the raw send). Lets recovery reason about the blockhash
 * the wallet truly signed rather than our own copy.
 */
export interface SendAttempt {
  /** Base58 signature of the signed transaction (fee payer signature). */
  signature: string;
  /** The blockhash the wallet actually signed against. */
  signedBlockhash: string;
  /** Our lastValidBlockHeight, only set when the wallet kept our blockhash. */
  lastValidBlockHeight?: number;
}

export interface SignAndSendOptions {
  commitment?: Commitment;
  /** Optional write-stage callback hooks. Exceptions thrown here are ignored. */
  write?: WriteOptions;
  /** Filled in as soon as the signed bytes are known, before the raw send. */
  attempt?: SendAttempt;
  /** Polling interval for signature-status confirmation (default ~500ms). */
  confirmPollMs?: number;
  /** Bounded timeout for signature-status confirmation (default 90s). */
  confirmTimeoutMs?: number;
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

/** ComputeBudget instruction kind as encoded in data[0]. */
const CU_SET_COMPUTE_UNIT_LIMIT = 2;
const CU_SET_COMPUTE_UNIT_PRICE = 3;

/**
 * Classify a ComputeBudget instruction. Returns its allowlisted kind, or
 * `null` if it is not one of the allowlisted, well-formed, key-less kinds.
 */
function allowlistedComputeBudgetKind(
  ix: InstructionLike,
): typeof CU_SET_COMPUTE_UNIT_LIMIT | typeof CU_SET_COMPUTE_UNIT_PRICE | null {
  if (!ix.programId.equals(ComputeBudgetProgram.programId)) return null;
  if (ix.keys.length !== 0) return null;
  const data = ix.data;
  if (data.length === 5 && data[0] === CU_SET_COMPUTE_UNIT_LIMIT) return CU_SET_COMPUTE_UNIT_LIMIT;
  if (data.length === 9 && data[0] === CU_SET_COMPUTE_UNIT_PRICE) return CU_SET_COMPUTE_UNIT_PRICE;
  return null;
}

/** Remove all ComputeBudget instructions (validating allowlisted ones at most once each). */
function stripComputeBudget(ixs: TransactionInstruction[], who: string): TransactionInstruction[] {
  const out: TransactionInstruction[] = [];
  const seen = new Set<number>();
  for (const ix of ixs) {
    if (!ix.programId.equals(ComputeBudgetProgram.programId)) {
      out.push(ix);
      continue;
    }
    const kind = allowlistedComputeBudgetKind(ix);
    if (kind === null) {
      throw new WalletModifiedTransactionError(
        `${who} contains a ComputeBudget instruction that is not allowlisted (only SetComputeUnitLimit and SetComputeUnitPrice with no account keys are permitted).`,
      );
    }
    if (seen.has(kind)) {
      throw new WalletModifiedTransactionError(
        `${who} contains more than one of the same ComputeBudget instruction.`,
      );
    }
    seen.add(kind);
    // Drop it: allowlisted ComputeBudget instructions may be added/removed/changed.
  }
  return out;
}

/**
 * Instruction identity at the instruction level: program, data and the ORDERED
 * account pubkeys. Per-instruction isSigner/isWritable metas are deliberately
 * NOT compared here: a wallet that round-trips through Transaction.from(bytes)
 * (Wallet Standard adapters do) rebuilds every meta from the compiled message,
 * where e.g. the fee payer is always writable. The flags the chain actually
 * enforces are compared on the normalized compiled message instead.
 */
function sameInstructionShape(a: InstructionLike, b: InstructionLike): boolean {
  if (!a.programId.equals(b.programId)) return false;
  if (a.keys.length !== b.keys.length) return false;
  for (let i = 0; i < a.keys.length; i++) {
    if (!a.keys[i]!.pubkey.equals(b.keys[i]!.pubkey)) return false;
  }
  return Buffer.from(a.data).equals(Buffer.from(b.data));
}

/** Fixed placeholder so a wallet-refreshed blockhash does not affect the comparison. */
const NORMALIZE_BLOCKHASH = '11111111111111111111111111111111';

/**
 * Compile (fee payer + post-strip instructions) with a fixed blockhash. The
 * result is exactly what the runtime sees for privileges: header (signer and
 * read-only counts), ordered account keys, and compiled instructions.
 */
function normalizedMessage(feePayer: PublicKey, ixs: InstructionLike[]): Message {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = NORMALIZE_BLOCKHASH;
  for (const ix of ixs) {
    tx.add(
      new TransactionInstruction({
        programId: ix.programId,
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey, isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Buffer.from(ix.data),
      }),
    );
  }
  return tx.compileMessage();
}

function sameCompiledMessage(a: Message, b: Message): boolean {
  if (
    a.header.numRequiredSignatures !== b.header.numRequiredSignatures ||
    a.header.numReadonlySignedAccounts !== b.header.numReadonlySignedAccounts ||
    a.header.numReadonlyUnsignedAccounts !== b.header.numReadonlyUnsignedAccounts
  ) {
    return false;
  }
  if (a.accountKeys.length !== b.accountKeys.length) return false;
  for (let i = 0; i < a.accountKeys.length; i++) {
    if (!a.accountKeys[i]!.equals(b.accountKeys[i]!)) return false;
  }
  if (a.instructions.length !== b.instructions.length) return false;
  for (let i = 0; i < a.instructions.length; i++) {
    const x = a.instructions[i]!;
    const y = b.instructions[i]!;
    if (x.programIdIndex !== y.programIdIndex) return false;
    if (x.accounts.length !== y.accounts.length) return false;
    for (let j = 0; j < x.accounts.length; j++) if (x.accounts[j] !== y.accounts[j]) return false;
    if (x.data !== y.data) return false; // bs58 strings
  }
  return true;
}

/**
 * Verify the wallet returned a transaction we still trust.
 *
 * - The fee payer must be unchanged.
 * - The recent blockhash MAY change (wallets refresh it); it is not rejected.
 * - ComputeBudget instructions may be added, removed or changed, but only the
 *   allowlisted kinds: SetComputeUnitLimit (data[0]==2, len 5) and
 *   SetComputeUnitPrice (data[0]==3, len 9), with zero account keys, at most
 *   one of each. Anything else from the ComputeBudget program is rejected.
 * - After stripping allowlisted ComputeBudget instructions from both sides,
 *   the remaining instructions must be exactly equal: same count, same order,
 *   each identical in programId, data and ordered account pubkeys; signer and
 *   writable privileges are compared on the normalized compiled message (fixed
 *   blockhash, ComputeBudget stripped), so a Transaction.from(bytes) rebuild by
 *   the wallet adapter (fee payer meta becomes writable) is accepted while any
 *   real privilege change is rejected.
 * - The required signer set (fee payer + all isSigner keys) must be unchanged,
 *   signatures must verify, and every required signer must have signed.
 * - The signed message may not gain a writable account.
 */
export function verifySignedTransaction(expected: Transaction, signed: Transaction): void {
  if (!signed.feePayer || !expected.feePayer || !signed.feePayer.equals(expected.feePayer)) {
    throw new WalletModifiedTransactionError('The wallet changed the fee payer.');
  }

  const expectedIxs = stripComputeBudget(expected.instructions, 'The transaction');
  const signedIxs = stripComputeBudget(signed.instructions, 'The signed transaction');

  if (expectedIxs.length !== signedIxs.length) {
    throw new WalletModifiedTransactionError(
      `The wallet changed the number of instructions (expected ${expectedIxs.length}, got ${signedIxs.length}).`,
    );
  }
  for (let i = 0; i < expectedIxs.length; i++) {
    const exp = expectedIxs[i]!;
    const got = signedIxs[i]!;
    if (!got.programId.equals(exp.programId)) {
      throw new WalletModifiedTransactionError('The wallet changed or reordered an instruction.');
    }
    if (!sameInstructionShape(exp, got)) {
      throw new WalletModifiedTransactionError('The wallet modified an instruction\'s accounts or data.');
    }
  }

  // Privileges as the runtime sees them: compare the normalized compiled
  // messages (fixed blockhash, allowlisted ComputeBudget stripped). Any signer
  // or writable change, other than the representation-only rebuild of metas,
  // changes the header, key order or compiled account indexes and is rejected.
  let normExpected: Message;
  let normSigned: Message;
  try {
    normExpected = normalizedMessage(expected.feePayer, expectedIxs);
    normSigned = normalizedMessage(signed.feePayer, signedIxs);
  } catch {
    throw new WalletModifiedTransactionError('The wallet returned a transaction that cannot be compiled.');
  }
  if (!sameCompiledMessage(normExpected, normSigned)) {
    throw new WalletModifiedTransactionError('The wallet changed which accounts are signers or writable.');
  }

  try {
    const valid = signed.verifySignatures();
    if (!valid) throw new Error('invalid signatures');
  } catch {
    throw new WalletModifiedTransactionError('The signed transaction is missing valid signatures.');
  }

  // Required signer set = fee payer + all isSigner keys of the (post-strip) ixs.
  const requiredSigners = requiredSignerKeys(signed.feePayer, signedIxs);
  const expectedSigners = requiredSignerKeys(expected.feePayer, expectedIxs);
  if (!sameKeySet(requiredSigners, expectedSigners)) {
    throw new WalletModifiedTransactionError('The wallet added or removed a required signer.');
  }

  const present = new Set<string>();
  for (const sig of signed.signatures) {
    if (sig.publicKey && sig.signature && sig.signature.length > 0) present.add(sig.publicKey.toBase58());
  }
  for (const pk of requiredSigners) {
    if (!present.has(pk)) {
      throw new WalletModifiedTransactionError(`Missing signature for ${pk}.`);
    }
  }

  // Defence in depth: the compiled signed message must not make any extra
  // account writable compared to the compiled expected message.
  let signedMsg;
  let expectedMsg;
  try {
    signedMsg = signed.compileMessage();
    expectedMsg = expected.compileMessage();
  } catch {
    throw new WalletModifiedTransactionError('The wallet returned a transaction that cannot be compiled.');
  }
  const expectedWritable = new Set(
    expectedMsg.accountKeys.filter((_, i) => expectedMsg.isAccountWritable(i)).map((k) => k.toBase58()),
  );
  for (let i = 0; i < signedMsg.accountKeys.length; i++) {
    const key = signedMsg.accountKeys[i]!;
    if (signedMsg.isAccountWritable(i) && !expectedWritable.has(key.toBase58())) {
      throw new WalletModifiedTransactionError('The wallet made an unexpected account writable.');
    }
  }
}

function requiredSignerKeys(
  feePayer: PublicKey | null,
  ixs: { keys: { pubkey: PublicKey; isSigner: boolean }[] }[],
): string[] {
  const out = new Set<string>();
  if (feePayer) out.add(feePayer.toBase58());
  for (const ix of ixs) {
    for (const k of ix.keys) {
      if (k.isSigner) out.add(k.pubkey.toBase58());
    }
  }
  return [...out].sort();
}

function sameKeySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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

  // The real transaction signature is the fee payer's signature (bs58).
  const signedBlockhash = signed.recentBlockhash;
  const feePayerSig = signed.signature;
  if (!feePayerSig) {
    throw new WalletModifiedTransactionError('The signed transaction has no fee payer signature.');
  }
  if (!signedBlockhash) {
    throw new WalletModifiedTransactionError('The signed transaction has no recent blockhash.');
  }
  const signedSig = utils.bytes.bs58.encode(feePayerSig);

  // Record what the wallet actually signed before we send, so recovery can
  // decide blockhash expiry against it.
  if (opts.attempt) {
    opts.attempt.signature = signedSig;
    opts.attempt.signedBlockhash = signedBlockhash;
    if (signedBlockhash === blockhash) opts.attempt.lastValidBlockHeight = lastValidBlockHeight;
    else delete opts.attempt.lastValidBlockHeight;
  }

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
    throw attachAttempt(mapToPaytruthError(err), opts.attempt, signedSig);
  }
  fireStage(opts.write, 'sent', { signature });

  try {
    if (signedBlockhash === blockhash) {
      const confirmation = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        commitment,
      );
      if (confirmation.value.err) {
        throw mapToPaytruthError(confirmation.value.err);
      }
    } else {
      // The wallet refreshed the blockhash; we cannot reuse our lastValidBlockHeight.
      await confirmBySignatureStatus(connection, signature, {
        blockhash: signedBlockhash,
        commitment,
        pollMs: opts.confirmPollMs,
        timeoutMs: opts.confirmTimeoutMs,
      });
    }
  } catch (err) {
    throw attachAttempt(err, opts.attempt, signedSig);
  }
  fireStage(opts.write, 'confirmed', { signature });
  return signature;
}

/** Attach `attempt` (and the recorded signature) to an error so recovery can read it. */
function attachAttempt(err: unknown, attempt: SendAttempt | undefined, signature: string): Error {
  const out = err instanceof Error ? err : mapToPaytruthError(err);
  const target = out as Error & { signature?: string; attempt?: SendAttempt };
  if (target.signature === undefined) target.signature = signature;
  if (attempt) target.attempt = attempt;
  return out;
}

export interface ConfirmBySignatureStatusOptions {
  /** The blockhash the signed transaction used; polled via isBlockhashValid. */
  blockhash: string;
  commitment?: Commitment;
  /** Polling interval (default 500ms). */
  pollMs?: number;
  /** Bounded timeout (default 90s). */
  timeoutMs?: number;
}

const COMMITMENT_RANK: Record<string, number> = {
  processed: 0,
  confirmed: 1,
  finalized: 2,
  recent: 0,
  'single': 0,
  'singleGossip': 0,
  'root': 2,
  'max': 2,
};

function commitmentReached(
  status: string | null | undefined,
  target: string,
): boolean {
  if (!status) return false;
  const have = COMMITMENT_RANK[status];
  const want = COMMITMENT_RANK[target];
  if (have === undefined || want === undefined) return status === target;
  return have >= want;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `getSignatureStatuses([signature])` until the transaction reaches the
 * requested commitment. Throws a mapped error on an on-chain `err`, a retryable
 * block-height-exceeded error once `isBlockhashValid(blockhash, processed)`
 * reports false, or a retryable timeout after `timeoutMs`. Exported so it can be
 * unit tested with a mocked Connection and fake/short timings.
 */
export async function confirmBySignatureStatus(
  connection: Connection,
  signature: string,
  opts: ConfirmBySignatureStatusOptions,
): Promise<void> {
  const commitment = opts.commitment ?? 'confirmed';
  const pollMs = opts.pollMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const started = Date.now();

  for (;;) {
    let status: { err: unknown; confirmationStatus?: string } | null = null;
    try {
      const res = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
      status = (res.value?.[0] ?? null) as { err: unknown; confirmationStatus?: string } | null;
    } catch (err) {
      // Transient RPC hiccup: keep polling until the timeout.
      void err;
    }

    if (status) {
      if (status.err) {
        throw mapToPaytruthError(status.err);
      }
      if (commitmentReached(status.confirmationStatus, commitment)) {
        return;
      }
    }

    if (Date.now() - started >= timeoutMs) {
      throw mapToPaytruthError(
        new TxTimeoutError(`Timed out after ${timeoutMs}ms waiting for signature ${signature} to confirm.`),
      );
    }

    let blockhashValid = true;
    try {
      const valid = await connection.isBlockhashValid(opts.blockhash, { commitment: 'processed' });
      blockhashValid = valid.value;
    } catch {
      blockhashValid = true; // on RPC error, do not give up early
    }
    if (!blockhashValid) {
      throw mapToPaytruthError(
        new TxTimeoutError(
          `The transaction blockhash ${opts.blockhash} expired before signature ${signature} confirmed. It can be retried.`,
        ),
      );
    }

    await delay(pollMs);
  }
}

class PaytruthMappedError extends Error {
  override name = 'PaytruthError';
  readonly mapped: ReturnType<typeof mapError>;
  signature?: string;
  attempt?: SendAttempt;
  readonly retryable: boolean;
  constructor(mapped: ReturnType<typeof mapError>) {
    super(mapped.message);
    this.mapped = mapped;
    this.retryable = mapped.retryable;
  }
}

/** Convert an arbitrary error into a friendly Error carrying the mapped detail. */
export function mapToPaytruthError(err: unknown): Error {
  const mapped = mapError(err);
  if (err instanceof Error && /already escalated/i.test(err.message)) return err;
  const out = new PaytruthMappedError(mapped);
  if (err instanceof Error) out.cause = err;
  // Preserve recovery metadata (attempt info, signature) if present.
  const src = err as { signature?: unknown; attempt?: unknown } | null;
  if (src) {
    if (typeof src.signature === 'string') out.signature = src.signature;
    if (src.attempt && typeof src.attempt === 'object') out.attempt = src.attempt as SendAttempt;
  }
  return out;
}
