import { Keypair, PublicKey, Transaction, type Connection, type VersionedTransaction } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { PaytruthClient } from '../../src/client';
import { WalletModifiedTransactionError } from '../../src/errors';
import type { PaytruthWallet } from '../../src/send';
import type { WriteOptions, WriteStage } from '../../src/send';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const VALID_BLOCKHASH = '11111111111111111111111111111111';

function signingWallet(kp: Keypair): PaytruthWallet {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      (tx as Transaction).partialSign(kp);
      return tx;
    },
  };
}

function mockConnection() {
  const send = vi.fn().mockResolvedValue('SIG_OK');
  const confirm = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
  const conn = {
    rpcEndpoint: 'http://localhost:8899',
    getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: VALID_BLOCKHASH, lastValidBlockHeight: 500 }),
    getBlockHeight: vi.fn().mockResolvedValue(100),
    sendRawTransaction: send,
    confirmTransaction: confirm,
    // expire_invoice builder does not need network; expiry client fetch does not either.
    getAccountInfo: vi.fn().mockResolvedValue(null),
  } as unknown as Connection;
  return { conn, send, confirm };
}

describe('write-stage callbacks (expireInvoice success path)', () => {
  it('fires awaiting-signature -> signed -> sent -> confirmed in order', async () => {
    const kp = Keypair.generate();
    const { conn } = mockConnection();
    const client = new PaytruthClient({ connection: conn, wallet: signingWallet(kp), programId: PROGRAM_ID });
    const stages: string[] = [];
    const signedSigs: string[] = [];
    const invoicePda = Keypair.generate().publicKey;

    // expire uses writeWithRecovery with landed(status Expired); mock getAccountInfo null would
    // fail landed only on recovery, which we don't hit on success.
    const opts: WriteOptions = {
      onStage: (stage: WriteStage, info) => {
        stages.push(info?.signature ? `${stage}:${info.signature}` : stage);
      },
      onSigned: (sig) => signedSigs.push(sig),
    };

    await client.expireInvoice({ invoicePda }, opts);

    expect(stages.map((s) => s.split(':')[0])).toEqual(['awaiting-signature', 'signed', 'sent', 'confirmed']);
    // signed carries the fee payer base58 signature, and onSigned matches it.
    expect(stages[1]!.startsWith(`signed:${kp.publicKey.toBase58()}`)).toBe(true);
    expect(signedSigs.length).toBe(1);
    expect(signedSigs[0]).toBe(kp.publicKey.toBase58());
  });

  it('does not fire signed/sent when the wallet rejects signing', async () => {
    const kp = Keypair.generate();
    const { conn } = mockConnection();
    const rejecting: PaytruthWallet = {
      publicKey: kp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
        const e = new Error('User rejected');
        e.name = 'WalletSignTransactionError';
        throw e;
      },
    };
    const client = new PaytruthClient({ connection: conn, wallet: rejecting, programId: PROGRAM_ID });
    const stages: string[] = [];
    await expect(
      client.expireInvoice(
        { invoicePda: Keypair.generate().publicKey },
        { onStage: (s) => stages.push(s) },
      ),
    ).rejects.toBeTruthy();
    expect(stages).toEqual(['awaiting-signature']);
  });

  it('does not fire sent when the byte check fails (wallet changes data)', async () => {
    const kp = Keypair.generate();
    const { conn, send } = mockConnection();
    const tampering: PaytruthWallet = {
      publicKey: kp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        const t = tx as Transaction;
        // Tamper with the instruction data before signing.
        t.instructions[0]!.data = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]);
        t.partialSign(kp);
        return tx;
      },
    };
    const client = new PaytruthClient({ connection: conn, wallet: tampering, programId: PROGRAM_ID });
    const stages: string[] = [];
    await expect(
      client.expireInvoice(
        { invoicePda: Keypair.generate().publicKey },
        { onStage: (s) => stages.push(s) },
      ),
    ).rejects.toBeInstanceOf(WalletModifiedTransactionError);
    expect(stages).toEqual(['awaiting-signature']);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores exceptions thrown by callbacks', async () => {
    const kp = Keypair.generate();
    const { conn } = mockConnection();
    const client = new PaytruthClient({ connection: conn, wallet: signingWallet(kp), programId: PROGRAM_ID });
    const result = await client.expireInvoice(
      { invoicePda: Keypair.generate().publicKey },
      {
        onStage: () => {
          throw new Error('boom');
        },
        onSigned: () => {
          throw new Error('boom2');
        },
      },
    );
    expect(result.signature).toBe('SIG_OK');
  });
});
