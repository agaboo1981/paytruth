/**
 * Real Wallet Standard path: the adapter returns Transaction.from(signedBytes),
 * which rebuilds instruction metas from the compiled message (the fee payer is
 * always writable there). verifySignedTransaction must accept that rebuild and
 * still reject real tampering.
 */
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type Connection,
} from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { WalletModifiedTransactionError } from '../../src/errors';
import { buildExpireInvoiceIx, buildMerchantClaimIx, buildPayInvoiceIx } from '../../src/instructions';
import { signAndSend, verifySignedTransaction, type PaytruthWallet } from '../../src/send';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const invoicePda = Keypair.generate().publicKey;
const BLOCKHASH = '11111111111111111111111111111111';
const OTHER_BLOCKHASH = 'So11111111111111111111111111111111111111112';

function build(feePayer: PublicKey, ixs: TransactionInstruction[], blockhash = BLOCKHASH): Transaction {
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  return tx;
}

/** What a Wallet Standard adapter does: sign, serialize, Transaction.from(bytes). */
function rebuild(tx: Transaction): Transaction {
  return Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

function cloneIx(ix: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: ix.programId,
    keys: ix.keys.map((k) => ({ ...k })),
    data: Buffer.from(ix.data),
  });
}

function signedRebuilt(kp: Keypair, ixs: TransactionInstruction[], blockhash = BLOCKHASH) {
  const expected = build(kp.publicKey, ixs.map(cloneIx));
  const tx = build(kp.publicKey, ixs.map(cloneIx), blockhash);
  tx.partialSign(kp);
  return { expected, signed: rebuild(tx) };
}

async function payIx(payer: PublicKey) {
  return buildPayInvoiceIx({ payer, invoicePda, mint, amount: 1_000_000n, expectedAmountDue: 1_000_000n }, PROGRAM_ID);
}
async function expireIx(caller: PublicKey) {
  return buildExpireInvoiceIx({ caller, invoicePda }, PROGRAM_ID);
}
async function claimIx(merchant: PublicKey) {
  return buildMerchantClaimIx({ merchant, invoicePda, mint }, PROGRAM_ID);
}

