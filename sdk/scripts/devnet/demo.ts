/**
 * Devnet demo runner for the seven TEST-PLAN §E steps against the deployed
 * Paytruth program.
 *
 *   tsx scripts/devnet/demo.ts --check          # no transactions: sanity + funding table
 *   tsx scripts/devnet/demo.ts                  # run all seven steps
 *   tsx scripts/devnet/demo.ts --step 3         # run only step 3
 *   tsx scripts/devnet/demo.ts --from 4         # run steps 4..7
 *   tsx scripts/devnet/demo.ts --wait-usdc 600  # poll payer USDC up to 600s before steps needing it
 *
 * Nothing here is hardcoded: the program id, config PDA and USDC mint come from
 * PAYTRUTH_* env overrides or programs/DEPLOYMENTS.md. The runner refuses any
 * mainnet URL and aborts unless the cluster genesis hash is devnet. It never
 * reads or logs secret key bytes — only public keys are printed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PaytruthClient } from '../../src/client';
import { USDC_DECIMALS } from '../../src/constants';
import { buildPayInvoiceIx } from '../../src/instructions';
import { getConfigPda, getEscrowAta } from '../../src/pda';
import type { PaytruthWallet } from '../../src/send';
import { InvoiceStatus, type Invoice } from '../../src/types';
import {
  DEVNET_SOL_NEEDS,
  amountsFromEnv,
  assertDevnetGenesis,
  ensureUsdcBalance,
  explorerTxUrl,
  formatUsdc,
  formatWat,
  invoiceIdBase,
  loadDevnetDeployment,
  loadKeypair,
  mapFailureMetaErr,
  reportTimestamp,
  resolveConfig,
  resolveRepoRoot,
  usdcNeeds,
  type Amounts,
  type DevnetDeployment,
  type ResolvedConfig,
} from './lib';

const COMMITMENT = 'confirmed' as const;
const FINALIZED = 'finalized' as const;
const FINALIZED_TIMEOUT_MS = 90_000;
const WAIT_USDC_POLL_MS = 10_000;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface Cli {
  check: boolean;
  step: number | null;
  from: number | null;
  waitUsdc: number;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { check: false, step: null, from: null, waitUsdc: 0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--check') cli.check = true;
    else if (arg === '--step') cli.step = requireInt(argv[++i], '--step');
    else if (arg.startsWith('--step=')) cli.step = requireInt(arg.slice('--step='.length), '--step');
    else if (arg === '--from') cli.from = requireInt(argv[++i], '--from');
    else if (arg.startsWith('--from=')) cli.from = requireInt(arg.slice('--from='.length), '--from');
    else if (arg === '--wait-usdc') cli.waitUsdc = requireInt(argv[++i], '--wait-usdc');
    else if (arg.startsWith('--wait-usdc=')) cli.waitUsdc = requireInt(arg.slice('--wait-usdc='.length), '--wait-usdc');
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (cli.step !== null && (cli.step < 1 || cli.step > 7)) throw new Error('--step must be 1..7');
  if (cli.from !== null && (cli.from < 1 || cli.from > 7)) throw new Error('--from must be 1..7');
  return cli;
}

function requireInt(value: string | undefined, flag: string): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${flag} requires an integer value`);
  return Number(value);
}

function printHelp(): void {
  console.log(`Paytruth devnet demo runner

Usage: tsx scripts/devnet/demo.ts [options]

  --check            No transactions. Print config/sanity + a funding table, then exit 0.
  --step N           Run only step N (1..7). Steps that depend on earlier invoice state are recreated as needed.
  --from N           Run steps N..7.
  --wait-usdc SEC    Before steps needing USDC, poll the payer balance every 10s up to SEC seconds.

Env:
  PAYTRUTH_DEVNET_RPC, PAYTRUTH_PROGRAM_ID, PAYTRUTH_CONFIG_PDA, PAYTRUTH_USDC_MINT,
  PAYTRUTH_MERCHANT_KEYPAIR, PAYTRUTH_PAYER_KEYPAIR,
  STEP2_DUE, STEP5_DUE, STEP5_PAY, STEP6_DUE (USDC base units; 6 decimals)`);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

type TxResult = 'ok' | 'expected-failure';

interface TxRecord {
  step: number;
  label: string;
  signature: string;
  explorer: string;
  result: TxResult;
  errorName?: string;
  detail?: string;
}

interface StepReport {
  step: number;
  title: string;
  assertions: { label: string; ok: boolean; detail?: string }[];
  ok: boolean;
}

interface Report {
  startedAt: string;
  finishedAt: string;
  startedAtWat: string;
  finishedAtWat: string;
  rpcUrl: string;
  programId: string;
  configPda: string;
  usdcMint: string;
  amounts: Record<string, string>;
  steps: StepReport[];
  transactions: TxRecord[];
  invoices: Record<string, string>;
  ok: boolean;
}

const transactions: TxRecord[] = [];
const stepReports: StepReport[] = [];

function record(
  step: number,
  label: string,
  signature: string,
  result: TxResult,
  errorName?: string,
  detail?: string,
): void {
  const rec: TxRecord = { step, label, signature, explorer: explorerTxUrl(signature), result };
  if (errorName) rec.errorName = errorName;
  if (detail) rec.detail = detail;
  transactions.push(rec);
  const status = result === 'ok' ? 'ok' : `expected-failure${errorName ? ` (${errorName})` : ''}`;
  console.log(`  [tx] step ${step} ${label}: ${signature} -> ${status}`);
}

class AssertionTracker {
  readonly assertions: StepReport['assertions'] = [];
  constructor(
    readonly step: number,
    readonly title: string,
  ) {}

  check(label: string, ok: boolean, detail?: string): void {
    this.assertions.push({ label, ok, detail });
    const marker = ok ? 'PASS' : 'FAIL';
    console.log(`  [${marker}] step ${this.step}: ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) throw new StepFailure(`step ${this.step} assertion failed: ${label}${detail ? ` (${detail})` : ''}`);
  }

  finish(): StepReport {
    const report: StepReport = {
      step: this.step,
      title: this.title,
      assertions: this.assertions,
      ok: this.assertions.every((a) => a.ok),
    };
    stepReports.push(report);
    return report;
  }
}

class StepFailure extends Error {
  override name = 'StepFailure';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, SPL_TOKEN_PROGRAM_ID);
}

async function tokenBalance(conn: Connection, account: PublicKey, commitment: typeof COMMITMENT | typeof FINALIZED = COMMITMENT): Promise<bigint> {
  const info = await conn.getAccountInfo(account, commitment);
  if (!info) return 0n;
  const { value } = await conn.getTokenAccountBalance(account, commitment);
  return BigInt(value.amount);
}

async function solBalance(conn: Connection, pk: PublicKey): Promise<number> {
  return conn.getBalance(pk, COMMITMENT);
}

async function clusterNow(conn: Connection): Promise<bigint> {
  const slot = await conn.getSlot(COMMITMENT);
  const blockTime = await conn.getBlockTime(slot);
  if (blockTime === null) throw new Error(`no cluster block time at slot ${slot}`);
  return BigInt(blockTime);
}

async function waitPast(conn: Connection, expiresAt: bigint, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await clusterNow(conn)) >= expiresAt) return;
    await sleep(3_000);
  }
  throw new Error(`cluster block time never reached ${expiresAt} within ${timeoutMs}ms`);
}

/**
 * Build the pay instruction, sign + send it with skipPreflight so a program
 * rejection is RECORDED ON-CHAIN, then read back the transaction and map the
 * recorded meta.err. Returns the signature + mapped error name.
 */
