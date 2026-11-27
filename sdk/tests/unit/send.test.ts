import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
  type VersionedTransaction,
} from '@solana/web3.js';
import { utils } from '@anchor-lang/core';
import { describe, expect, it, vi } from 'vitest';
import { TxTimeoutError, WalletModifiedTransactionError } from '../../src/errors';
import { confirmBySignatureStatus, signAndSend, verifySignedTransaction, type PaytruthWallet } from '../../src/send';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const BLOCKHASH = '11111111111111111111111111111111';
const OTHER_BLOCKHASH = 'So11111111111111111111111111111111111111112';

function ix(programId: PublicKey, keys: PublicKey[], data = Buffer.from([1, 2, 3])): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys: keys.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    data,
  });
}

function keypairWallet(kp: Keypair): PaytruthWallet & { signCalls: number } {
  return {
    publicKey: kp.publicKey,
    signCalls: 0,
    async signTransaction<T extends Transaction>(tx: T): Promise<T> {
      this.signCalls++;
      tx.partialSign(kp);
      return tx;
    },
  } as PaytruthWallet & { signCalls: number };
}

function buildTx(feePayer: PublicKey, ixs: TransactionInstruction[], blockhash = BLOCKHASH): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  return tx;
}

function mockConnection() {
  const send = vi.fn().mockResolvedValue('SIG123');
  const confirm = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
  const getSignatureStatuses = vi
    .fn()
    .mockResolvedValue({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 0, err: null, confirmationStatus: 'confirmed' }] });
  const isBlockhashValid = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: true });
  const conn = {
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: BLOCKHASH, lastValidBlockHeight: 500 }),
    sendRawTransaction: send,
    confirmTransaction: confirm,
    getSignatureStatuses,
    isBlockhashValid,
  } as unknown as Connection;
  return { conn, send, confirm, getSignatureStatuses, isBlockhashValid };
}

