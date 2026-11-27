import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { WalletModifiedTransactionError } from '../../src/errors';
import { signAndSend, verifySignedTransaction, type PaytruthWallet } from '../../src/send';

const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const PROGRAM = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const BLOCKHASH = '11111111111111111111111111111111';

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

function buildTx(feePayer: PublicKey, ixs: TransactionInstruction[]): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = BLOCKHASH;
  tx.add(...ixs);
  return tx;
}

function mockConnection() {
  const send = vi.fn().mockResolvedValue('SIG123');
  const confirm = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
  const conn = {
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: BLOCKHASH, lastValidBlockHeight: 500 }),
    sendRawTransaction: send,
    confirmTransaction: confirm,
  } as unknown as Connection;
  return { conn, send, confirm };
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

  it('accepts an identical transaction', () => {
    const { expected, signed } = signedPair([ix(TOKEN, [a, b])], [ix(TOKEN, [a, b])]);
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts extra ComputeBudget instructions only', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('rejects a changed fee payer', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const otherKp = Keypair.generate();
    const signed = buildTx(otherKp.publicKey, [ix(TOKEN, [a, b])]);
    signed.partialSign(otherKp);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a changed recentBlockhash', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const signed = buildTx(fp, [ix(TOKEN, [a, b])]);
    signed.recentBlockhash = 'So11111111111111111111111111111111111111112';
    signed.partialSign(feePayerKp);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects changed instruction data', () => {
    const { expected, signed } = signedPair([ix(TOKEN, [a, b], Buffer.from([1, 2, 3]))], [ix(TOKEN, [a, b], Buffer.from([9, 9, 9]))]);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects a changed account', () => {
    const { expected, signed } = signedPair([ix(TOKEN, [a, b])], [ix(TOKEN, [a, Keypair.generate().publicKey])]);
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects an extra non-ComputeBudget instruction', () => {
    const { expected, signed } = signedPair(
      [ix(TOKEN, [a, b])],
      [SystemProgram.transfer({ fromPubkey: fp, toPubkey: b, lamports: 1 }), ix(TOKEN, [a, b])],
    );
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });

  it('rejects when signatures are missing', () => {
    const expected = buildTx(fp, [ix(TOKEN, [a, b])]);
    expected.partialSign(feePayerKp);
    const signed = buildTx(fp, [ix(TOKEN, [a, b])]); // never signed
    expect(() => verifySignedTransaction(expected, signed)).toThrow(WalletModifiedTransactionError);
  });
});

describe('signAndSend', () => {
  it('signs with the wallet, sends raw bytes and confirms; returns signature', async () => {
    const kp = Keypair.generate();
    const wallet = keypairWallet(kp);
    const { conn, send, confirm } = mockConnection();
    const ixs = [ix(TOKEN, [kp.publicKey])];
    const sig = await signAndSend(conn, wallet, ixs, { commitment: 'confirmed' });
    expect(sig).toBe('SIG123');
    expect(wallet.signCalls).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const [raw, opts] = send.mock.calls[0]!;
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(opts).toMatchObject({ skipPreflight: false, preflightCommitment: 'confirmed' });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('throws a mapped error when the confirmation result carries an err', async () => {
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
});
