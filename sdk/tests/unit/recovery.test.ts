import { BorshAccountsCoder, BN } from '@anchor-lang/core';
import { Keypair, PublicKey, Transaction, VersionedTransaction, type Connection } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaytruthClient } from '../../src/client';
import { PAYTRUTH_IDL } from '../../src/idl';
import { getInvoicePda } from '../../src/pda';
import { InvoiceStatus, type Invoice } from '../../src/types';
import { PaytruthError, TxTimeoutError, WalletNotSupportedError } from '../../src/errors';
import type { PaytruthWallet } from '../../src/send';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const coder = new BorshAccountsCoder(PAYTRUTH_IDL as never);

const merchantKp = Keypair.generate();
const payerKp = Keypair.generate();

async function encodeInvoice(o: Partial<Invoice> & { invoiceId: bigint }): Promise<Buffer> {
  const memo = new Uint8Array(64);
  if (o.memo) memo.set(o.memo.slice(0, 64));
  return (await coder.encode('Invoice', {
    merchant: o.merchant ?? merchantKp.publicKey,
    payer: o.payer ?? PublicKey.default,
    mint: o.mint ?? mint,
    invoice_id: new BN(o.invoiceId.toString()),
    amount_due: new BN((o.amountDue ?? 100n).toString()),
    paid_amount: new BN((o.paidAmount ?? 0n).toString()),
    refunded_excess: new BN((o.refundedExcess ?? 0n).toString()),
    created_at: new BN((o.createdAt ?? 0n).toString()),
    expires_at: new BN((o.expiresAt ?? 9_999_999_999n).toString()),
    status: o.status ?? 0,
    claimed: o.claimed ?? false,
    bump: o.bump ?? 255,
    memo,
  })) as Buffer;
}

function info(data: Buffer, owner = PROGRAM_ID) {
  return { data, executable: false, lamports: 1_000_000, owner, rentEpoch: 0 };
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

const [invoicePda] = getInvoicePda(merchantKp.publicKey, 1n, PROGRAM_ID);

describe('payInvoice recovery (TEST-PLAN D1/D2)', () => {
  const OUR_BLOCKHASH = '11111111111111111111111111111111';

  it('D1: send timeout but chain already Paid -> no second sendRawTransaction', async () => {
    const paidData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Paid, payer: payerKp.publicKey, paidAmount: 100n });
    let accountReads = 0;
    const sendRawTransaction = vi
      .fn()
      // First raw send: minified timeout (the tx actually landed).
      .mockRejectedValueOnce(new Error('Transaction was not confirmed in 30.00 seconds'));
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: OUR_BLOCKHASH, lastValidBlockHeight: 100 }),
      getBlockHeight: vi.fn().mockResolvedValue(90), // old blockhash still valid
      sendRawTransaction,
      confirmTransaction: vi.fn(),
      getAccountInfo: vi.fn().mockImplementation(async () => {
        // The account is Paid as soon as we refetch after timeout.
        accountReads++;
        return info(paidData);
      }),
    } as unknown as Connection;

    const client = new PaytruthClient({ connection: conn, wallet: wallet(payerKp), programId: PROGRAM_ID });
    const result = await client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n });
    expect(result.recovered).toBe(true);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1); // never resubmitted
    expect(accountReads).toBeGreaterThan(0);
  });

  it('D2: unlanded + blockhash expired -> exactly one rebuild+resign+resend', async () => {
    const openData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open });
    const paidData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Paid, payer: payerKp.publicKey, paidAmount: 100n });
    let accountReads = 0;
    let sendCount = 0;
    const sendRawTransaction = vi.fn().mockImplementation(async () => {
      sendCount++;
      if (sendCount === 1) throw new Error('Blockhash not found');
      return 'SIG2';
    });
    const confirmTransaction = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
      getLatestBlockhash: vi
        .fn()
        .mockResolvedValueOnce({ blockhash: OUR_BLOCKHASH, lastValidBlockHeight: 100 })
        .mockResolvedValue({ blockhash: OUR_BLOCKHASH, lastValidBlockHeight: 200 }),
      getBlockHeight: vi.fn().mockResolvedValue(150), // > 100 => expired
      sendRawTransaction,
      confirmTransaction,
      getAccountInfo: vi.fn().mockImplementation(async () => {
        accountReads++;
        // Before resubmit: still Open. After resubmit: Paid.
        return info(sendCount >= 2 ? paidData : openData);
      }),
    } as unknown as Connection;

    const client = new PaytruthClient({ connection: conn, wallet: wallet(payerKp), programId: PROGRAM_ID });
    const result = await client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n });
    expect(result.recovered).toBe(false);
    expect(result.signature).toBe('SIG2');
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
  });

  it('refuses to resubmit while the old blockhash is still valid (network error, unlanded)', async () => {
    const openData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open });
    const sendRawTransaction = vi.fn().mockRejectedValue(new Error('ECONNRESET network error'));
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: OUR_BLOCKHASH, lastValidBlockHeight: 100 }),
      getBlockHeight: vi.fn().mockResolvedValue(80), // still valid
      sendRawTransaction,
      confirmTransaction: vi.fn(),
      getAccountInfo: vi.fn().mockResolvedValue(info(openData)),
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, wallet: wallet(payerKp), programId: PROGRAM_ID });
    await expect(client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n })).rejects.toBeInstanceOf(TxTimeoutError);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1); // never resubmitted while blockhash valid
  });
});

