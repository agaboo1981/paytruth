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
import { MainnetRefusedError, PaytruthError, TxTimeoutError, mapError } from './errors';
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
import { signAndSend, fireStage, type PaytruthWallet, type WriteOptions } from './send';
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
   * shows it did not land AND the old blockhash has expired.
   */
  async writeWithRecovery(args: WriteWithRecoveryArgs): Promise<WriteResult> {
    const wallet = this.requireWallet();
    const maxAttempts = args.maxAttempts ?? 2;
    let lastSignature: string | null = null;
    let lastBlockhash: string | null = null;
    let lastValidBlockHeight = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const instructions = await args.build();

      // Capture the blockhash we are about to sign against, so we can decide
      // whether a retry is safe (never resubmit while it is still valid).
      let signedBlockhash: string;
      let signedLastValidBlockHeight: number;
      try {
        const bh = await this.connection.getLatestBlockhash('confirmed');
        signedBlockhash = bh.blockhash;
        signedLastValidBlockHeight = bh.lastValidBlockHeight;
      } catch (err) {
        throw toError(err);
      }

      try {
        const sig = await signAndSend(this.connection, wallet, instructions, {
          commitment: this.commitment,
          write: args.write,
        });
        return { signature: sig, recovered: false };
      } catch (err) {
        const mapped = mapError(err);
        const retryable = mapped.retryable || isTimeoutLike(mapped) || mapped.kind === 'rpc';
        if (!retryable) throw toError(err);

        // Refetch the account at confirmed, then finalized.
        const landedConfirmed = await this.safeLanded(args, 'confirmed');
        if (landedConfirmed) {
          const recoveredSig = lastSignature ?? signatureOf(err) ?? '';
          fireStage(args.write, 'confirmed', { signature: recoveredSig });
          return { signature: recoveredSig, recovered: true };
        }
        const landedFinalized = await this.safeLanded(args, 'finalized');
        if (landedFinalized) {
          const recoveredSig = lastSignature ?? signatureOf(err) ?? '';
          fireStage(args.write, 'confirmed', { signature: recoveredSig });
          return { signature: recoveredSig, recovered: true };
        }

        // Not landed. Only resubmit if the old blockhash is definitively expired.
        lastSignature = signatureOf(err) ?? lastSignature;
        lastBlockhash = signedBlockhash;
        lastValidBlockHeight = signedLastValidBlockHeight;

        const height = await this.connection.getBlockHeight('confirmed').catch(() => signedLastValidBlockHeight);
        const expired = height > lastValidBlockHeight;
        if (!expired) {
          // Never resubmit while the old blockhash may still be valid.
          throw new TxTimeoutError(
            'The transaction did not confirm yet and the blockhash is still valid; not resubmitting.',
          );
        }
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
    return this.writeWithRecovery({
      build: async () => instructions,
      invoicePda: args.invoicePda,
      landed: (inv) => inv !== null && inv.status === InvoiceStatus.Paid && inv.payer.equals(wallet.publicKey),
      write: opts,
    });
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

