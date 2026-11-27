// GENERATED from sdk/src by `pnpm sync:app` — do not edit here.
import { PublicKey, type Commitment as Web3Commitment, type Connection } from '@solana/web3.js';
import {
  decodeInvoice,
  fetchConfig as fetchConfigFn,
  fetchEscrowBalance as fetchEscrowBalanceFn,
  fetchInvoice as fetchInvoiceFn,
  fetchInvoiceByMerchantAndId as fetchInvoiceByMerchantAndIdFn,
  fetchInvoiceOrNull as fetchInvoiceOrNullFn,
} from './accounts';
import { MAINNET_BETA_GENESIS_HASH } from './constants';
import {
  InvoiceClosedError,
  InvoiceExpiredError,
  MainnetRefusedError,
  PaytruthError,
  TxTimeoutError,
  mapError,
} from './errors';
import {
  buildCloseInvoiceIx,
  buildCreateInvoiceIx,
  buildExpireInvoiceIx,
  buildInitializeConfigIx,
  buildMerchantClaimIx,
  buildPayInvoiceIx,
  buildRecoverUnattributedIx,
  buildRefundOverpaymentIx,
} from './instructions';
import { encodeMemo } from './memo';
import { getConfigPda, getEscrowAta, getInvoicePda } from './pda';
import { resolveProgramId } from './program';
import { signAndSend, fireStage, type PaytruthWallet, type SendAttempt, type WriteOptions } from './send';
import type { Commitment, Config, Invoice, PaytruthSdk } from './types';
import { InvoiceStatus } from './types';

export interface PaytruthClientOptions {
  connection: Connection;
  wallet?: PaytruthWallet;
  programId?: PublicKey;
  commitment?: Commitment;
}

export interface WriteResult {
  signature: string;
  recovered: boolean;
}

interface WriteWithRecoveryArgs {
  build: () => Promise<import('@solana/web3.js').TransactionInstruction[]>;
  landed: (inv: Invoice | null) => boolean | Promise<boolean>;
  invoicePda: PublicKey;
  maxAttempts?: number;
  write?: WriteOptions;
}

export interface WaitForInvoiceStateOptions {
  commitment?: Commitment;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Refuse to run against mainnet-beta based on the connection's rpcEndpoint.
 */
export function assertNotMainnet(connection: Connection): void {
  const endpoint = (connection?.rpcEndpoint ?? '').toLowerCase();
  if (endpoint.includes('mainnet')) {
    throw new MainnetRefusedError(`Refusing to use a mainnet endpoint: ${connection.rpcEndpoint}`);
  }
}

/**
 * Refuse to run against mainnet-beta based on the genesis hash (async, robust
 * against misleading endpoints).
 */
export async function assertNotMainnetGenesis(connection: Connection): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis === MAINNET_BETA_GENESIS_HASH) {
    throw new MainnetRefusedError('Refusing to run against mainnet-beta (genesis hash matched).');
  }
}

export class PaytruthClient implements PaytruthSdk {
  readonly connection: Connection;
  readonly wallet?: PaytruthWallet;
  readonly programId: PublicKey;
  readonly commitment: Commitment;

  constructor(opts: PaytruthClientOptions) {
    if (!opts.connection) throw new PaytruthError('A connection is required.');
    assertNotMainnet(opts.connection);
    this.connection = opts.connection;
    this.wallet = opts.wallet;
    this.programId = opts.programId ?? resolveProgramId();
    this.commitment = opts.commitment ?? 'confirmed';
  }

  // ----- PDA derivation -----------------------------------------------------

  getInvoicePda(merchant: PublicKey, invoiceId: bigint): [PublicKey, number] {
    return getInvoicePda(merchant, invoiceId, this.programId);
  }

  getConfigPda(): [PublicKey, number] {
    return getConfigPda(this.programId);
  }

  getEscrowAta(invoicePda: PublicKey, mint: PublicKey): PublicKey {
    return getEscrowAta(invoicePda, mint);
  }