describe('recovery uses the blockhash the wallet actually signed', () => {
  const OUR_BLOCKHASH = '11111111111111111111111111111111';
  const WALLET_BLOCKHASH = 'So11111111111111111111111111111111111111112';

  function connWith(args: {
    getAccountInfo: ReturnType<typeof vi.fn>;
    isBlockhashValid: () => boolean | Promise<boolean>;
    getBlockHeight?: number;
  }) {
    return {
      rpcEndpoint: 'http://localhost:8899',
      getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: OUR_BLOCKHASH, lastValidBlockHeight: 100 }),
      getBlockHeight: vi.fn().mockResolvedValue(args.getBlockHeight ?? 50),
      isBlockhashValid: vi.fn().mockImplementation(async () => ({
        context: { slot: 1 },
        value: await args.isBlockhashValid(),
      })),
      getSignatureStatuses: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: [null] }),
      sendRawTransaction: vi.fn(),
      confirmTransaction: vi.fn(),
      getAccountInfo: args.getAccountInfo,
    } as unknown as Connection;
  }

  it('changed blockhash + confirm timeout + chain already landed -> no resubmit (recovered)', async () => {
    const paidData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Paid, payer: payerKp.publicKey, paidAmount: 100n });
    const conn = connWith({
      getAccountInfo: vi.fn().mockResolvedValue(info(paidData)),
      isBlockhashValid: () => false,
    });
    const client = new PaytruthClient({ connection: conn, wallet: wallet(payerKp), programId: PROGRAM_ID });
    const timeout = new PaytruthError('confirm timeout') as PaytruthError & {
      signature?: string;
      attempt?: { signature: string; signedBlockhash: string; lastValidBlockHeight?: number };
    };
    timeout.signature = 'SIG';
    timeout.attempt = { signature: 'SIG', signedBlockhash: WALLET_BLOCKHASH };
    const result = await client.recoverAfterError(
      {
        build: async () => [],
        invoicePda,
        landed: (inv: Invoice | null) => inv !== null && inv.status === InvoiceStatus.Paid,
      },
      timeout,
    );
    expect(result?.recovered).toBe(true);
    expect(result?.signature).toBe('SIG');
    expect((conn as unknown as { sendRawTransaction: ReturnType<typeof vi.fn> }).sendRawTransaction).not.toHaveBeenCalled();
  });

  it('changed blockhash + not landed + wallet blockhash still valid -> no resubmit (TxTimeout)', async () => {
    const openData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open });
    const conn = connWith({
      getAccountInfo: vi.fn().mockResolvedValue(info(openData)),
      isBlockhashValid: () => true,
    });
    const client = new PaytruthClient({ connection: conn, wallet: wallet(payerKp), programId: PROGRAM_ID });
    const timeout = new PaytruthError('confirm timeout') as PaytruthError & {
      signature?: string;
      attempt?: { signature: string; signedBlockhash: string; lastValidBlockHeight?: number };
    };
    timeout.signature = 'SIG';
    timeout.attempt = { signature: 'SIG', signedBlockhash: WALLET_BLOCKHASH };
    await expect(
      client.recoverAfterError(
        {
          build: async () => [],
          invoicePda,
          landed: (inv: Invoice | null) => inv !== null && inv.status === InvoiceStatus.Paid,
        },
        timeout,
      ),
    ).rejects.toBeInstanceOf(TxTimeoutError);
    expect((conn as unknown as { sendRawTransaction: ReturnType<typeof vi.fn> }).sendRawTransaction).not.toHaveBeenCalled();
  });

  it('changed blockhash + not landed + wallet blockhash invalid -> exactly one resubmit', async () => {
    const openData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open });
    const paidData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Paid, payer: payerKp.publicKey, paidAmount: 100n });
    let sends = 0;
    const sendRawTransaction = vi.fn().mockImplementation(async () => {
      sends++;
      if (sends === 1) throw new Error('Transaction was not confirmed in 30.00 seconds');
      return 'SIG2';
    });
    // First attempt: the wallet refreshes the blockhash; second attempt: also refreshes
    // (so confirmation goes through confirmBySignatureStatus, which we make resolve).
    const walletRefreshing: PaytruthWallet = {
      publicKey: payerKp.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        (tx as Transaction).recentBlockhash = WALLET_BLOCKHASH;
        (tx as Transaction).partialSign(payerKp);
        return tx;
      },
    };
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: OUR_BLOCKHASH, lastValidBlockHeight: 100 }),
      getBlockHeight: vi.fn().mockResolvedValue(50),
      // Wallet's blockhash is invalid -> recovery is allowed to resubmit.
      isBlockhashValid: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: false }),
      // Confirmation of the second send resolves immediately.
      getSignatureStatuses: vi.fn().mockResolvedValue({
        context: { slot: 1 },
        value: [{ slot: 1, confirmations: 0, err: null, confirmationStatus: 'confirmed' }],
      }),
      sendRawTransaction,
      confirmTransaction: vi.fn(),
      getAccountInfo: vi.fn().mockImplementation(async () => info(sends >= 2 ? paidData : openData)),
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, wallet: walletRefreshing, programId: PROGRAM_ID });
    const result = await client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n });
    expect(result.recovered).toBe(false);
    expect(result.signature).toBe('SIG2');
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('real-IDL write and subscription behavior', () => {
  const conn = () => ({
    rpcEndpoint: 'http://localhost:8899',
    getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
    getBlockHeight: vi.fn().mockResolvedValue(90),
    confirmTransaction: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } }),
  });

  it('payInvoice signs the caller-supplied expectedAmountDue, not a refetched value', async () => {
    const openData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open, amountDue: 100n });
    let signedData: Buffer | undefined;
    const sendRawTransaction = vi.fn().mockImplementation(async (raw: Buffer) => {
      const tx = Transaction.from(raw);
      signedData = tx.instructions.find((i) => i.programId.equals(PROGRAM_ID))!.data;
      return 'SIG';
    });
    const c = {
      ...conn(),
      sendRawTransaction,
      getAccountInfo: vi.fn().mockResolvedValue(info(openData)),
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: c, wallet: wallet(payerKp), programId: PROGRAM_ID });
    await client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 777n });
    expect(signedData).toBeDefined();
    expect(signedData!.subarray(0, 8)).toEqual(
      Buffer.from(
        (await import('node:crypto')).createHash('sha256').update('global:pay_invoice').digest().subarray(0, 8),
      ),
    );
    expect(signedData!.readBigUInt64LE(16)).toBe(777n);
  });

  it('close recovers when the invoice account still exists with status Closed', async () => {
    const closedData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Closed });
    const sendRawTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error('Transaction was not confirmed in 30.00 seconds'));
    const c = {
      ...conn(),
      sendRawTransaction,
      getAccountInfo: vi.fn().mockResolvedValue(info(closedData)),
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: c, wallet: wallet(merchantKp), programId: PROGRAM_ID });
    const result = await client.closeInvoice({ invoicePda });
    expect(result.recovered).toBe(true);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('subscribeInvoice reports a Closed account, and null only when it truly disappears', async () => {
    const closedData = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Closed });
    let listener: ((info: { data: Buffer } | null) => void) | null = null;
    const c = {
      rpcEndpoint: 'http://localhost:8899',
      onAccountChange: vi.fn().mockImplementation((_pda: PublicKey, cb: (info: { data: Buffer } | null) => void) => {
        listener = cb;
        return 42;
      }),
      removeAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;
    const seen: (Invoice | null)[] = [];
    const client = new PaytruthClient({ connection: c, programId: PROGRAM_ID });
    client.subscribeInvoice(invoicePda, (i) => seen.push(i));
    listener!({ data: closedData });
    expect(seen[0]?.status).toBe(InvoiceStatus.Closed);
    listener!({ data: Buffer.alloc(0) });
    expect(seen[1]).toBeNull();
  });

  it('subscribeInvoice ignores malformed account data instead of reporting deletion', async () => {
    let listener: ((info: { data: Buffer } | null) => void) | null = null;
    const c = {
      rpcEndpoint: 'http://localhost:8899',
      onAccountChange: vi.fn().mockImplementation((_pda: PublicKey, cb: (info: { data: Buffer } | null) => void) => {
        listener = cb;
        return 43;
      }),
      removeAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;
    const seen: (Invoice | null)[] = [];
    const client = new PaytruthClient({ connection: c, programId: PROGRAM_ID });
    client.subscribeInvoice(invoicePda, (i) => seen.push(i));
    listener!({ data: Buffer.from([1, 2, 3]) });
    expect(seen).toEqual([]);
    listener!({ data: Buffer.alloc(0) });
    expect(seen).toEqual([null]);
  });
});

