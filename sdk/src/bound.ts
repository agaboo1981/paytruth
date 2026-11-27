import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';
import { PaytruthClient } from './client';
import { MainnetRefusedError, PaytruthError } from './errors';
import type { PaytruthWallet, WriteOptions } from './send';
import type { Commitment, Config, Invoice, PaytruthSdk } from './types';

export interface BindPaytruthArgs {
  connection?: Connection;
  wallet?: PaytruthWallet | null;
  programId?: PublicKey;
  commitment?: Commitment;
}

/**
 * Resolve the RPC endpoint from NEXT_PUBLIC_SOLANA_RPC, falling back to devnet.
 * Refuses mainnet endpoints.
 */
export function resolveRpcEndpoint(): string {
  const env =
    typeof process !== 'undefined' && process.env ? process.env.NEXT_PUBLIC_SOLANA_RPC : undefined;
  const endpoint = env && env.trim().length > 0 ? env.trim() : clusterApiUrl('devnet');
  if (endpoint.toLowerCase().includes('mainnet')) {
    throw new MainnetRefusedError(`Refusing to use a mainnet endpoint: ${endpoint}`);
  }
  return endpoint;
}

const NO_WALLET_MESSAGE = 'Connect a wallet first.';

let boundArgs: BindPaytruthArgs = {};
let boundClient: PaytruthClient | null = null;

function defaultConnection(): Connection {
  return new Connection(resolveRpcEndpoint(), 'confirmed');
}

function createClient(args: BindPaytruthArgs): PaytruthClient {
  return new PaytruthClient({
    connection: args.connection ?? defaultConnection(),
    wallet: args.wallet ?? undefined,
    programId: args.programId,
    commitment: args.commitment ?? 'confirmed',
  });
}

/**
 * (Re)create and store the singleton PaytruthClient. Called from the React
 * bridge whenever the connection or wallet changes.
 */
export function bindPaytruth(args: BindPaytruthArgs): PaytruthClient {
  boundArgs = args;
  boundClient = createClient(args);
  return boundClient;
}

/**
 * The currently bound client. Before any bind, lazily creates a client on the
 * resolved RPC endpoint (NEXT_PUBLIC_SOLANA_RPC or devnet) with no wallet.
 */
export function getBoundClient(): PaytruthClient {
  if (!boundClient) {
    boundClient = createClient(boundArgs);
  }
  return boundClient;
}

/** Whether the currently bound client has a wallet. */
function hasBoundWallet(): boolean {
  return Boolean(getBoundClient().wallet);
}

function requireBoundWallet(): void {
  if (!hasBoundWallet()) {
    throw new PaytruthError(NO_WALLET_MESSAGE);
  }
}

/**
 * A stable object implementing PaytruthSdk whose methods delegate to the
 * currently bound PaytruthClient (re-created on bind). Reads work with no
 * wallet; writes throw 'Connect a wallet first.' until a wallet is bound.
 */
export const paytruthSdk: PaytruthSdk = {
  getInvoicePda(merchant: PublicKey, invoiceId: bigint): [PublicKey, number] {
    return getBoundClient().getInvoicePda(merchant, invoiceId);
  },
  getConfigPda(): [PublicKey, number] {
    return getBoundClient().getConfigPda();
  },
  getEscrowAta(invoicePda: PublicKey, mint: PublicKey): PublicKey {
    return getBoundClient().getEscrowAta(invoicePda, mint);
  },

  fetchConfig(commitment?: Commitment): Promise<Config> {
    return getBoundClient().fetchConfig(commitment);
  },
  fetchInvoice(invoicePda: PublicKey, commitment?: Commitment): Promise<Invoice> {
    return getBoundClient().fetchInvoice(invoicePda, commitment);
  },
  fetchInvoiceByMerchantAndId(
    merchant: PublicKey,
    invoiceId: bigint,
    commitment?: Commitment,
  ): Promise<Invoice> {
    return getBoundClient().fetchInvoiceByMerchantAndId(merchant, invoiceId, commitment);
  },
  fetchEscrowBalance(invoicePda: PublicKey, mint: PublicKey): Promise<bigint> {
    return getBoundClient().fetchEscrowBalance(invoicePda, mint);
  },

  async initializeConfig(args: { usdcMint: PublicKey }, opts?: WriteOptions): Promise<{ signature: string; configPda: PublicKey }> {
    requireBoundWallet();
    return getBoundClient().initializeConfig(args, opts);
  },
  async createInvoice(args: {
    invoiceId: bigint;
    amountDue: bigint;
    expiresAt: bigint;
    memo: string | Uint8Array;
  }, opts?: WriteOptions): Promise<{ signature: string; invoicePda: PublicKey }> {
    requireBoundWallet();
    return getBoundClient().createInvoice(args, opts);
  },
  async payInvoice(args: { invoicePda: PublicKey; amount: bigint; expectedAmountDue: bigint }, opts?: WriteOptions): Promise<{ signature: string }> {
    requireBoundWallet();
    const result = await getBoundClient().payInvoice(args, opts);
    return { signature: result.signature };
  },
  async merchantClaim(args: { invoicePda: PublicKey }, opts?: WriteOptions): Promise<{ signature: string }> {
    requireBoundWallet();
    const result = await getBoundClient().merchantClaim(args, opts);
    return { signature: result.signature };
  },
  async refundOverpayment(args: { invoicePda: PublicKey }, opts?: WriteOptions): Promise<{ signature: string }> {
    requireBoundWallet();
    const result = await getBoundClient().refundOverpayment(args, opts);
    return { signature: result.signature };
  },
  async expireInvoice(args: { invoicePda: PublicKey }, opts?: WriteOptions): Promise<{ signature: string }> {
    requireBoundWallet();
    const result = await getBoundClient().expireInvoice(args, opts);
    return { signature: result.signature };
  },
  async recoverUnattributed(args: {
    invoicePda: PublicKey;
    destinationAta: PublicKey;
  }, opts?: WriteOptions): Promise<{ signature: string }> {
    requireBoundWallet();
    const result = await getBoundClient().recoverUnattributed(args, opts);
    return { signature: result.signature };
  },
  async closeInvoice(args: { invoicePda: PublicKey }, opts?: WriteOptions): Promise<{ signature: string }> {
    requireBoundWallet();
    const result = await getBoundClient().closeInvoice(args, opts);
    return { signature: result.signature };
  },

  waitForInvoiceState(
    invoicePda: PublicKey,
    predicate: (inv: Invoice) => boolean,
    opts?: { commitment?: Commitment; timeoutMs?: number },
  ): Promise<Invoice> {
    return getBoundClient().waitForInvoiceState(invoicePda, predicate, opts);
  },
  subscribeInvoice(invoicePda: PublicKey, cb: (inv: Invoice | null) => void): () => void {
    return getBoundClient().subscribeInvoice(invoicePda, cb);
  },
};