  // ----- Reads --------------------------------------------------------------

  fetchConfig(commitment?: Commitment): Promise<Config> {
    return fetchConfigFn(this.connection, commitment ?? this.commitment, this.programId);
  }

  fetchInvoice(invoicePda: PublicKey, commitment?: Commitment): Promise<Invoice> {
    return fetchInvoiceFn(this.connection, invoicePda, commitment ?? this.commitment, this.programId);
  }

  fetchInvoiceByMerchantAndId(merchant: PublicKey, invoiceId: bigint, commitment?: Commitment): Promise<Invoice> {
    return fetchInvoiceByMerchantAndIdFn(
      this.connection,
      merchant,
      invoiceId,
      commitment ?? this.commitment,
      this.programId,
    );
  }

  fetchEscrowBalance(invoicePda: PublicKey, mint: PublicKey): Promise<bigint> {
    return fetchEscrowBalanceFn(this.connection, invoicePda, mint, this.commitment, this.programId);
  }

  private fetchInvoiceOrNullAt(invoicePda: PublicKey, commitment: Commitment): Promise<Invoice | null> {
    return fetchInvoiceOrNullFn(this.connection, invoicePda, commitment, this.programId);
  }

  // ----- Writes -------------------------------------------------------------

  private requireWallet(): PaytruthWallet {
    if (!this.wallet) {
      throw new PaytruthError('No wallet is connected. Write methods require a connected wallet.');
    }
    return this.wallet;
  }

  /**
   * Send a set of instructions with idempotent recovery (TEST-PLAN D1-D2).
   * On a send timeout / blockhash-exceeded / network error, refetch the invoice
   * at confirmed then finalized; if the landed predicate is true, return the
   * last signature without resubmitting. Only rebuild+resend once the chain
   * shows it did not land AND the blockhash the wallet actually signed has
   * expired.
   */
  async writeWithRecovery(args: WriteWithRecoveryArgs): Promise<WriteResult> {
    const wallet = this.requireWallet();
    const maxAttempts = args.maxAttempts ?? 2;
    let lastSignature: string | null = null;
    let lastBlockhash: string | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const instructions = await args.build();

      // signAndSend records the signature + the blockhash the wallet actually
      // signed into this object as soon as it is known (before the send).
      const info: SendAttempt = { signature: '', signedBlockhash: '' };

      try {
        const sig = await signAndSend(this.connection, wallet, instructions, {
          commitment: this.commitment,
          write: args.write,
          attempt: info,
        });
        return { signature: sig, recovered: false };
      } catch (err) {
        const recovered = await this.recoverAfterError(args, err, info);
        if (recovered) return recovered;
        // recoverAfterError signals "resubmit" by returning null.
        lastSignature = signatureOf(err) ?? info.signature ?? lastSignature;
        lastBlockhash = info.signedBlockhash || lastBlockhash;
        // fall through to rebuild + resend on the next loop iteration.
      }
    }