describe('waitForInvoiceState (TEST-PLAN D3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves only when the predicate holds at the requested commitment (Open then Paid)', async () => {
    const open = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open });
    const paid = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Paid, payer: payerKp.publicKey, paidAmount: 100n });
    let calls = 0;
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      getAccountInfo: vi.fn().mockImplementation(async () => {
        calls++;
        return info(calls < 3 ? open : paid);
      }),
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, programId: PROGRAM_ID });
    const inv = await client.waitForInvoiceState(invoicePda, (i) => i.status === InvoiceStatus.Paid, {
      commitment: 'confirmed',
      pollMs: 5,
      timeoutMs: 2000,
    });
    expect(inv.status).toBe(InvoiceStatus.Paid);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('rejects with TxTimeoutError on timeout', async () => {
    const open = await encodeInvoice({ invoiceId: 1n, status: InvoiceStatus.Open });
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      getAccountInfo: vi.fn().mockResolvedValue(info(open)),
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, programId: PROGRAM_ID });
    await expect(
      client.waitForInvoiceState(invoicePda, (i) => i.status === InvoiceStatus.Paid, {
        commitment: 'confirmed',
        pollMs: 5,
        timeoutMs: 40,
      }),
    ).rejects.toBeInstanceOf(TxTimeoutError);
  });
});

