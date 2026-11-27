/**
 * GATED localnet end-to-end test (TEST-PLAN §E steps 1-7).
 *
 * Spawns its own solana-test-validator with the built program, creates a fresh
 * 6-decimal classic SPL mint, airdrops once per keypair, and drives the seven
 * demo steps through the SDK with Keypair-backed wallets. Runs only when
 * PAYTRUTH_LOCALNET=1.
 */
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaytruthClient } from '../../src/client';
import { mapError } from '../../src/errors';
import type { PaytruthWallet } from '../../src/send';
import { InvoiceStatus } from '../../src/types';

const GATED = process.env.PAYTRUTH_LOCALNET === '1';
const RPC_PORT = Number(process.env.PAYTRUTH_LOCALNET_PORT ?? '8899');
const FAUCET_PORT = RPC_PORT + 1001; // default pair 8899/9900
const RPC = `http://127.0.0.1:${RPC_PORT}`;

/** Refuse to run against a validator we did not start (shared box: other bots use 8899). */
async function assertPortFree(): Promise<void> {
  let answered = false;
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    answered = res.status > 0;
  } catch {
    answered = false;
  }
  if (answered) {
    throw new Error(
      `Something is already serving RPC on ${RPC} (another validator?). Refusing to run against a validator this test did not start; set PAYTRUTH_LOCALNET_PORT to a free port.`,
    );
  }
}
const PROGRAM_ID = new PublicKey('D8dnG9j1zSwwaJLyAvp794MJqEXptdiVS74gh6fNLQ7H');
const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, '..', '..');
const LEDGER = resolve(sdkRoot, '.test-ledger');
const PROGRAM_SO = process.env.PAYTRUTH_PROGRAM_SO
  ? resolve(process.env.PAYTRUTH_PROGRAM_SO)
  : resolve(sdkRoot, '.localnet-program.so');

const authority = Keypair.generate();
const merchant = Keypair.generate();
const payer = Keypair.generate();
const mintKp = Keypair.generate();
const mint = mintKp.publicKey;
const payerAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, SPL_TOKEN_PROGRAM_ID);

let validator: ChildProcess | undefined;
let validatorOutput = '';
let validatorFatal = '';
let validatorHealthy = false;
let connection: Connection;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keypairWallet(kp: Keypair): PaytruthWallet {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      (tx as Transaction).partialSign(kp);
      return tx;
    },
  };
}

async function airdropOnce(conn: Connection, pk: PublicKey, sol = 100): Promise<void> {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
}

async function sendIxs(conn: Connection, signer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction();
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.add(...ixs);
  tx.sign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    if (validatorFatal) throw new Error(`validator failed to start: ${validatorFatal}\n${validatorOutput}`);
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const body = (await res.json()) as { result?: string; error?: unknown };
      if (body.result === 'ok') {
        validatorHealthy = true;
        return;
      }
      last = JSON.stringify(body);
    } catch (err) {
      last = String(err);
    }
    await sleep(500);
  }
  throw new Error(`validator did not become healthy at ${RPC}: ${last}\n${validatorOutput}`);
}

async function clusterNow(conn: Connection): Promise<bigint> {
  const slot = await conn.getSlot('confirmed');
  const blockTime = await conn.getBlockTime(slot);
  if (blockTime === null) throw new Error(`no cluster clock at slot ${slot}`);
  return BigInt(blockTime);
}

async function waitPast(conn: Connection, expiresAt: bigint, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await clusterNow(conn)) >= expiresAt) return;
    await sleep(300);
  }
  throw new Error(`cluster clock never reached ${expiresAt}`);
}

async function tokenBalance(conn: Connection, ata: PublicKey): Promise<bigint> {
  const info = await conn.getAccountInfo(ata, 'confirmed');
  if (!info) return 0n;
  const { value } = await conn.getTokenAccountBalance(ata, 'confirmed');
  return BigInt(value.amount);
}

