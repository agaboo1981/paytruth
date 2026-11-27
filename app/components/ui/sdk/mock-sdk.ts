import { PublicKey } from '@solana/web3.js';

import { fireSigned, fireStage, type WriteOptions } from '../../../lib/paytruth/send';
import { encodeBase58 } from './base58';
import { fixtureSpecs, MOCK_MINT, MOCK_PROGRAM, MOCK_WALLET } from './fixtures';
import {
  clearFailMode,
  readFailMode,
  readJson,
  resolveStorage,
  STORAGE_KEY,
  writeJson,
  type StorageLike,
} from './mock-config';
import {
  InvoiceStatus,
  type Commitment,
  type Config,
  type Invoice,
  type PaytruthSdk,
} from './types';

const MEMO_LEN = 64;

export class PaytruthProgramError extends Error {
  code: number;
  name: string;
  constructor(code: number, name: string) {
    super(`AnchorError occurred. Error Code: ${name}. Error Number: ${code}. custom program error: 0x${code.toString(16)}`);
    this.name = name;
    this.code = code;
  }
}

const ERROR_CODES = {
  Underpayment: 6000,
  DuplicatePayment: 6001,
  InvoiceNotOpen: 6002,
  InvoiceExpired: 6003,
  InvoiceNotPaid: 6004,
  AlreadyClaimed: 6005,
  AlreadyRefunded: 6006,
  NothingToRefund: 6007,
  NotExpired: 6008,
  InvalidAmount: 6009,
  InvalidExpiry: 6010,
  VaultNotEmpty: 6016,
  InvoiceNotTerminal: 6017,
  ExcessOutstanding: 6018,
  NothingToRecover: 6019,
  PayerNotRecorded: 6020,
  UnauthorizedMerchant: 6013,
  InvoiceMismatch: 6022,
} as const;

type ErrorName = keyof typeof ERROR_CODES;

function programError(name: ErrorName): PaytruthProgramError {
  return new PaytruthProgramError(ERROR_CODES[name], name);
}