describe('verifySignedTransaction', () => {
  const a = Keypair.generate().publicKey;
  const b = Keypair.generate().publicKey;
  const feePayerKp = Keypair.generate();
  const fp = feePayerKp.publicKey;

  function signedPair(expectedIxs: TransactionInstruction[], signedIxs: TransactionInstruction[]) {
    const expected = buildTx(fp, expectedIxs);
    expected.partialSign(feePayerKp);
    const signed = buildTx(fp, signedIxs);
    signed.partialSign(feePayerKp);
    return { expected, signed };
  }

  // ----- accepted mutations -----------------------------------------------

  it('accepts an identical transaction', () => {
    const { expected, signed } = signedPair([ix(TOKEN, [a, b])], [ix(TOKEN, [a, b])]);
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts a blockhash swapped by the wallet (re-signed)', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const signed = buildTx(fp, [ix(TOKEN, [a, b])], OTHER_BLOCKHASH);
    signed.partialSign(feePayerKp);
    expect(signed.recentBlockhash).not.toBe(expected.recentBlockhash);
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts an added SetComputeUnitPrice', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts a changed SetComputeUnitPrice', () => {
    const { expected, signed } = signedPair(
      [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), ix(TOKEN, [a, b])],
      [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 999_999 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts an added SetComputeUnitLimit', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts the wallet removing an expected SetComputeUnitPrice', () => {
    const { expected, signed } = signedPair(
      [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }), ix(TOKEN, [a, b])],
      [ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  // ----- rejected ComputeBudget mutations ---------------------------------

  it('rejects an added RequestHeapFrame', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a ComputeBudget instruction carrying an account key', () => {
    const badCb = new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      keys: [{ pubkey: a, isSigner: false, isWritable: false }],
      data: ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }).data,
    });
    const { expected, signed } = signedPair([ix(TOKEN, [a, b])], [badCb, ix(TOKEN, [a, b])]);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects two SetComputeUnitPrice instructions', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2 }),
        ix(TOKEN, [a, b]),
      ],
    );
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  // ----- rejected instruction mutations -----------------------------------

  it('rejects an extra SystemProgram.transfer', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [SystemProgram.transfer({ fromPubkey: fp, toPubkey: b, lamports: 1 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a prepended SystemProgram.nonceAdvance', () => {
    const nonceAccount = Keypair.generate().publicKey;
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: fp }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects changed program instruction data', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b], Buffer.from([1, 2, 3]))],
      [ix(TOKEN, [a, b], Buffer.from([9, 9, 9]))],
    );
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a changed account pubkey', () => {
    const { expected, signed } = signedPair([ix(TOKEN, [a, b])], [ix(TOKEN, [a, Keypair.generate().publicKey])]);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects an isWritable flag flipped', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const flipped = new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: a, isSigner: false, isWritable: true },
        { pubkey: b, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1, 2, 3]),
    });
    const signed = buildTx(fp, [flipped]);
    signed.partialSign(feePayerKp);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects two program instructions reordered', () => {
    const c = Keypair.generate().publicKey;
    const { expected, signed } = signedPair([ix(TOKEN, [a, b]), ix(TOKEN, [b, c])], [ix(TOKEN, [b, c]), ix(TOKEN, [a, b])]);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a removed program instruction', () => {
    const c = Keypair.generate().publicKey;
    const { expected, signed } = signedPair([ix(TOKEN, [a, b]), ix(TOKEN, [b, c])], [ix(TOKEN, [a, b])]);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  // ----- signer-set mutations ---------------------------------------------

  it('rejects a changed fee payer', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const otherKp = Keypair.generate();
    const signed = buildTx(otherKp.publicKey, [ix(TOKEN, [a, b])]);
    signed.partialSign(otherKp);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects an extra signer', () => {
    const extraKp = Keypair.generate();
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const signedIx = new TransactionInstruction({
      programId: TOKEN,
      keys: [
        { pubkey: a, isSigner: false, isWritable: true },
        { pubkey: b, isSigner: false, isWritable: true },
        { pubkey: extraKp.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([1, 2, 3]),
    });
    const signed = buildTx(fp, [signedIx]);
    signed.partialSign(feePayerKp, extraKp);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a missing signature', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const signed = buildTx(fp, [ix(TOKEN, [a, b])]); // never signed
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });
});