async function sendFailingPay(
  conn: Connection,
  programId: PublicKey,
  payer: Keypair,
  invoicePda: PublicKey,
  invoice: Invoice,
  amount: bigint,
): Promise<{ signature: string; errorName: string | undefined; mapped?: string }> {
  const ix = await buildPayInvoiceIx(
    {
      payer: payer.publicKey,
      invoicePda,
      mint: invoice.mint,
      amount,
      expectedAmountDue: invoice.amountDue,
    },
    programId,
    conn,
  );
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash(COMMITMENT)).blockhash;
  tx.sign(payer);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  // Wait for the (failed) transaction to be recorded on-chain.
  const started = Date.now();
  let meta: { err: unknown; confirmationStatus?: string } | null = null;
  while (Date.now() - started < 60_000) {
    const res = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = res.value?.[0];
    if (status && status.confirmationStatus) {
      meta = { err: status.err, confirmationStatus: status.confirmationStatus };
      break;
    }
    await sleep(1_000);
  }
  const txInfo = await conn.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const metaErr = txInfo?.meta?.err ?? meta?.err ?? null;
  const mapped = mapFailureMetaErr(metaErr);
  return { signature, errorName: mapped?.name, mapped: mapped?.name };
}

// ---------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------

interface SanityResult {
  ok: boolean;
  lines: { label: string; ok: boolean; detail: string }[];
}