    // Exhausted attempts: do one last landed check before failing.
    const landed = await this.safeLanded(args, 'confirmed');
    if (landed) {
      fireStage(args.write, 'confirmed', { signature: lastSignature ?? '' });
      return { signature: lastSignature ?? '', recovered: true };
    }
    throw new TxTimeoutError(
      `Transaction did not land after ${maxAttempts} attempts${lastBlockhash ? ` (last blockhash ${lastBlockhash})` : ''}.`,
    );
  }

  /**
   * Decide whether to recover (return a WriteResult) or resubmit (return null)
   * after a signAndSend error. Throws TxTimeoutError when the chain shows the
   * transaction did not land but the signed blockhash may still be valid.
   *
   * Exposes the blockhash-expiry decision against `attempt.signedBlockhash` —
   * the blockhash the wallet actually signed — never a pre-send fetch of ours.
   */
  async recoverAfterError(
    args: WriteWithRecoveryArgs,
    err: unknown,
    attempt?: SendAttempt,
  ): Promise<WriteResult | null> {
    const mapped = mapError(err);
    const retryable = mapped.retryable || isTimeoutLike(mapped) || mapped.kind === 'rpc';
    if (!retryable) throw toError(err);

    // The attempt object carried on the error (filled by signAndSend) is the
    // authoritative record of what was signed.
    const attemptInfo: SendAttempt | undefined =
      attempt ?? (err as { attempt?: SendAttempt } | null)?.attempt;
    const recoveredSignature = signatureOf(err) ?? attemptInfo?.signature ?? '';

    // Refetch the account at confirmed, then finalized, before any resubmit.
    const landedConfirmed = await this.safeLanded(args, 'confirmed');
    if (landedConfirmed) {
      fireStage(args.write, 'confirmed', { signature: recoveredSignature });
      return { signature: recoveredSignature, recovered: true };
    }
    const landedFinalized = await this.safeLanded(args, 'finalized');
    if (landedFinalized) {
      fireStage(args.write, 'confirmed', { signature: recoveredSignature });
      return { signature: recoveredSignature, recovered: true };
    }

    // Not landed. Only resubmit if the blockhash the wallet ACTUALLY signed is
    // definitively expired.
    const signedBlockhash = attemptInfo?.signedBlockhash;
    if (!signedBlockhash) {
      // No record of what was signed (e.g. the wallet rejected before signing):
      // be conservative and never resubmit.
      throw new TxTimeoutError(
        'The transaction did not confirm yet and the signed blockhash is unknown; not resubmitting.',
      );
    }

    const expired = await this.isSignedBlockhashExpired(attemptInfo!);
    if (!expired) {
      // Never resubmit while the signed blockhash may still be valid.
      throw new TxTimeoutError(
        'The transaction did not confirm yet and the blockhash is still valid; not resubmitting.',
      );
    }
    return null;
  }

  /**
   * Whether the signed blockhash is expired. If the wallet kept our blockhash,
   * compare block height to our lastValidBlockHeight; otherwise ask the cluster
   * via isBlockhashValid (RPC error => treat as NOT expired).
   */
  private async isSignedBlockhashExpired(attempt: SendAttempt): Promise<boolean> {
    if (attempt.lastValidBlockHeight !== undefined) {
      const height = await this.connection
        .getBlockHeight('confirmed')
        .catch(() => attempt.lastValidBlockHeight!);
      return height > attempt.lastValidBlockHeight;
    }
    try {
      const res = await this.connection.isBlockhashValid(attempt.signedBlockhash, { commitment: 'confirmed' });
      return !res.value;
    } catch {
      return false; // RPC error => do not resubmit
    }
  }

  private async safeLanded(args: WriteWithRecoveryArgs, commitment: Commitment): Promise<boolean> {
    try {
      const inv = await this.fetchInvoiceOrNullAt(args.invoicePda, commitment);
      return await args.landed(inv);
    } catch {
      return false;
    }
  }

  async initializeConfig(
    args: { usdcMint: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string; configPda: PublicKey }> {
    const wallet = this.requireWallet();
    const [configPda] = this.getConfigPda();
    const instructions = [
      await buildInitializeConfigIx(
        { authority: wallet.publicKey, usdcMint: args.usdcMint },
        this.programId,
        this.connection,
      ),
    ];
    const result = await this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: configPda,
      landed: (inv) => inv !== null,
      write: opts,
    });
    return { signature: result.signature, configPda };
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
    const wallet = this.requireWallet();
    const memo = encodeMemo(args.memo);
    const config = await this.fetchConfig('confirmed');
    const [invoicePda] = this.getInvoicePda(wallet.publicKey, args.invoiceId);
    const instructions = [
      await buildCreateInvoiceIx(
        {
          merchant: wallet.publicKey,
          invoiceId: args.invoiceId,
          amountDue: args.amountDue,
          expiresAt: args.expiresAt,
          mint: config.usdcMint,
          memo,
        },
        this.programId,
        this.connection,
      ),
    ];
    const result = await this.writeWithRecovery({
      build: async () => instructions,
      invoicePda,
      landed: (inv) =>
        inv !== null && inv.merchant.equals(wallet.publicKey) && inv.invoiceId === args.invoiceId,
      write: opts,
    });
    return { signature: result.signature, invoicePda };
  }

  async payInvoice(
    args: { invoicePda: PublicKey; amount: bigint; expectedAmountDue: bigint },
    opts?: WriteOptions,
  ): Promise<{ signature: string; recovered: boolean }> {
    const wallet = this.requireWallet();
    const invoice = await this.fetchInvoice(args.invoicePda, 'confirmed');
    // Preflight: never ask the wallet to sign a payment the program will reject
    // for a terminal status, and never let a Closed/Expired invoice surface as
    // "already paid" (the program maps every non-Open status to DuplicatePayment).
    const pdaStr = args.invoicePda.toBase58();
    if (invoice.status === InvoiceStatus.Closed) throw new InvoiceClosedError(pdaStr);
    if (invoice.status === InvoiceStatus.Expired) throw new InvoiceExpiredError(pdaStr);
    const instructions = [
      await buildPayInvoiceIx(
        {
          payer: wallet.publicKey,
          invoicePda: args.invoicePda,
          mint: invoice.mint,
          amount: args.amount,
          expectedAmountDue: args.expectedAmountDue,
        },
        this.programId,
        this.connection,
      ),
    ];
    try {
      return await this.writeWithRecovery({
        build: async () => instructions,
        invoicePda: args.invoicePda,
        landed: (inv) => inv !== null && inv.status === InvoiceStatus.Paid && inv.payer.equals(wallet.publicKey),
        write: opts,
      });
    } catch (err) {
      throw await this.disambiguatePayError(args.invoicePda, err);
    }
  }

  /**
   * The program reports DuplicatePayment for ANY non-Open status, and a pay on a
   * Closed invoice whose escrow ATA is gone fails with AccountNotInitialized.
   * Re-read the Invoice account (status source of truth) and return a precise
   * error when it is Closed or Expired; otherwise return the original error.
   */
  private async disambiguatePayError(invoicePda: PublicKey, err: unknown): Promise<unknown> {
    const mapped = mapError(err);
    if (mapped.name !== 'DuplicatePayment' && mapped.name !== 'AccountNotInitialized') return err;
    try {
      const current = await this.fetchInvoice(invoicePda, 'confirmed');
      const pdaStr = invoicePda.toBase58();
      if (current.status === InvoiceStatus.Closed) return new InvoiceClosedError(pdaStr, { cause: err });
      if (current.status === InvoiceStatus.Expired) return new InvoiceExpiredError(pdaStr, { cause: err });
    } catch {
      // Could not re-read: keep the original error.
    }
    return err;
  }

  async merchantClaim(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string; recovered: boolean }> {
    const wallet = this.requireWallet();
    const invoice = await this.fetchInvoice(args.invoicePda, 'confirmed');
    const instructions = [
      await buildMerchantClaimIx(
        { merchant: wallet.publicKey, invoicePda: args.invoicePda, mint: invoice.mint },
        this.programId,
        this.connection,
      ),
    ];
    return this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: args.invoicePda,
      landed: (inv) => inv !== null && inv.claimed,
      write: opts,
    });
  }

  async refundOverpayment(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string; recovered: boolean }> {
    const wallet = this.requireWallet();
    const invoice = await this.fetchInvoice(args.invoicePda, 'confirmed');
    const instructions = [
      await buildRefundOverpaymentIx(
        { caller: wallet.publicKey, invoicePda: args.invoicePda, mint: invoice.mint, invoice },
        this.programId,
        this.connection,
      ),
    ];
    return this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: args.invoicePda,
      landed: (inv) => inv !== null && inv.refundedExcess > 0n,
      write: opts,
    });
  }

  async expireInvoice(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string; recovered: boolean }> {
    const wallet = this.requireWallet();
    const instructions = [
      await buildExpireInvoiceIx(
        { caller: wallet.publicKey, invoicePda: args.invoicePda },
        this.programId,
        this.connection,
      ),
    ];
    return this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: args.invoicePda,
      landed: (inv) => inv !== null && inv.status === InvoiceStatus.Expired,
      write: opts,
    });
  }

  async recoverUnattributed(
    args: {
      invoicePda: PublicKey;
      destinationAta: PublicKey;
    },
    opts?: WriteOptions,
  ): Promise<{ signature: string; recovered: boolean }> {
    const wallet = this.requireWallet();
    const invoice = await this.fetchInvoice(args.invoicePda, 'confirmed');
    const instructions = [
      await buildRecoverUnattributedIx(
        {
          merchant: wallet.publicKey,
          invoicePda: args.invoicePda,
          mint: invoice.mint,
          destinationAta: args.destinationAta,
        },
        this.programId,
        this.connection,
      ),
    ];
    return this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: args.invoicePda,
      landed: async () => (await this.fetchEscrowBalance(args.invoicePda, invoice.mint)) === 0n,
      write: opts,
    });
  }

  async closeInvoice(
    args: { invoicePda: PublicKey },
    opts?: WriteOptions,
  ): Promise<{ signature: string; recovered: boolean }> {
    const wallet = this.requireWallet();
    const invoice = await this.fetchInvoice(args.invoicePda, 'confirmed');
    const instructions = [
      await buildCloseInvoiceIx(
        { merchant: wallet.publicKey, invoicePda: args.invoicePda, mint: invoice.mint },
        this.programId,
        this.connection,
      ),
    ];
    return this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: args.invoicePda,
      landed: (inv) => inv !== null && inv.status === InvoiceStatus.Closed,
      write: opts,
    });
  }

  // ----- State helpers ------------------------------------------------------

  async waitForInvoiceState(
    invoicePda: PublicKey,
    predicate: (inv: Invoice) => boolean,
    opts: WaitForInvoiceStateOptions = {},
  ): Promise<Invoice> {
    const commitment = opts.commitment ?? this.commitment;
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const pollMs = opts.pollMs ?? 1_000;
    const started = Date.now();

    for (;;) {
      const inv = await this.fetchInvoiceOrNullAt(invoicePda, commitment);
      if (inv && predicate(inv)) return inv;
      if (Date.now() - started >= timeoutMs) {
        throw new TxTimeoutError(
          `Timed out after ${timeoutMs}ms waiting for the invoice ${invoicePda.toBase58()} predicate at ${commitment}.`,
        );
      }
      await delay(pollMs);
    }
  }

  subscribeInvoice(invoicePda: PublicKey, cb: (inv: Invoice | null) => void): () => void {
    let stopped = false;
    let subscriptionId: number | null = null;

    try {
      subscriptionId = this.connection.onAccountChange(
        invoicePda,
        (accountInfo) => {
          if (stopped) return;
          if (!accountInfo || accountInfo.data.length === 0) {
            cb(null);
            return;
          }
          try {
            cb(decodeInvoice(accountInfo.data as Buffer));
          } catch {
            return;
          }
        },
        this.commitment as Web3Commitment,
      );
    } catch {
      subscriptionId = null;
    }

    return () => {
      stopped = true;
      if (subscriptionId !== null) {
        void Promise.resolve(this.connection.removeAccountChangeListener(subscriptionId)).catch(() => {});
      }
    };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutLike(mapped: ReturnType<typeof mapError>): boolean {
  return /timeout|timed out|did not confirm|not confirmed|blockheight|block height|network/i.test(mapped.message);
}

function signatureOf(err: unknown): string | null {
  const obj = err as { signature?: unknown } | null;
  if (obj && typeof obj.signature === 'string') return obj.signature;
  return null;
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  const mapped = mapError(err);
  return new PaytruthError(mapped.message, { cause: err });
}