describe('verifySignedTransaction after a Transaction.from rebuild (Wallet Standard)', () => {
  it('confirms the root cause: the rebuild flips the read-only fee payer meta to writable', async () => {
    const kp = Keypair.generate();
    const ix = await payIx(kp.publicKey);
    expect(ix.keys[0]!.pubkey.equals(kp.publicKey)).toBe(true);
    expect(ix.keys[0]!.isWritable).toBe(false);
    const { signed } = signedRebuilt(kp, [ix]);
    const rebuiltMeta = signed.instructions[0]!.keys.find((k) => k.pubkey.equals(kp.publicKey))!;
    expect(rebuiltMeta.isWritable).toBe(true);
  });

  it('accepts pay_invoice (payer = read-only signer + fee payer)', async () => {
    const kp = Keypair.generate();
    const { expected, signed } = signedRebuilt(kp, [await payIx(kp.publicKey)]);
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts expire_invoice (caller = read-only signer + fee payer)', async () => {
    const kp = Keypair.generate();
    const { expected, signed } = signedRebuilt(kp, [await expireIx(kp.publicKey)]);
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('control: merchant_claim (merchant already writable) is accepted', async () => {
    const kp = Keypair.generate();
    const { expected, signed } = signedRebuilt(kp, [await claimIx(kp.publicKey)]);
    expect(() => verifySignedTransaction(expected, signed)).not.toThrow();
  });

  it('accepts a rebuild with a refreshed blockhash and an allowlisted SetComputeUnitPrice', async () => {
    const kp = Keypair.generate();
    const ix = await payIx(kp.publicKey);
    const expected = build(kp.publicKey, [cloneIx(ix)]);
    const tx = build(kp.publicKey, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), cloneIx(ix)], OTHER_BLOCKHASH);
    tx.partialSign(kp);
    expect(() => verifySignedTransaction(expected, rebuild(tx))).not.toThrow();
  });

  it('still rejects a NON-fee-payer account flipped to writable (rebuilt)', async () => {
    const kp = Keypair.generate();
    const ix = await payIx(kp.publicKey);
    // Find a read-only, non-signer account (e.g. config / mint / token program) and flip it.
    const idx = ix.keys.findIndex((k) => !k.isWritable && !k.isSigner);
    expect(idx).toBeGreaterThan(-1);
    const tampered = cloneIx(ix);
    tampered.keys[idx] = { ...tampered.keys[idx]!, isWritable: true };
    const expected = build(kp.publicKey, [cloneIx(ix)]);
    const tx = build(kp.publicKey, [tampered]);
    tx.partialSign(kp);
    expect(() => verifySignedTransaction(expected, rebuild(tx))).toThrow(WalletModifiedTransactionError);
  });

  it('still rejects a writable account narrowed to read-only (rebuilt)', async () => {
    const kp = Keypair.generate();
    const ix = await payIx(kp.publicKey);
    const idx = ix.keys.findIndex((k) => k.isWritable && !k.pubkey.equals(kp.publicKey));
    const tampered = cloneIx(ix);
    tampered.keys[idx] = { ...tampered.keys[idx]!, isWritable: false };
    const expected = build(kp.publicKey, [cloneIx(ix)]);
    const tx = build(kp.publicKey, [tampered]);
    tx.partialSign(kp);
    expect(() => verifySignedTransaction(expected, rebuild(tx))).toThrow(WalletModifiedTransactionError);
  });

  it('still rejects changed data / extra instruction / changed fee payer after a rebuild', async () => {
    const kp = Keypair.generate();
    const ix = await payIx(kp.publicKey);
    const expected = build(kp.publicKey, [cloneIx(ix)]);

    const badData = cloneIx(ix);
    badData.data = Buffer.from(badData.data);
    badData.data[badData.data.length - 1] = badData.data[badData.data.length - 1]! ^ 1;
    const t1 = build(kp.publicKey, [badData]);
    t1.partialSign(kp);
    expect(() => verifySignedTransaction(expected, rebuild(t1))).toThrow(WalletModifiedTransactionError);

    const t2 = build(kp.publicKey, [cloneIx(ix), cloneIx(ix)]);
    t2.partialSign(kp);
    expect(() => verifySignedTransaction(expected, rebuild(t2))).toThrow(WalletModifiedTransactionError);

    const other = Keypair.generate();
    const t3 = build(other.publicKey, [cloneIx(ix)]);
    t3.partialSign(other, kp);
    expect(() => verifySignedTransaction(expected, rebuild(t3))).toThrow(WalletModifiedTransactionError);
  });
});

describe('signAndSend with a rebuilding wallet', () => {
  function rebuildingWallet(kp: Keypair): PaytruthWallet {
    return {
      publicKey: kp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        (tx as Transaction).partialSign(kp);
        return rebuild(tx as Transaction) as T;
      },
    };
  }
  function conn() {
    return {
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: BLOCKHASH, lastValidBlockHeight: 500 }),
      sendRawTransaction: vi.fn().mockResolvedValue('SIG'),
      confirmTransaction: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } }),
    } as unknown as Connection;
  }

  for (const [name, mk] of [
    ['pay_invoice', payIx],
    ['expire_invoice', expireIx],
    ['merchant_claim', claimIx],
  ] as const) {
    it(`${name}: sends the rebuilt transaction`, async () => {
      const kp = Keypair.generate();
      const c = conn();
      await expect(signAndSend(c, rebuildingWallet(kp), [await mk(kp.publicKey)])).resolves.toBeTypeOf('string');
      expect(c.sendRawTransaction).toHaveBeenCalledTimes(1);
    });
  }

  it('versioned path: a wallet returning a VersionedTransaction is rejected (we only build legacy)', async () => {
    const kp = Keypair.generate();
    const wallet: PaytruthWallet = {
      publicKey: kp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        const v = new VersionedTransaction((tx as Transaction).compileMessage());
        v.sign([kp]);
        return v as unknown as T;
      },
    };
    await expect(signAndSend(conn(), wallet, [await payIx(kp.publicKey)])).rejects.toThrow(WalletModifiedTransactionError);
  });
});