async function runSanity(conn: Connection, config: ResolvedConfig): Promise<SanityResult> {
  const lines: SanityResult['lines'] = [];
  const programId = new PublicKey(config.programId);
  const configPda = new PublicKey(config.configPda);
  const usdcMint = new PublicKey(config.usdcMint);

  const programInfo = await conn.getAccountInfo(programId, COMMITMENT);
  lines.push({
    label: 'program account exists and is executable',
    ok: !!programInfo && programInfo.executable,
    detail: programInfo ? `executable=${programInfo.executable}` : 'account not found',
  });

  const [derivedConfig] = getConfigPda(programId);
  lines.push({
    label: 'derived config PDA matches the recorded config PDA',
    ok: derivedConfig.equals(configPda),
    detail: `derived=${derivedConfig.toBase58()} recorded=${configPda.toBase58()}`,
  });

  let configMintOk = false;
  let configMintDetail = 'config not fetched';
  try {
    const onchainConfig = await new PaytruthClient({ connection: conn, programId }).fetchConfig(COMMITMENT);
    configMintOk = onchainConfig.usdcMint.equals(usdcMint);
    configMintDetail = `config.usdcMint=${onchainConfig.usdcMint.toBase58()}`;
  } catch (err) {
    configMintDetail = `fetchConfig failed: ${(err as Error).message}`;
  }
  lines.push({ label: 'config.usdcMint equals the configured mint', ok: configMintOk, detail: configMintDetail });

  const mintInfo = await conn.getAccountInfo(usdcMint, COMMITMENT);
  let mintOk = false;
  let mintDetail = 'mint account not found';
  if (mintInfo) {
    const ownerOk = mintInfo.owner.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
    const decimals = mintInfo.data.length > 44 ? mintInfo.data[44] : -1;
    mintOk = ownerOk && decimals === USDC_DECIMALS;
    mintDetail = `owner=${mintInfo.owner.toBase58()} decimals=${decimals}`;
  }
  lines.push({ label: 'mint owner is classic Token program and decimals == 6', ok: mintOk, detail: mintDetail });

  const ok = lines.every((l) => l.ok);
  return { ok, lines };
}

// ---------------------------------------------------------------------------
// --check mode
// ---------------------------------------------------------------------------

interface FundingRow {
  role: string;
  pubkey: string;
  sol: number;
  usdc: bigint;
  requiredSol: number;
  requiredUsdc: bigint;
  ok: boolean;
}

async function checkMode(
  conn: Connection,
  config: ResolvedConfig,
  deployment: DevnetDeployment,
  sanity: SanityResult,
  merchant: Keypair,
  payer: Keypair,
  needs: { payer: bigint; merchant: bigint },
): Promise<boolean> {
  const usdcMint = new PublicKey(deployment.usdcMint);

  const rows: FundingRow[] = [];
  const merchantAta = ata(merchant.publicKey, usdcMint);
  const payerAta = ata(payer.publicKey, usdcMint);

  const merchantUsdc = await tokenBalance(conn, merchantAta);
  const payerUsdc = await tokenBalance(conn, payerAta);
  const merchantSol = await solBalance(conn, merchant.publicKey);
  const payerSol = await solBalance(conn, payer.publicKey);

  rows.push({
    role: 'merchant',
    pubkey: merchant.publicKey.toBase58(),
    sol: merchantSol,
    usdc: merchantUsdc,
    requiredSol: DEVNET_SOL_NEEDS.merchant,
    requiredUsdc: needs.merchant,
    ok: merchantSol >= DEVNET_SOL_NEEDS.merchant && merchantUsdc >= needs.merchant,
  });
  rows.push({
    role: 'payer',
    pubkey: payer.publicKey.toBase58(),
    sol: payerSol,
    usdc: payerUsdc,
    requiredSol: DEVNET_SOL_NEEDS.payer,
    requiredUsdc: needs.payer,
    ok: payerSol >= DEVNET_SOL_NEEDS.payer && payerUsdc >= needs.payer,
  });

  console.log('\nResolved configuration:');
  console.log(`  RPC             ${config.rpcUrl}`);
  console.log(`  Program ID      ${config.programId}`);
  console.log(`  Config PDA      ${config.configPda}`);
  console.log(`  USDC mint       ${config.usdcMint}`);

  console.log('\nSanity checks:');
  for (const line of sanity.lines) {
    console.log(`  [${line.ok ? 'PASS' : 'FAIL'}] ${line.label} — ${line.detail}`);
  }

  console.log('\nFunding:');
  printFundingTable(rows);

  if (!sanity.ok) {
    console.log('\nSanity checks FAILED — funding is irrelevant; fix the configuration/config account first.');
  } else if (rows.every((r) => r.ok)) {
    console.log('\nAll roles are funded. Ready to run: pnpm devnet:demo');
  } else {
    console.log('\nSome roles NEED FUNDING (see table). `--check` still exits 0.');
  }
  return sanity.ok;
}

