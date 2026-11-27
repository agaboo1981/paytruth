import { BorshAccountsCoder, BN } from '@anchor-lang/core';
import { Keypair, PublicKey, SendTransactionError, Transaction, VersionedTransaction, type Connection } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { PaytruthClient } from '../../src/client';
import { PAYTRUTH_IDL } from '../../src/idl';
import { getInvoicePda } from '../../src/pda';
import { InvoiceStatus, type Invoice } from '../../src/types';
import {
  FeePayerUnfundedError,
  InvoiceClosedError,
  InvoiceExpiredError,
  mapError,
} from '../../src/errors';
import * as pub from '../../src/index';
import type { PaytruthWallet } from '../../src/send';

const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const coder = new BorshAccountsCoder(PAYTRUTH_IDL as never);
const merchantKp = Keypair.generate();
const payerKp = Keypair.generate();
const [invoicePda] = getInvoicePda(merchantKp.publicKey, 1n, PROGRAM_ID);

async function encodeInvoice(o: Partial<Invoice>): Promise<Buffer> {
  return (await coder.encode('Invoice', {
    merchant: merchantKp.publicKey,
    payer: o.payer ?? PublicKey.default,
    mint,
    invoice_id: new BN(1),
    amount_due: new BN(100),
    paid_amount: new BN((o.paidAmount ?? 0n).toString()),
    refunded_excess: new BN(0),
    created_at: new BN(0),
    expires_at: new BN(9_999_999_999),
    status: o.status ?? 0,
    claimed: false,
    bump: 255,
    memo: new Uint8Array(64),
  })) as Buffer;
}
const info = (data: Buffer) => ({ data, executable: false, lamports: 1_000_000, owner: PROGRAM_ID, rentEpoch: 0 });
function wallet(kp: Keypair, signSpy = vi.fn()): PaytruthWallet {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      signSpy();
      (tx as Transaction).partialSign(kp);
      return tx;
    },
  };
}
function baseConn(extra: Record<string, unknown>): Connection {
  return {
    rpcEndpoint: 'http://localhost:8899',
    getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
    getBlockHeight: vi.fn().mockResolvedValue(90),
    confirmTransaction: vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } }),
    ...extra,
  } as unknown as Connection;
}

describe('mapError: unfunded fee payer', () => {
  const MSG = 'Transaction simulation failed: This account may not be used to pay transaction fees';

  it('maps the plain RPC message to FeePayerUnfunded', () => {
    const m = mapError(new Error(MSG));
    expect(m.name).toBe('FeePayerUnfunded');
    expect(m.kind).toBe('rpc');
    expect(m.retryable).toBe(false);
    expect(m.message).toMatch(/needs (a little )?SOL/i);
  });

  it('maps a SendTransactionError with that message', () => {
    const err = new SendTransactionError({ action: 'simulate', signature: '', transactionMessage: MSG, logs: [] });
    expect(mapError(err).name).toBe('FeePayerUnfunded');
  });

  it('maps the structured InvalidAccountForFee transaction error', () => {
    expect(mapError({ err: 'InvalidAccountForFee' }).name).toBe('FeePayerUnfunded');
  });

  it('FeePayerUnfundedError round-trips through mapError', () => {
    const e = new FeePayerUnfundedError();
    expect(e).toBeInstanceOf(Error);
    expect(mapError(e).name).toBe('FeePayerUnfunded');
  });
});

describe('payInvoice preflight on a non-Open invoice', () => {
  it('Closed invoice -> InvoiceClosedError before signing or sending', async () => {
    const data = await encodeInvoice({ status: InvoiceStatus.Closed });
    const sendRawTransaction = vi.fn();
    const sign = vi.fn();
    const c = baseConn({ sendRawTransaction, getAccountInfo: vi.fn().mockResolvedValue(info(data)) });
    const client = new PaytruthClient({ connection: c, wallet: wallet(payerKp, sign), programId: PROGRAM_ID });
    const p = client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n });
    await expect(p).rejects.toBeInstanceOf(InvoiceClosedError);
    await expect(p).rejects.not.toThrow(/already paid/i);
    expect(sign).not.toHaveBeenCalled();
    expect(sendRawTransaction).not.toHaveBeenCalled();
    const mapped = mapError(await p.catch((e) => e));
    expect(mapped.name).toBe('InvoiceClosed');
  });

  it('Expired invoice -> InvoiceExpiredError before signing', async () => {
    const data = await encodeInvoice({ status: InvoiceStatus.Expired });
    const sign = vi.fn();
    const c = baseConn({ sendRawTransaction: vi.fn(), getAccountInfo: vi.fn().mockResolvedValue(info(data)) });
    const client = new PaytruthClient({ connection: c, wallet: wallet(payerKp, sign), programId: PROGRAM_ID });
    const err = await client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n }).catch((e) => e);
    expect(err).toBeInstanceOf(InvoiceExpiredError);
    expect(mapError(err).name).toBe('InvoiceExpired');
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('payInvoice disambiguates an on-chain DuplicatePayment', () => {
  const dupErr = () =>
    Object.assign(new Error('failed to send transaction: custom program error: 0x1771'), {
      logs: ['Program log: AnchorError occurred. Error Code: DuplicatePayment. Error Number: 6001.'],
    });

  async function run(statusAfter: InvoiceStatus) {
    const open = await encodeInvoice({ status: InvoiceStatus.Open });
    const after = await encodeInvoice({ status: statusAfter, payer: payerKp.publicKey, paidAmount: 100n });
    let reads = 0;
    const c = baseConn({
      sendRawTransaction: vi.fn().mockRejectedValue(dupErr()),
      getAccountInfo: vi.fn().mockImplementation(async () => (reads++ === 0 ? info(open) : info(after))),
    });
    const client = new PaytruthClient({ connection: c, wallet: wallet(Keypair.generate()), programId: PROGRAM_ID });
    return client.payInvoice({ invoicePda, amount: 100n, expectedAmountDue: 100n }).catch((e) => e);
  }

  it('status Closed at error time -> InvoiceClosed, not DuplicatePayment', async () => {
    const err = await run(InvoiceStatus.Closed);
    expect(err).toBeInstanceOf(InvoiceClosedError);
  });

  it('status Expired at error time -> InvoiceExpired', async () => {
    const err = await run(InvoiceStatus.Expired);
    expect(err).toBeInstanceOf(InvoiceExpiredError);
  });

  it('status Paid at error time -> stays DuplicatePayment', async () => {
    const err = await run(InvoiceStatus.Paid);
    expect(mapError(err).name).toBe('DuplicatePayment');
  });
});

describe('public exports', () => {
  it('exports the new typed errors from the package index', () => {
    expect(pub.FeePayerUnfundedError).toBe(FeePayerUnfundedError);
    expect(pub.InvoiceClosedError).toBe(InvoiceClosedError);
    expect(pub.InvoiceExpiredError).toBe(InvoiceExpiredError);
  });
});