type StoredInvoice = {
  pda: string;
  merchant: string;
  payer: string;
  mint: string;
  invoiceId: string;
  amountDue: string;
  paidAmount: string;
  refundedExcess: string;
  createdAt: string;
  expiresAt: string;
  status: number;
  claimed: boolean;
  bump: number;
  memo: string;
  vault: string;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function hexBump(seed: string): number {
  return Number.parseInt(seed.slice(-2), 16) % 251 + 1;
}

function encodeMemo(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (bytes.length > MEMO_LEN) {
    throw new Error(`Memo is ${bytes.length} bytes; the maximum is ${MEMO_LEN} bytes.`);
  }
  const padded = new Uint8Array(MEMO_LEN);
  padded.set(bytes);
  return encodeBase58(padded);
}

function toInvoice(stored: StoredInvoice): Invoice {
  const memoBytes = new Uint8Array(MEMO_LEN);
  memoBytes.set(decodeBase58(stored.memo));
  return {
    merchant: new PublicKey(stored.merchant),
    payer: new PublicKey(stored.payer),
    mint: new PublicKey(stored.mint),
    invoiceId: BigInt(stored.invoiceId),
    amountDue: BigInt(stored.amountDue),
    paidAmount: BigInt(stored.paidAmount),
    refundedExcess: BigInt(stored.refundedExcess),
    createdAt: BigInt(stored.createdAt),
    expiresAt: BigInt(stored.expiresAt),
    status: stored.status as InvoiceStatus,
    claimed: stored.claimed,
    bump: stored.bump,
    memo: memoBytes,
  };
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i += 1) BASE58_INDEX[BASE58_ALPHABET[i]] = i;

function decodeBase58(input: string): Uint8Array {
  let value = 0n;
  for (const char of input) {
    const digit = BASE58_INDEX[char];
    if (digit === undefined) throw new Error('Invalid base58 character');
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of input) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

function fakeSignature(): string {
  const bytes = new Uint8Array(64);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return encodeBase58(bytes);
}

function fixtureToStored(label: keyof typeof fixtureSpecs, now: number): StoredInvoice {
  const spec = fixtureSpecs[label];
  const paidAmount = spec.paidAmount ?? 0n;
  return {
    pda: spec.pda,
    merchant: MOCK_WALLET.toBase58(),
    payer: (spec.payer ?? PublicKey.default).toBase58(),
    mint: MOCK_MINT.toBase58(),
    invoiceId: spec.invoiceId.toString(),
    amountDue: spec.amountDue.toString(),
    paidAmount: paidAmount.toString(),
    refundedExcess: (spec.refundedExcess ?? 0n).toString(),
    createdAt: spec.createdAt.toString(),
    expiresAt: (BigInt(now) + BigInt(spec.expiresOffsetSec)).toString(),
    status: spec.status,
    claimed: Boolean(spec.claimed),
    bump: hexBump(spec.pda),
    memo: encodeMemo(spec.memo),
    vault: (
      paidAmount -
      (spec.claimed ? spec.amountDue : 0n) -
      (spec.refundedExcess ?? 0n)
    ).toString(),
  };
}

export type MockSdkOptions = {
  storage?: StorageLike | null;
  stageDelayMs?: number;
};

export class MockPaytruthSdk implements PaytruthSdk {
  private storage: StorageLike | null;
  private listeners = new Map<string, Set<(inv: Invoice | null) => void>>();
  private seeded = false;
  private stageDelayMs: number;

  constructor(options: MockSdkOptions = {}) {
    this.storage = options.storage === undefined ? resolveStorage() : options.storage;
    this.stageDelayMs = options.stageDelayMs ?? 600;
    this.ensureSeed();
  }

  setStorage(storage: StorageLike | null): void {
    this.storage = storage;
    this.seeded = false;
    this.ensureSeed();
  }

  private ensureSeed(): void {
    if (this.seeded) return;
    this.seeded = true;
    const snapshot = readJson<{ invoices: Record<string, StoredInvoice> }>(this.storage, STORAGE_KEY);
    if (snapshot?.invoices && Object.keys(snapshot.invoices).length > 0) return;
    const invoices: Record<string, StoredInvoice> = {};
    const now = nowSec();
    for (const label of Object.keys(fixtureSpecs) as (keyof typeof fixtureSpecs)[]) {
      const stored = fixtureToStored(label, now);
      invoices[stored.pda] = stored;
    }
    writeJson(this.storage, STORAGE_KEY, { invoices });
  }

  private load(): Record<string, StoredInvoice> {
    this.ensureSeed();
    const snapshot = readJson<{ invoices: Record<string, StoredInvoice> }>(this.storage, STORAGE_KEY);
    return snapshot?.invoices ?? {};
  }

  private save(invoices: Record<string, StoredInvoice>): void {
    writeJson(this.storage, STORAGE_KEY, { invoices });
  }

  private emit(pda: string): void {
    const record = this.load()[pda];
    const invoice = record ? toInvoice(record) : null;
    const set = this.listeners.get(pda);
    if (set) for (const cb of set) cb(invoice);
  }

  private async stageDelay(): Promise<void> {
    if (this.stageDelayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.stageDelayMs));
  }

  private async runWrite<T>(opts: WriteOptions | undefined, mutate: (signature: string) => T): Promise<T> {
    const signature = fakeSignature();
    fireStage(opts, 'awaiting-signature');
    await this.stageDelay();

    const fail = readFailMode(this.storage);
    if (fail) clearFailMode(this.storage);
    if (fail === 'reject') throw new Error('WalletSignTransactionError: User rejected the request.');

    fireStage(opts, 'signed');
    fireSigned(opts, signature);
    if (fail === 'error') throw new Error('Simulation failed. custom program error: 0x1771');

    fireStage(opts, 'sent', { signature });
    if (fail === 'expire') {
      throw new Error('TransactionExpiredBlockheightExceededError: block height exceeded');
    }

    await this.stageDelay();
    const result = mutate(signature);
    fireStage(opts, 'confirmed', { signature });
    return result;
  }

  getInvoicePda(merchant: PublicKey, invoiceId: bigint): [PublicKey, number] {
    const [address, bump] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('invoice'), merchant.toBuffer(), u64le(invoiceId)],
      MOCK_PROGRAM,
    );
    return [address, bump];
  }

  getConfigPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([new TextEncoder().encode('config')], MOCK_PROGRAM);
  }

  getEscrowAta(invoicePda: PublicKey): PublicKey {
    const [address] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('escrow'), invoicePda.toBuffer()],
      MOCK_PROGRAM,
    );
    return address;
  }

  async fetchConfig(): Promise<Config> {
    return {
      authority: MOCK_WALLET,
      usdcMint: MOCK_MINT,
      bump: hexBump('config'),
    };
  }

  async fetchInvoice(invoicePda: PublicKey): Promise<Invoice> {
    const record = this.load()[invoicePda.toBase58()];
    if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
    return toInvoice(record);
  }

  async fetchInvoiceByMerchantAndId(merchant: PublicKey, invoiceId: bigint): Promise<Invoice> {
    const [pda] = this.getInvoicePda(merchant, invoiceId);
    return this.fetchInvoice(pda);
  }

  async fetchEscrowBalance(invoicePda: PublicKey): Promise<bigint> {
    const record = this.load()[invoicePda.toBase58()];
    if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
    return BigInt(record.vault);
  }

  async initializeConfig(
    _args?: unknown,
    opts?: WriteOptions,
  ): Promise<{ signature: string; configPda: PublicKey }> {
    return this.runWrite(opts, (signature) => ({
      signature,
      configPda: this.getConfigPda()[0],
    }));
  }

  async createInvoice(
    args: {
      invoiceId: bigint;
      amountDue: bigint;
      expiresAt: bigint;
      memo: string | Uint8Array;
    },
    opts?: WriteOptions,
  ): Promise<{ signature: string; invoicePda: PublicKey }> {
    return this.runWrite(opts, (signature) => {
      if (args.amountDue <= 0n) throw programError('InvalidAmount');
      if (args.expiresAt <= BigInt(nowSec())) throw programError('InvalidExpiry');
      const memo = encodeMemo(args.memo);

      const [pda] = this.getInvoicePda(MOCK_WALLET, args.invoiceId);
      const invoices = this.load();
      if (invoices[pda.toBase58()]) {
        throw new Error('Allocate: account Address already in use. Anchor seeds constraint failed.');
      }
      const stored: StoredInvoice = {
        pda: pda.toBase58(),
        merchant: MOCK_WALLET.toBase58(),
        payer: PublicKey.default.toBase58(),
        mint: MOCK_MINT.toBase58(),
        invoiceId: args.invoiceId.toString(),
        amountDue: args.amountDue.toString(),
        paidAmount: '0',
        refundedExcess: '0',
        createdAt: nowSec().toString(),
        expiresAt: args.expiresAt.toString(),
        status: InvoiceStatus.Open,
        claimed: false,
        bump: hexBump(pda.toBase58()),
        memo,
        vault: '0',
      };
      invoices[pda.toBase58()] = stored;
      this.save(invoices);
      this.emit(pda.toBase58());
      return { signature, invoicePda: pda };
    });
  }

  private assertMerchant(record: StoredInvoice): void {
    if (record.merchant !== MOCK_WALLET.toBase58()) throw programError('UnauthorizedMerchant');
  }

  async payInvoice(
    args: { invoicePda: PublicKey; amount: bigint; expectedAmountDue?: bigint },
    opts?: WriteOptions,
  ): Promise<{ signature: string }> {
    return this.runWrite(opts, (signature) => {
      const invoices = this.load();
      const key = args.invoicePda.toBase58();
      const record = invoices[key];
      if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
      if (record.status !== InvoiceStatus.Open) throw programError('DuplicatePayment');
      if (BigInt(nowSec()) >= BigInt(record.expiresAt)) throw programError('InvoiceExpired');
      if (args.amount <= 0n) throw programError('InvalidAmount');
      if (args.amount < BigInt(record.amountDue)) throw programError('Underpayment');
      if (args.expectedAmountDue !== undefined && args.expectedAmountDue !== BigInt(record.amountDue)) {
        throw programError('InvoiceMismatch');
      }

      record.payer = MOCK_WALLET.toBase58();
      record.paidAmount = args.amount.toString();
      record.status = InvoiceStatus.Paid;
      record.vault = (BigInt(record.vault) + args.amount).toString();
      this.save(invoices);
      this.emit(key);
      return { signature };
    });
  }

  async merchantClaim(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string }> {
    return this.runWrite(opts, (signature) => {
      const invoices = this.load();
      const key = args.invoicePda.toBase58();
      const record = invoices[key];
      if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
      this.assertMerchant(record);
      if (record.status !== InvoiceStatus.Paid) throw programError('InvoiceNotPaid');
      if (record.claimed) throw programError('AlreadyClaimed');

      record.claimed = true;
      const amountDue = BigInt(record.amountDue);
      record.vault = (BigInt(record.vault) - amountDue).toString();
      this.save(invoices);
      this.emit(key);
      return { signature };
    });
  }

  async refundOverpayment(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string }> {
    return this.runWrite(opts, (signature) => {
      const invoices = this.load();
      const key = args.invoicePda.toBase58();
      const record = invoices[key];
      if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
      if (record.status !== InvoiceStatus.Paid) throw programError('InvoiceNotPaid');
      if (record.payer === PublicKey.default.toBase58()) throw programError('PayerNotRecorded');
      const paid = BigInt(record.paidAmount);
      const due = BigInt(record.amountDue);
      if (paid <= due) throw programError('NothingToRefund');
      if (BigInt(record.refundedExcess) !== 0n) throw programError('AlreadyRefunded');
      const excess = paid - due;
      record.refundedExcess = excess.toString();
      record.vault = (BigInt(record.vault) - excess).toString();
      this.save(invoices);
      this.emit(key);
      return { signature };
    });
  }

  async expireInvoice(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string }> {
    return this.runWrite(opts, (signature) => {
      const invoices = this.load();
      const key = args.invoicePda.toBase58();
      const record = invoices[key];
      if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
      if (record.status !== InvoiceStatus.Open) throw programError('InvoiceNotOpen');
      if (BigInt(nowSec()) < BigInt(record.expiresAt)) throw programError('NotExpired');
      record.status = InvoiceStatus.Expired;
      this.save(invoices);
      this.emit(key);
      return { signature };
    });
  }

  private assertTerminal(record: StoredInvoice): void {
    if (record.status === InvoiceStatus.Expired || record.status === InvoiceStatus.Closed) return;
    const excess = BigInt(record.paidAmount) - BigInt(record.amountDue);
    if (record.status === InvoiceStatus.Paid && record.claimed) {
      if (excess > 0n && BigInt(record.refundedExcess) !== excess) throw programError('ExcessOutstanding');
      return;
    }
    throw programError('InvoiceNotTerminal');
  }

  async recoverUnattributed(
    args: {
      invoicePda: PublicKey;
      destinationAta: PublicKey;
    },
    opts?: WriteOptions,
  ): Promise<{ signature: string }> {
    return this.runWrite(opts, (signature) => {
      const invoices = this.load();
      const key = args.invoicePda.toBase58();
      const record = invoices[key];
      if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
      this.assertMerchant(record);
      this.assertTerminal(record);
      if (BigInt(record.vault) <= 0n) throw programError('NothingToRecover');
      record.vault = '0';
      this.save(invoices);
      this.emit(key);
      return { signature };
    });
  }

  async closeInvoice(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string }> {
    return this.runWrite(opts, (signature) => {
      const invoices = this.load();
      const key = args.invoicePda.toBase58();
      const record = invoices[key];
      if (!record) throw new Error('Account does not exist or has no data: invoice not found.');
      this.assertMerchant(record);
      this.assertTerminal(record);
      if (BigInt(record.vault) !== 0n) throw programError('VaultNotEmpty');
      delete invoices[key];
      this.save(invoices);
      this.emit(key);
      return { signature };
    });
  }

  async waitForInvoiceState(
    invoicePda: PublicKey,
    predicate: (inv: Invoice) => boolean,
    opts: { commitment?: Commitment; timeoutMs?: number } = {},
  ): Promise<Invoice> {
    const timeoutMs = opts.timeoutMs ?? 60000;
    const start = Date.now();
    for (;;) {
      try {
        const invoice = await this.fetchInvoice(invoicePda);
        if (predicate(invoice)) return invoice;
      } catch {
        /* account may be closed; keep polling until timeout */
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for the invoice to reach the expected state.');
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  subscribeInvoice(invoicePda: PublicKey, cb: (inv: Invoice | null) => void): () => void {
    const key = invoicePda.toBase58();
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(cb);
    // Mirror the real SDK (connection.onAccountChange): only fire on changes, never on subscribe.
    // An initial callback here makes useInvoice re-subscribe in a loop.
    return () => {
      set?.delete(cb);
    };
  }

  reset(): void {
    this.save({});
    this.seeded = false;
    this.ensureSeed();
  }
}

export const mockSdk = new MockPaytruthSdk();