function printFundingTable(rows: FundingRow[]): void {
  const header = ['role', 'pubkey', 'SOL', 'USDC', 'reqSOL', 'reqUSDC', 'status'];
  const data = rows.map((r) => [
    r.role,
    r.pubkey,
    (r.sol / LAMPORTS_PER_SOL).toFixed(4),
    formatUsdc(r.usdc),
    (r.requiredSol / LAMPORTS_PER_SOL).toFixed(2),
    formatUsdc(r.requiredUsdc),
    r.ok ? 'OK' : 'NEEDS FUNDING',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((row) => row[i]!.length)));
  const fmt = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log('  ' + fmt(header));
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of data) console.log('  ' + fmt(row));
}

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

async function ensureUsdcOrAbort(
  conn: Connection,
  usdcMint: PublicKey,
  payer: Keypair,
  need: bigint,
  waitSeconds: number,
): Promise<void> {
  const payerAta = ata(payer.publicKey, usdcMint);
  const result = await ensureUsdcBalance({
    need,
    waitSeconds,
    getBalance: () => tokenBalance(conn, payerAta),
    pollMs: WAIT_USDC_POLL_MS,
  });
  if (!result.ok) {
    throw new Error(`Insufficient payer USDC before a payment step: ${result.reason}`);
  }
}