async function failedName(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (err) {
    return mapError(err).name;
  }
  return undefined;
}

describe.skipIf(!GATED)('localnet E2E (§E steps 1-7)', () => {
  beforeAll(async () => {
    if (!existsSync(PROGRAM_SO)) throw new Error(`program binary not found: ${PROGRAM_SO}`);
    await assertPortFree();
    validator = spawn(
      'solana-test-validator',
      [
        '--reset',
        '--quiet',
        '--ledger',
        LEDGER,
        '--bpf-program',
        PROGRAM_ID.toBase58(),
        PROGRAM_SO,
        '--rpc-port',
        String(RPC_PORT),
        '--faucet-port',
        String(FAUCET_PORT),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const stream of [validator.stdout, validator.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        validatorOutput += chunk.toString();
      });
    }
    validator.on('error', (err) => {
      validatorFatal = `spawn error: ${err.message}`;
    });
    validator.on('exit', (code, signal) => {
      if (!validatorHealthy) {
        validatorFatal = `exited before healthy (code=${code}, signal=${signal})`;
      }
    });
    connection = new Connection(RPC, 'confirmed');
    await waitForHealth(60_000);

    await airdropOnce(connection, authority.publicKey);
    await airdropOnce(connection, merchant.publicKey);
    await airdropOnce(connection, payer.publicKey);

    const rent = await connection.getMinimumBalanceForRentExemption(82);
    const createMintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mint,
        space: 82,
        lamports: rent,
        programId: SPL_TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint, 6, authority.publicKey, null, SPL_TOKEN_PROGRAM_ID),
    );
    createMintTx.feePayer = authority.publicKey;
    createMintTx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    createMintTx.sign(authority, mintKp);
    await connection.sendRawTransaction(createMintTx.serialize(), { skipPreflight: true });

    await sendIxs(connection, payer, [
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        payerAta,
        payer.publicKey,
        mint,
        SPL_TOKEN_PROGRAM_ID,
      ),
    ]);
    await sendIxs(connection, authority, [
      createMintToInstruction(mint, payerAta, authority.publicKey, 1_000_000_000n, [], SPL_TOKEN_PROGRAM_ID),
    ]);

    const client = new PaytruthClient({
      connection,
      wallet: keypairWallet(authority),
      programId: PROGRAM_ID,
    });
    await client.initializeConfig({ usdcMint: mint });
  }, 120_000);

  afterAll(() => {
    validator?.kill('SIGTERM');
  });

  it('step 1: merchant creates an invoice (Open, escrow ATA created by init_if_needed)', async () => {
    const merchantClient = new PaytruthClient({
      connection,
      wallet: keypairWallet(merchant),
      programId: PROGRAM_ID,
    });
    const expiresAt = (await clusterNow(connection)) + 3_600n;
    const { invoicePda } = await merchantClient.createInvoice({
      invoiceId: 1n,
      amountDue: 1_000_000n,
      expiresAt,
      memo: 'step-1',
    });
    const inv = await connection.getAccountInfo(invoicePda, 'confirmed');
    expect(inv).not.toBeNull();
    const decoded = await new PaytruthClient({ connection, programId: PROGRAM_ID }).fetchInvoice(invoicePda);
    expect(decoded.status).toBe(InvoiceStatus.Open);
    expect(decoded.invoiceId).toBe(1n);
    expect(decoded.amountDue).toBe(1_000_000n);
    expect(decoded.expiresAt).toBe(expiresAt);
    expect(decoded.merchant.equals(merchant.publicKey)).toBe(true);
    expect(decoded.payer.equals(PublicKey.default)).toBe(true);
    expect(decoded.mint.equals(mint)).toBe(true);
    expect(new TextDecoder().decode(decoded.memo).replace(/\0+$/, '')).toBe('step-1');
    const escrowAta = new PaytruthClient({ connection, programId: PROGRAM_ID }).getEscrowAta(invoicePda, mint);
    expect(await connection.getAccountInfo(escrowAta, 'confirmed')).not.toBeNull();
    expect(await tokenBalance(connection, escrowAta)).toBe(0n);
  }, 120_000);

  it('step 2: customer pays exact with the observed terms -> Paid', async () => {
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const [invoicePda] = observer.getInvoicePda(merchant.publicKey, 1n);
    const before = await tokenBalance(connection, payerAta);
    const payerClient = new PaytruthClient({ connection, wallet: keypairWallet(payer), programId: PROGRAM_ID });
    await payerClient.payInvoice({
      invoicePda,
      amount: 1_000_000n,
      expectedAmountDue: (await observer.fetchInvoice(invoicePda)).amountDue,
    });
    const inv = await observer.waitForInvoiceState(invoicePda, (i) => i.status === InvoiceStatus.Paid, {
      commitment: 'confirmed',
      timeoutMs: 30_000,
    });
    expect(inv.paidAmount).toBe(1_000_000n);
    expect(inv.payer.equals(payer.publicKey)).toBe(true);
    expect(await tokenBalance(connection, payerAta)).toBe(before - 1_000_000n);
    expect(await observer.fetchEscrowBalance(invoicePda, mint)).toBe(1_000_000n);
  }, 120_000);

  it('step 3: merchant claims -> claimed, escrow emptied to merchant ATA', async () => {
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const [invoicePda] = observer.getInvoicePda(merchant.publicKey, 1n);
    const merchantAta = getAssociatedTokenAddressSync(mint, merchant.publicKey, false, SPL_TOKEN_PROGRAM_ID);
    const merchantClient = new PaytruthClient({
      connection,
      wallet: keypairWallet(merchant),
      programId: PROGRAM_ID,
    });
    await merchantClient.merchantClaim({ invoicePda });
    const inv = await observer.waitForInvoiceState(invoicePda, (i) => i.claimed, {
      commitment: 'confirmed',
      timeoutMs: 30_000,
    });
    expect(inv.claimed).toBe(true);
    expect(await tokenBalance(connection, merchantAta)).toBe(1_000_000n);
    expect(await observer.fetchEscrowBalance(invoicePda, mint)).toBe(0n);
  }, 120_000);

  it('step 4: a duplicate payment after claiming fails with DuplicatePayment', async () => {
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const [invoicePda] = observer.getInvoicePda(merchant.publicKey, 1n);
    const payerClient = new PaytruthClient({ connection, wallet: keypairWallet(payer), programId: PROGRAM_ID });
    const before = await observer.fetchInvoice(invoicePda);
    const name = await failedName(async () => {
      await payerClient.payInvoice({
        invoicePda,
        amount: 1_000_000n,
        expectedAmountDue: before.amountDue,
      });
    });
    expect(name).toBe('DuplicatePayment');
    const after = await observer.fetchInvoice(invoicePda);
    expect(after.status).toBe(before.status);
    expect(after.paidAmount).toBe(before.paidAmount);
    expect(after.claimed).toBe(before.claimed);
  }, 120_000);

  it('step 5: overpayment is refunded to the recorded payer', async () => {
    const merchantClient = new PaytruthClient({
      connection,
      wallet: keypairWallet(merchant),
      programId: PROGRAM_ID,
    });
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const { invoicePda } = await merchantClient.createInvoice({
      invoiceId: 2n,
      amountDue: 1_000_000n,
      expiresAt: (await clusterNow(connection)) + 3_600n,
      memo: 'step-5',
    });
    const before = await tokenBalance(connection, payerAta);
    const payerClient = new PaytruthClient({ connection, wallet: keypairWallet(payer), programId: PROGRAM_ID });
    await payerClient.payInvoice({ invoicePda, amount: 1_500_000n, expectedAmountDue: 1_000_000n });
    await payerClient.refundOverpayment({ invoicePda });
    const inv = await observer.waitForInvoiceState(invoicePda, (i) => i.refundedExcess > 0n, {
      commitment: 'confirmed',
      timeoutMs: 30_000,
    });
    expect(inv.refundedExcess).toBe(500_000n);
    expect(inv.paidAmount).toBe(1_500_000n);
    expect(await tokenBalance(connection, payerAta)).toBe(before - 1_000_000n);
    expect(await observer.fetchEscrowBalance(invoicePda, mint)).toBe(1_000_000n);
  }, 120_000);

  it('step 6: expiry, close tombstone, duplicate-after-close, and reload mismatch', async () => {
    const merchantClient = new PaytruthClient({
      connection,
      wallet: keypairWallet(merchant),
      programId: PROGRAM_ID,
    });
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const payerClient = new PaytruthClient({ connection, wallet: keypairWallet(payer), programId: PROGRAM_ID });
    const expiresAt = (await clusterNow(connection)) + 4n;
    const { invoicePda } = await merchantClient.createInvoice({
      invoiceId: 3n,
      amountDue: 1_000_000n,
      expiresAt,
      memo: 'step-6',
    });
    await waitPast(connection, expiresAt, 30_000);

    const beforeExpiredPay = await observer.fetchInvoice(invoicePda);
    const expiredPay = await failedName(async () => {
      await payerClient.payInvoice({
        invoicePda,
        amount: 1_000_000n,
        expectedAmountDue: beforeExpiredPay.amountDue,
      });
    });
    expect(expiredPay).toBe('InvoiceExpired');
    const afterExpiredPay = await observer.fetchInvoice(invoicePda);
    expect(afterExpiredPay.status).toBe(beforeExpiredPay.status);
    expect(afterExpiredPay.paidAmount).toBe(beforeExpiredPay.paidAmount);

    await payerClient.expireInvoice({ invoicePda });
    const expired = await observer.waitForInvoiceState(invoicePda, (i) => i.status === InvoiceStatus.Expired, {
      commitment: 'confirmed',
      timeoutMs: 30_000,
    });
    expect(expired.status).toBe(InvoiceStatus.Expired);
    await merchantClient.closeInvoice({ invoicePda });
    const closed = await observer.fetchInvoice(invoicePda);
    expect(closed.status).toBe(InvoiceStatus.Closed);
    expect(await connection.getAccountInfo(invoicePda, 'confirmed')).not.toBeNull();
    expect(await observer.fetchEscrowBalance(invoicePda, mint)).toBe(0n);
    expect(await connection.getAccountInfo(observer.getEscrowAta(invoicePda, mint), 'confirmed')).toBeNull();

    const escrowAta = observer.getEscrowAta(invoicePda, mint);
    const missingEscrowPay = await failedName(() =>
      payerClient.payInvoice({
        invoicePda,
        amount: 1_000_000n,
        expectedAmountDue: closed.amountDue,
      }),
    );
    expect(missingEscrowPay).toBe('AccountNotInitialized');

    await sendIxs(connection, payer, [
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        escrowAta,
        invoicePda,
        mint,
        SPL_TOKEN_PROGRAM_ID,
      ),
    ]);
    const duplicateAfterClose = await failedName(() =>
      payerClient.payInvoice({
        invoicePda,
        amount: 1_000_000n,
        expectedAmountDue: closed.amountDue,
      }),
    );
    expect(duplicateAfterClose).toBe('DuplicatePayment');

    await sendIxs(connection, payer, [
      createTransferInstruction(payerAta, escrowAta, payer.publicKey, 500_000n, [], SPL_TOKEN_PROGRAM_ID),
    ]);
    const merchantAta = getAssociatedTokenAddressSync(mint, merchant.publicKey, false, SPL_TOKEN_PROGRAM_ID);
    const merchantBefore = await tokenBalance(connection, merchantAta);
    await merchantClient.recoverUnattributed({ invoicePda, destinationAta: merchantAta });
    expect(await observer.fetchEscrowBalance(invoicePda, mint)).toBe(0n);
    expect(await tokenBalance(connection, merchantAta)).toBe(merchantBefore + 500_000n);
    expect((await observer.fetchInvoice(invoicePda)).status).toBe(InvoiceStatus.Closed);

    const { invoicePda: stalePda } = await merchantClient.createInvoice({
      invoiceId: 4n,
      amountDue: 2_000_000n,
      expiresAt: (await clusterNow(connection)) + 3_600n,
      memo: 'mismatch',
    });
    const before = await tokenBalance(connection, payerAta);
    const mismatch = await failedName(() =>
      payerClient.payInvoice({ invoicePda: stalePda, amount: 2_000_000n, expectedAmountDue: 1n }),
    );
    expect(mismatch).toBe('InvoiceMismatch');
    expect((await observer.fetchInvoice(stalePda)).status).toBe(InvoiceStatus.Open);
    expect(await tokenBalance(connection, payerAta)).toBe(before);
  }, 120_000);

  it('step 7: an independent observer reads status and escrow with no wallet', async () => {
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const [invoicePda] = observer.getInvoicePda(merchant.publicKey, 2n);
    const inv = await observer.fetchInvoice(invoicePda);
    const balance = await observer.fetchEscrowBalance(invoicePda, mint);
    expect(inv.status).toBe(InvoiceStatus.Paid);
    expect(balance).toBe(1_000_000n);
  }, 120_000);

  it('wallet refreshes blockhash and adds a priority fee; tx still lands', async () => {
    const merchantClient = new PaytruthClient({
      connection,
      wallet: keypairWallet(merchant),
      programId: PROGRAM_ID,
    });
    const observer = new PaytruthClient({ connection, programId: PROGRAM_ID });
    const { invoicePda } = await merchantClient.createInvoice({
      invoiceId: 10n,
      amountDue: 1_000_000n,
      expiresAt: (await clusterNow(connection)) + 3_600n,
      memo: 'refresh-and-priority-fee',
    });

    let builtBlockhash: string | undefined;
    let signedBlockhash: string | undefined;

    const refreshingWallet: PaytruthWallet = {
      publicKey: payer.publicKey,
      async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        const t = tx as Transaction;
        builtBlockhash = t.recentBlockhash;
        // Wait until the cluster hands back a different blockhash (poll every 400ms, max 10s).
        const started = Date.now();
        for (;;) {
          const { blockhash } = await connection.getLatestBlockhash('confirmed');
          if (blockhash !== t.recentBlockhash) {
            t.recentBlockhash = blockhash;
            break;
          }
          if (Date.now() - started > 10_000) throw new Error('blockhash never refreshed locally');
          await sleep(400);
        }
        signedBlockhash = t.recentBlockhash;
        // Wallet adds a priority fee.
        t.instructions.unshift(
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        );
        t.partialSign(payer);
        return tx;
      },
    };

    const payerClient = new PaytruthClient({ connection, wallet: refreshingWallet, programId: PROGRAM_ID });
    await payerClient.payInvoice({
      invoicePda,
      amount: 1_000_000n,
      expectedAmountDue: (await observer.fetchInvoice(invoicePda)).amountDue,
    });

    expect(builtBlockhash).toBeDefined();
    expect(signedBlockhash).toBeDefined();
    expect(signedBlockhash).not.toBe(builtBlockhash);

    const inv = await observer.waitForInvoiceState(invoicePda, (i) => i.status === InvoiceStatus.Paid, {
      commitment: 'confirmed',
      timeoutMs: 30_000,
    });
    expect(inv.status).toBe(InvoiceStatus.Paid);
    expect(inv.paidAmount).toBe(1_000_000n);
    expect(inv.payer.equals(payer.publicKey)).toBe(true);
  }, 120_000);
});