describe('PaytruthClient guards', () => {
  it('refuses a mainnet endpoint in the constructor', () => {
    const conn = { rpcEndpoint: 'https://api.mainnet-beta.solana.com' } as unknown as Connection;
    expect(() => new PaytruthClient({ connection: conn, programId: PROGRAM_ID })).toThrow(/mainnet/i);
  });

  it('write methods throw when no wallet is configured', async () => {
    const conn = { rpcEndpoint: 'http://localhost:8899' } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, programId: PROGRAM_ID });
    await expect(client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n })).rejects.toThrow();
  });

  it('exposes structural PDA helpers matching PaytruthSdk', () => {
    const conn = { rpcEndpoint: 'http://localhost:8899' } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, programId: PROGRAM_ID });
    const [pda] = client.getInvoicePda(merchantKp.publicKey, 1n);
    expect(pda.equals(invoicePda)).toBe(true);
  });

  it('subscribeInvoice returns an unsubscribe function', () => {
    const unsubscribe = vi.fn().mockResolvedValue(1);
    const conn = {
      rpcEndpoint: 'http://localhost:8899',
      onAccountChange: vi.fn().mockResolvedValue(42),
      removeAccountChangeListener: unsubscribe,
    } as unknown as Connection;
    const client = new PaytruthClient({ connection: conn, programId: PROGRAM_ID });
    const stop = client.subscribeInvoice(invoicePda, () => {});
    expect(typeof stop).toBe('function');
  });
});

// WalletNotSupportedError is exported and used by the react hook layer; sanity check it exists.
describe('errors surface', () => {
  it('WalletNotSupportedError is a distinct error type', () => {
    expect(new WalletNotSupportedError()).toBeInstanceOf(Error);
  });
});