async function runDemo(
  conn: Connection,
  config: ResolvedConfig,
  amounts: Amounts,
  client: {
    merchant: PaytruthClient;
    payer: PaytruthClient;
    observer: PaytruthClient;
  },
  merchant: Keypair,
  payer: Keypair,
  cli: Cli,
): Promise<{ ok: boolean; invoices: Report['invoices'] }> {
  const usdcMint = new PublicKey(config.usdcMint);
  const programId = new PublicKey(config.programId);
  const merchantAta = ata(merchant.publicKey, usdcMint);
  const payerAta = ata(payer.publicKey, usdcMint);
  const base = invoiceIdBase(Date.now());
  const idA = base + 1n;
  const idB = base + 5n;
  const idC = base + 6n;

  const invoices: Report['invoices'] = {};
  const shouldRun = (step: number): boolean => {
    if (cli.step !== null) return cli.step === step;
    if (cli.from !== null) return step >= cli.from;
    return true;
  };

  // Track steps 1-3 results so later steps can depend on them when skipped.
  let pdaA: PublicKey | null = null;
  let amountDueA: bigint = amounts.step2Due;

  // ---- Step 1 ----
  if (shouldRun(1)) {
    const t = new AssertionTracker(1, 'Merchant creates invoice A');
    const expiresAt = (await clusterNow(conn)) + 3_600n;
    const { signature, invoicePda } = await client.merchant.createInvoice({
      invoiceId: idA,
      amountDue: amounts.step2Due,
      expiresAt,
      memo: 'Paytruth demo step 1',
    });
    record(1, 'createInvoice A', signature, 'ok');
    pdaA = invoicePda;
    amountDueA = amounts.step2Due;

    const inv = await client.observer.fetchInvoice(invoicePda, COMMITMENT);
    t.check('invoice A is Open on-chain', inv.status === InvoiceStatus.Open, `status=${InvoiceStatus[inv.status]}`);
    t.check('invoice A amount_due matches', inv.amountDue === amounts.step2Due, `amountDue=${inv.amountDue}`);
    const escrowAta = getEscrowAta(invoicePda, usdcMint);
    const escrowInfo = await conn.getAccountInfo(escrowAta, COMMITMENT);
    t.check('escrow ATA exists', escrowInfo !== null, escrowAta.toBase58());
    t.check('escrow ATA balance is 0', (await client.observer.fetchEscrowBalance(invoicePda, usdcMint)) === 0n);
    t.finish();
    invoices.A = invoicePda.toBase58();
  }

  // ---- Step 2 ----
  if (shouldRun(2)) {
    const t = new AssertionTracker(2, 'Payer pays A exact');
    if (!pdaA) {
      // Running --step 2 / --from 2 without step 1: create A now.
      const expiresAt = (await clusterNow(conn)) + 3_600n;
      const created = await client.merchant.createInvoice({
        invoiceId: idA,
        amountDue: amounts.step2Due,
        expiresAt,
        memo: 'Paytruth demo step 1',
      });
      record(2, 'createInvoice A (prerequisite)', created.signature, 'ok');
      pdaA = created.invoicePda;
      amountDueA = amounts.step2Due;
      invoices.A = pdaA.toBase58();
    }
    await ensureUsdcOrAbort(conn, usdcMint, payer, amounts.step2Due, cli.waitUsdc);

    const before = await client.observer.fetchInvoice(pdaA, COMMITMENT);
    const payerBefore = await tokenBalance(conn, payerAta);
    const { signature } = await client.payer.payInvoice({
      invoicePda: pdaA,
      amount: before.amountDue,
      expectedAmountDue: before.amountDue,
    });
    record(2, 'payInvoice A exact', signature, 'ok');

    const inv = await client.observer.waitForInvoiceState(
      pdaA,
      (i) => i.status === InvoiceStatus.Paid,
      { commitment: COMMITMENT, timeoutMs: 60_000 },
    );
    t.check('invoice A is Paid', inv.status === InvoiceStatus.Paid);
    t.check('paid_amount == due', inv.paidAmount === before.amountDue, `paid=${inv.paidAmount} due=${before.amountDue}`);
    t.check('payer recorded', inv.payer.equals(payer.publicKey), inv.payer.toBase58());
    t.check('escrow balance == due', (await client.observer.fetchEscrowBalance(pdaA, usdcMint)) === before.amountDue);
    t.check('payer balance decreased by due', (await tokenBalance(conn, payerAta)) === payerBefore - before.amountDue);
    t.finish();
  }

  // ---- Step 3 ----
  if (shouldRun(3)) {
    const t = new AssertionTracker(3, 'Merchant claims A');
    if (!pdaA) throw new StepFailure('step 3 requires invoice A (run step 1/2 first, or use --from 1)');
    const due = (await client.observer.fetchInvoice(pdaA, COMMITMENT)).amountDue;
    const merchantBefore = await tokenBalance(conn, merchantAta);
    const { signature } = await client.merchant.merchantClaim({ invoicePda: pdaA });
    record(3, 'merchantClaim A', signature, 'ok');

    const inv = await client.observer.waitForInvoiceState(pdaA, (i) => i.claimed, {
      commitment: FINALIZED,
      timeoutMs: FINALIZED_TIMEOUT_MS,
    });
    t.check('invoice A claimed', inv.claimed);
    t.check('merchant USDC increased by due', (await tokenBalance(conn, merchantAta)) === merchantBefore + due);
    t.check('escrow A empty', (await client.observer.fetchEscrowBalance(pdaA, usdcMint)) === 0n);
    t.finish();
  }

  // ---- Step 4 ----
  if (shouldRun(4)) {
    const t = new AssertionTracker(4, 'Payer attempts a duplicate payment on A');
    if (!pdaA) throw new StepFailure('step 4 requires invoice A');
    await ensureUsdcOrAbort(conn, usdcMint, payer, 0n, cli.waitUsdc);
    const before = await client.observer.fetchInvoice(pdaA, COMMITMENT);
    const payerBefore = await tokenBalance(conn, payerAta);

    const { signature, errorName } = await sendFailingPay(conn, programId, payer, pdaA, before, before.amountDue);
    record(4, 'duplicate payInvoice A', signature, 'expected-failure', errorName);
    t.check('recorded on-chain duplicate pay failed', !!errorName);
    t.check('failure maps to DuplicatePayment', errorName === 'DuplicatePayment', errorName ?? 'no error recorded');

    const after = await client.observer.fetchInvoice(pdaA, COMMITMENT);
    t.check('invoice state unchanged', after.status === before.status && after.paidAmount === before.paidAmount && after.claimed === before.claimed);
    t.check('payer balance unchanged', (await tokenBalance(conn, payerAta)) === payerBefore);
    t.finish();
  }

  // ---- Step 5 ----
  if (shouldRun(5)) {
    const t = new AssertionTracker(5, 'Overpayment on invoice B is refunded');
    await ensureUsdcOrAbort(conn, usdcMint, payer, amounts.step5Pay, cli.waitUsdc);
    const expiresAt = (await clusterNow(conn)) + 3_600n;
    const created = await client.merchant.createInvoice({
      invoiceId: idB,
      amountDue: amounts.step5Due,
      expiresAt,
      memo: 'Paytruth demo step 5',
    });
    record(5, 'createInvoice B', created.signature, 'ok');
    const pdaB = created.invoicePda;
    invoices.B = pdaB.toBase58();

    const payerBefore = await tokenBalance(conn, payerAta);
    const paySig = await client.payer.payInvoice({
      invoicePda: pdaB,
      amount: amounts.step5Pay,
      expectedAmountDue: amounts.step5Due,
    });
    record(5, 'payInvoice B (overpay)', paySig.signature, 'ok');

    const paid = await client.observer.waitForInvoiceState(pdaB, (i) => i.status === InvoiceStatus.Paid, {
      commitment: COMMITMENT,
      timeoutMs: 60_000,
    });
    const excess = amounts.step5Pay - amounts.step5Due;
    t.check('invoice B is Paid with excess', paid.status === InvoiceStatus.Paid && paid.paidAmount === amounts.step5Pay, `paid=${paid.paidAmount}`);

    const refundSig = await client.payer.refundOverpayment({ invoicePda: pdaB });
    record(5, 'refundOverpayment B', refundSig.signature, 'ok');

    const refunded = await client.observer.waitForInvoiceState(pdaB, (i) => i.refundedExcess > 0n, {
      commitment: COMMITMENT,
      timeoutMs: 60_000,
    });
    t.check('refunded_excess == excess', refunded.refundedExcess === excess, `refunded=${refunded.refundedExcess} excess=${excess}`);
    t.check('payer balance restored to before - due', (await tokenBalance(conn, payerAta)) === payerBefore - amounts.step5Due);

    const claimSig = await client.merchant.merchantClaim({ invoicePda: pdaB });
    record(5, 'merchantClaim B', claimSig.signature, 'ok');
    const claimed = await client.observer.waitForInvoiceState(pdaB, (i) => i.claimed, {
      commitment: FINALIZED,
      timeoutMs: FINALIZED_TIMEOUT_MS,
    });
    t.check('invoice B claimed (clean)', claimed.claimed);
    t.finish();
  }

  // ---- Step 6 ----
  if (shouldRun(6)) {
    const t = new AssertionTracker(6, 'Expired invoice C, failed pay, expire and close');
    await ensureUsdcOrAbort(conn, usdcMint, payer, 0n, cli.waitUsdc);
    const expiresAt = (await clusterNow(conn)) + 30n;
    const created = await client.merchant.createInvoice({
      invoiceId: idC,
      amountDue: amounts.step6Due,
      expiresAt,
      memo: 'Paytruth demo step 6',
    });
    record(6, 'createInvoice C', created.signature, 'ok');
    const pdaC = created.invoicePda;
    invoices.C = pdaC.toBase58();

    await waitPast(conn, expiresAt, 120_000);

    const beforePay = await client.observer.fetchInvoice(pdaC, COMMITMENT);
    const { signature: failSig, errorName } = await sendFailingPay(conn, programId, payer, pdaC, beforePay, beforePay.amountDue);
    record(6, 'payInvoice C (expired)', failSig, 'expected-failure', errorName);
    t.check('recorded on-chain expired pay failed', !!errorName);
    t.check('failure maps to InvoiceExpired', errorName === 'InvoiceExpired', errorName ?? 'no error recorded');
    t.check('invoice C still Open after failed pay', (await client.observer.fetchInvoice(pdaC, COMMITMENT)).status === InvoiceStatus.Open);

    const expireSig = await client.payer.expireInvoice({ invoicePda: pdaC });
    record(6, 'expireInvoice C', expireSig.signature, 'ok');
    const expired = await client.observer.waitForInvoiceState(pdaC, (i) => i.status === InvoiceStatus.Expired, {
      commitment: COMMITMENT,
      timeoutMs: 60_000,
    });
    t.check('invoice C is Expired', expired.status === InvoiceStatus.Expired);

    const closeSig = await client.merchant.closeInvoice({ invoicePda: pdaC });
    record(6, 'closeInvoice C', closeSig.signature, 'ok');
    await client.observer.waitForInvoiceState(pdaC, (i) => i.status === InvoiceStatus.Closed, {
      commitment: COMMITMENT,
      timeoutMs: 60_000,
    });
    t.check('invoice C account remains (Closed tombstone)', (await conn.getAccountInfo(pdaC, COMMITMENT)) !== null);
    t.check('escrow ATA closed', (await conn.getAccountInfo(getEscrowAta(pdaC, usdcMint), COMMITMENT)) === null);
    t.finish();
  }

  // ---- Step 7 ----
  if (shouldRun(7)) {
    const t = new AssertionTracker(7, 'Independent observer verifies A, B and C (no wallet)');
    const observer = client.observer; // constructed with no wallet
    const readOne = async (label: string, pda: PublicKey | null, expect: InvoiceStatus, extra?: (inv: Invoice) => boolean) => {
      if (!pda) {
        t.check(`invoice ${label} available to verify`, false, 'not created in this run');
        return;
      }
      const inv = await observer.fetchInvoice(pda, FINALIZED);
      const balance = await observer.fetchEscrowBalance(pda, usdcMint);
      invoices[label] = pda.toBase58();
      t.check(`invoice ${label} status ${InvoiceStatus[expect]}`, inv.status === expect, `status=${InvoiceStatus[inv.status]} escrow=${balance}`);
      if (extra) t.check(`invoice ${label} fields`, extra(inv));
      console.log(`  verify page: /verify/${pda.toBase58()}`);
    };
    const invoiceA = pdaA ?? (invoices.A ? new PublicKey(invoices.A) : null);
    const invoiceB = invoices.B ? new PublicKey(invoices.B) : null;
    const invoiceC = invoices.C ? new PublicKey(invoices.C) : null;
    await readOne('A', invoiceA, InvoiceStatus.Paid, (inv) => inv.claimed);
    await readOne('B', invoiceB, InvoiceStatus.Paid, (inv) => inv.claimed && inv.refundedExcess === amounts.step5Pay - amounts.step5Due);
    await readOne('C', invoiceC, InvoiceStatus.Closed);
    t.finish();
  }

  const ok = stepReports.every((s) => s.ok);
  return { ok, invoices };
}

