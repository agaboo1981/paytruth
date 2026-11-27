import { Keypair, PublicKey, type Connection, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaytruthClient } from '../../src/client';
import { bindPaytruth, getBoundClient, paytruthSdk } from '../../src/bound';
import type { PaytruthWallet } from '../../src/send';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');

function conn(endpoint = 'http://localhost:8899'): Connection {
  return { rpcEndpoint: endpoint } as unknown as Connection;
}

function wallet(kp: Keypair): PaytruthWallet {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      (tx as Transaction).partialSign(kp);
      return tx;
    },
  };
}

afterEach(() => {
  // Reset to an unbound default between tests where possible by rebinding devnet.
  bindPaytruth({ programId: PROGRAM_ID });
});

describe('bound singleton', () => {
  it('delegates PDA reads to the bound client', () => {
    const kp = Keypair.generate();
    bindPaytruth({ connection: conn(), wallet: wallet(kp), programId: PROGRAM_ID });
    const [a] = paytruthSdk.getInvoicePda(kp.publicKey, 1n);
    const [b] = getBoundClient().getInvoicePda(kp.publicKey, 1n);
    expect(a.equals(b)).toBe(true);
  });

  it('re-creates the bound client on each bind', () => {
    bindPaytruth({ connection: conn(), programId: PROGRAM_ID });
    const first = getBoundClient();
    bindPaytruth({ connection: conn(), programId: PROGRAM_ID });
    const second = getBoundClient();
    expect(first).not.toBe(second);
    expect(second).toBeInstanceOf(PaytruthClient);
  });

  it('reads before any bind use a devnet connection (no throw)', () => {
    // getBoundClient should lazily create a client from resolveRpcEndpoint().
    const client = getBoundClient();
    expect(client.connection.rpcEndpoint).not.toContain('mainnet');
  });

  it('write methods with no wallet throw a friendly "Connect a wallet first." error', async () => {
    bindPaytruth({ connection: conn(), wallet: null, programId: PROGRAM_ID });
    await expect(
      paytruthSdk.payInvoice({ invoicePda: Keypair.generate().publicKey, amount: 1n, expectedAmountDue: 1n }),
    ).rejects.toThrow(/Connect a wallet first\./);
  });

  it('delegates writes to the bound client when a wallet is bound', async () => {
    const kp = Keypair.generate();
    const invoicePda = Keypair.generate().publicKey;
    const spy = vi.spyOn(PaytruthClient.prototype, 'expireInvoice').mockResolvedValue({
      signature: 'SIG',
      recovered: false,
    });
    bindPaytruth({ connection: conn(), wallet: wallet(kp), programId: PROGRAM_ID });
    const res = await paytruthSdk.expireInvoice({ invoicePda });
    expect(res.signature).toBe('SIG');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('bound singleton forwards write options', () => {
  const methods = [
    ['initializeConfig', { usdcMint: PublicKey.default }],
    ['createInvoice', { invoiceId: 1n, amountDue: 1n, expiresAt: 1n, memo: 'm' }],
    ['payInvoice', { invoicePda: PublicKey.default, amount: 1n, expectedAmountDue: 1n }],
    ['merchantClaim', { invoicePda: PublicKey.default }],
    ['refundOverpayment', { invoicePda: PublicKey.default }],
    ['expireInvoice', { invoicePda: PublicKey.default }],
    ['recoverUnattributed', { invoicePda: PublicKey.default, destinationAta: PublicKey.default }],
    ['closeInvoice', { invoicePda: PublicKey.default }],
  ] as const;

  for (const [name, args] of methods) {
    it(`${name} passes opts (onStage/onSigned) to the bound client`, async () => {
      bindPaytruth({ connection: conn(), wallet: wallet(Keypair.generate()), programId: PROGRAM_ID });
      const bound = getBoundClient();
      const spy = vi
        .spyOn(bound, name as never)
        .mockResolvedValue({ signature: 'sig', invoicePda: PublicKey.default, configPda: PublicKey.default } as never);
      const opts = { onStage: vi.fn(), onSigned: vi.fn() };
      await (paytruthSdk[name] as (a: unknown, o: unknown) => Promise<unknown>)(args, opts);
      expect(spy).toHaveBeenCalledWith(args, opts);
    });
  }
});