describe('signAndSend', () => {
  it('signs with the wallet, sends raw bytes and confirms via confirmTransaction when blockhash unchanged', async () => {
    const kp = Keypair.generate();
    const wallet = keypairWallet(kp);
    const { conn, send, confirm, getSignatureStatuses } = mockConnection();
    const sig = await signAndSend(conn, wallet, [ix(TOKEN, [kp.publicKey])], { commitment: 'confirmed' });
    expect(sig).toBe('SIG123');
    expect(wallet.signCalls).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [raw, opts] = send.mock.calls[0]!;
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(opts).toMatchObject({ skipPreflight: false, preflightCommitment: 'confirmed' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      { signature: 'SIG123', blockhash: BLOCKHASH, lastValidBlockHeight: 500 },
      'confirmed',
    );
    expect(getSignatureStatuses).not.toHaveBeenCalled();
  });

  it('uses confirmBySignatureStatus (not confirmTransaction) when the wallet changed the blockhash', async () => {
    const kp = Keypair.generate();
    const wallet: PaytruthWallet = {
      publicKey: kp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        (tx as Transaction).recentBlockhash = OTHER_BLOCKHASH;
        (tx as Transaction).partialSign(kp);
        return tx;
      },
    };
    const { conn, confirm, getSignatureStatuses } = mockConnection();
    const sig = await signAndSend(conn, wallet, [ix(TOKEN, [kp.publicKey])], {
      commitment: 'confirmed',
      confirmPollMs: 1,
      confirmTimeoutMs: 1000,
    });
    expect(sig).toBe('SIG123');
    expect(confirm).not.toHaveBeenCalled();
    expect(getSignatureStatuses).toHaveBeenCalled();
  });

  it('throws a mapped error when confirmTransaction reports an err', async () => {
    const kp = Keypair.generate();
    const wallet = keypairWallet(kp);
    const { conn } = mockConnection();
    (conn.confirmTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({
      context: { slot: 1 },
      value: { err: { InstructionError: [0, { Custom: 6001 }] } },
    });
    await expect(signAndSend(conn, wallet, [ix(TOKEN, [kp.publicKey])], { commitment: 'confirmed' })).rejects.toThrow(
      /already paid|not open/i,
    );
  });

  it('reports the real base58 signature in the signed stage', async () => {
    const kp = Keypair.generate();
    const wallet = keypairWallet(kp);
    const { conn, send } = mockConnection();
    let signedSig: string | undefined;
    let onSignedSig: string | undefined;
    await signAndSend(conn, wallet, [ix(TOKEN, [kp.publicKey])], {
      commitment: 'confirmed',
      write: {
        onStage: (stage, info) => {
          if (stage === 'signed') signedSig = info?.signature;
        },
        onSigned: (s) => {
          onSignedSig = s;
        },
      },
    });
    const [raw] = send.mock.calls[0]!;
    const sent = Transaction.from(raw);
    const realSig = utils.bytes.bs58.encode(sent.signature!);
    expect(signedSig).toBe(realSig);
    expect(onSignedSig).toBe(realSig);
    expect(realSig).not.toBe(kp.publicKey.toBase58());
  });
});

describe('confirmBySignatureStatus', () => {
  function statusConnection(statuses: unknown[], isBlockhashValid = true) {
    let i = 0;
    const getSignatureStatuses = vi.fn().mockImplementation(async () => {
      const value = statuses[Math.min(i, statuses.length - 1)];
      i++;
      return { context: { slot: 1 }, value: [value] };
    });
    const isBlockhashValidFn = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: isBlockhashValid });
    const conn = { getSignatureStatuses, isBlockhashValid: isBlockhashValidFn } as unknown as Connection;
    return { conn, getSignatureStatuses, isBlockhashValid: isBlockhashValidFn };
  }

  it('resolves once the status reaches the requested commitment', async () => {
    const { conn } = statusConnection([
      null,
      { slot: 1, confirmations: 1, err: null, confirmationStatus: 'processed' },
      { slot: 1, confirmations: 0, err: null, confirmationStatus: 'confirmed' },
    ]);
    await expect(
      confirmBySignatureStatus(conn, 'SIG', { blockhash: OTHER_BLOCKHASH, commitment: 'confirmed', pollMs: 1 }),
    ).resolves.toBeUndefined();
  });

  it('throws a mapped program error when the status carries an err', async () => {
    const { conn } = statusConnection([{ slot: 1, confirmations: 0, err: { InstructionError: [0, { Custom: 6001 }] }, confirmationStatus: 'confirmed' }]);
    await expect(
      confirmBySignatureStatus(conn, 'SIG', { blockhash: OTHER_BLOCKHASH, commitment: 'confirmed', pollMs: 1 }),
    ).rejects.toThrow(/already paid|not open/i);
  });

  it('throws a retryable error when the blockhash becomes invalid', async () => {
    const { conn } = statusConnection([null], false);
    const err = await confirmBySignatureStatus(conn, 'SIG', {
      blockhash: OTHER_BLOCKHASH,
      commitment: 'confirmed',
      pollMs: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(/expired|blockhash|retry/i.test((err as Error).message)).toBe(true);
  });

  it('times out with a retryable error', async () => {
    const { conn } = statusConnection([null], true);
    const err = await confirmBySignatureStatus(conn, 'SIG', {
      blockhash: OTHER_BLOCKHASH,
      commitment: 'confirmed',
      pollMs: 1,
      timeoutMs: 20,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(/timed out|timeout/i.test((err as Error).message)).toBe(true);
  });
});

// sanity that TxTimeoutError stays imported/used by the suite
it('TxTimeoutError is a distinct retryable-style error', () => {
  expect(new TxTimeoutError()).toBeInstanceOf(Error);
});