// ---------------------------------------------------------------------------
// Report writing
// ---------------------------------------------------------------------------

function buildReport(
  config: ResolvedConfig,
  amounts: Amounts,
  invoices: Report['invoices'],
  startedAt: Date,
): Report {
  const finishedAt = new Date();
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    startedAtWat: formatWat(startedAt),
    finishedAtWat: formatWat(finishedAt),
    rpcUrl: config.rpcUrl,
    programId: config.programId,
    configPda: config.configPda,
    usdcMint: config.usdcMint,
    amounts: {
      step2Due: amounts.step2Due.toString(),
      step5Due: amounts.step5Due.toString(),
      step5Pay: amounts.step5Pay.toString(),
      step6Due: amounts.step6Due.toString(),
    },
    steps: stepReports,
    transactions,
    invoices,
    ok: stepReports.every((s) => s.ok) && transactions.every((t) => t.result === 'ok' || t.result === 'expected-failure'),
  };
}

function writeReport(report: Report): { jsonPath: string; mdPath: string } {
  const dir = join(resolveRepoRoot(), 'sdk', '.devnet-runs');
  mkdirSync(dir, { recursive: true });
  const stamp = reportTimestamp(new Date(report.finishedAt));
  const jsonPath = join(dir, `${stamp}.json`);
  const mdPath = join(dir, `${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines: string[] = [];
  lines.push(`# Paytruth devnet demo run`);
  lines.push('');
  lines.push(`- Started: ${report.startedAtWat} (${report.startedAt})`);
  lines.push(`- Finished: ${report.finishedAtWat} (${report.finishedAt})`);
  lines.push(`- RPC: ${report.rpcUrl}`);
  lines.push(`- Program: ${report.programId}`);
  lines.push(`- Config PDA: ${report.configPda}`);
  lines.push(`- USDC mint: ${report.usdcMint}`);
  lines.push(`- Overall: ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('| Step | Title | Result |');
  lines.push('|---|---|---|');
  for (const s of report.steps) lines.push(`| ${s.step} | ${s.title} | ${s.ok ? 'PASS' : 'FAIL'} |`);
  for (const s of report.steps) {
    lines.push('');
    lines.push(`### Step ${s.step}: ${s.title}`);
    for (const a of s.assertions) lines.push(`- ${a.ok ? 'PASS' : 'FAIL'} ${a.label}${a.detail ? ` — ${a.detail}` : ''}`);
  }
  lines.push('');
  lines.push('## Transactions');
  lines.push('');
  lines.push('| Step | Label | Signature | Result |');
  lines.push('|---|---|---|---|');
  for (const tx of report.transactions) {
    const result = tx.result === 'ok' ? 'ok' : `expected-failure (${tx.errorName ?? 'unknown'})`;
    lines.push(`| ${tx.step} | ${tx.label} | [${tx.signature}](${tx.explorer}) | ${result} |`);
  }
  lines.push('');
  lines.push('## Verify pages');
  lines.push('');
  for (const [k, pda] of Object.entries(report.invoices)) lines.push(`- Invoice ${k}: /verify/${pda}`);
  lines.push('');
  writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const env = process.env;

  const deployment = loadDevnetDeployment();
  const config = resolveConfig(deployment, env);
  const amounts = amountsFromEnv(env);
  const needs = usdcNeeds(amounts);

  const merchantPath = env.PAYTRUTH_MERCHANT_KEYPAIR;
  const payerPath = env.PAYTRUTH_PAYER_KEYPAIR;
  if (!merchantPath || !payerPath) {
    throw new Error('PAYTRUTH_MERCHANT_KEYPAIR and PAYTRUTH_PAYER_KEYPAIR must both be set (paths to solana-keygen JSON, outside the repo).');
  }
  const repoRoot = resolveRepoRoot();
  const merchant = loadKeypair(merchantPath, repoRoot);
  const payer = loadKeypair(payerPath, repoRoot);

  console.log(`Paytruth devnet runner`);
  console.log(`  RPC:      ${config.rpcUrl}`);
  console.log(`  merchant: ${merchant.publicKey.toBase58()}`);
  console.log(`  payer:    ${payer.publicKey.toBase58()}`);

  const conn = new Connection(config.rpcUrl, COMMITMENT);
  await assertDevnetGenesis(conn);

  const sanity = await runSanity(conn, config);
  if (!sanity.ok) {
    console.log('\nSanity checks FAILED:');
    for (const line of sanity.lines) console.log(`  [${line.ok ? 'PASS' : 'FAIL'}] ${line.label} — ${line.detail}`);
    if (cli.check) {
      // --check exits 0 even on sanity failure, but says so loudly.
      process.exitCode = 0;
      return;
    }
    throw new Error('Sanity checks failed; aborting before any transaction.');
  }

  if (cli.check) {
    await checkMode(conn, config, deployment, sanity, merchant, payer, needs);
    return;
  }

  const programId = new PublicKey(config.programId);
  const usdcMint = new PublicKey(config.usdcMint);

  // Pre-flight funding check (SOL) so we abort before spending anything.
  const merchantSol = await solBalance(conn, merchant.publicKey);
  const payerSol = await solBalance(conn, payer.publicKey);
  if (merchantSol < DEVNET_SOL_NEEDS.merchant) {
    throw new Error(`Merchant ${merchant.publicKey.toBase58()} needs at least ${DEVNET_SOL_NEEDS.merchant / LAMPORTS_PER_SOL} SOL (has ${(merchantSol / LAMPORTS_PER_SOL).toFixed(4)}).`);
  }
  if (payerSol < DEVNET_SOL_NEEDS.payer) {
    throw new Error(`Payer ${payer.publicKey.toBase58()} needs at least ${DEVNET_SOL_NEEDS.payer / LAMPORTS_PER_SOL} SOL (has ${(payerSol / LAMPORTS_PER_SOL).toFixed(4)}).`);
  }

  const client = {
    merchant: new PaytruthClient({ connection: conn, wallet: keypairWallet(merchant), programId }),
    payer: new PaytruthClient({ connection: conn, wallet: keypairWallet(payer), programId }),
    observer: new PaytruthClient({ connection: conn, programId }),
  };

  const { ok, invoices } = await runDemo(conn, config, amounts, client, merchant, payer, cli);

  const report = buildReport(config, amounts, invoices, startedAt);
  report.ok = ok && report.ok;
  const { jsonPath, mdPath } = writeReport(report);

  console.log('\n=== devnet demo summary ===');
  for (const s of stepReports) console.log(`  step ${s.step} ${s.ok ? 'PASS' : 'FAIL'} — ${s.title}`);
  console.log(`  overall: ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`  started:  ${report.startedAtWat}`);
  console.log(`  finished: ${report.finishedAtWat}`);
  console.log(`  report:   ${jsonPath}`);
  console.log(`  summary:  ${mdPath}`);

  if (!report.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
