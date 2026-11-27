/**
 * Pure, unit-testable logic for the devnet demo runner.
 *
 * Nothing here performs network I/O on import; every RPC-touching function
 * takes an injected dependency (a `Connection`, a balance getter, ...) so the
 * whole module is testable with mocks and never sends a transaction by itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import { USDC_DECIMALS } from '../../src/constants';
import { mapError, type MappedError } from '../../src/errors';

/** Devnet genesis hash; the runner aborts unless getGenesisHash() matches. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';

/** USDC base units per whole token (6 decimals). */
const ONE_USDC = 10n ** BigInt(USDC_DECIMALS);

export interface Amounts {
  step2Due: bigint;
  step5Due: bigint;
  step5Pay: bigint;
  step6Due: bigint;
}

export const DEFAULT_AMOUNTS: Amounts = {
  step2Due: 1_000_000n,
  step5Due: 1_000_000n,
  step5Pay: 1_500_000n,
  step6Due: 1_000_000n,
};

/** Minimum SOL (lamports) each role must hold to pay rent and fees. */
export const DEVNET_SOL_NEEDS = {
  merchant: 50_000_000, // 0.05 SOL
  payer: 10_000_000, // 0.01 SOL
} as const;

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

function envAmount(env: NodeJS.ProcessEnv, key: string, fallback: bigint): bigint {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${key} must be a non-negative integer (USDC base units), got ${JSON.stringify(raw)}`);
  return BigInt(raw.trim());
}

/** Read the four amounts from env, falling back to the documented defaults. */
export function amountsFromEnv(env: NodeJS.ProcessEnv = process.env): Amounts {
  return {
    step2Due: envAmount(env, 'STEP2_DUE', DEFAULT_AMOUNTS.step2Due),
    step5Due: envAmount(env, 'STEP5_DUE', DEFAULT_AMOUNTS.step5Due),
    step5Pay: envAmount(env, 'STEP5_PAY', DEFAULT_AMOUNTS.step5Pay),
    step6Due: envAmount(env, 'STEP6_DUE', DEFAULT_AMOUNTS.step6Due),
  };
}

export interface UsdcNeeds {
  payer: bigint;
  merchant: bigint;
}

/**
 * Per-wallet USDC (base units) required.
 *
 * The payer's peak balance is step 2's exact payment plus step 5's overpayment,
 * because step 5's refund returns the excess before step 6. Step 4 (duplicate)
 * and step 6 (expired) are rejected before any transfer, so they need no extra
 * USDC — only the payer's ATA must exist. The merchant never needs USDC.
 */
export function usdcNeeds(amounts: Amounts): UsdcNeeds {
  return { payer: amounts.step2Due + amounts.step5Pay, merchant: 0n };
}

/** Format a USDC base-unit amount as a fixed 6-decimal string. */
export function formatUsdc(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? '-' : '';
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / ONE_USDC;
  const frac = (abs % ONE_USDC).toString().padStart(USDC_DECIMALS, '0');
  return `${sign}${whole}.${frac}`;
}

export const ONE_USDC_BASE_UNITS = ONE_USDC;

// ---------------------------------------------------------------------------
// DEPLOYMENTS.md parser
// ---------------------------------------------------------------------------

export interface DevnetDeployment {
  programId: string;
  configPda: string;
  usdcMint: string;
}

/** The repo root: sdk/scripts/devnet/lib.ts -> dirname = devnet, up 3 to the repo root. */
export function resolveRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..');
}

export function resolveDeploymentsPath(): string {
  return resolve(resolveRepoRoot(), 'programs', 'DEPLOYMENTS.md');
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function backticks(cell: string): string | null {
  const m = /`([^`]+)`/.exec(cell);
  return m ? m[1]!.trim() : null;
}

/**
 * Parse the devnet row from the deployments markdown. The row is the one whose
 * Cluster cell is exactly `devnet`; values are the backticked tokens in the
 * Program ID / Config PDA / USDC mint cells.
 */
export function parseDevnetDeployment(markdown: string): DevnetDeployment {
  const lines = markdown.split(/\r?\n/);
  let headerIndex = -1;
  let header: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i]!);
    if (cells[0] === 'Cluster' && cells.some((c) => /Program ID/i.test(c))) {
      headerIndex = i;
      header = cells;
      break;
    }
  }
  if (headerIndex === -1) throw new Error('DEPLOYMENTS.md: could not find the deployments table header.');

  const col = (re: RegExp): number => header.findIndex((h) => re.test(h));
  const programCol = col(/Program ID/i);
  const configCol = col(/Config PDA/i);
  const mintCol = col(/USDC ?mint/i);
  if (programCol === -1) throw new Error('DEPLOYMENTS.md: table has no "Program ID" column.');
  if (configCol === -1) throw new Error('DEPLOYMENTS.md: table has no "Config PDA" column.');
  if (mintCol === -1) throw new Error('DEPLOYMENTS.md: table has no "USDC mint" column.');

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim().startsWith('|')) {
      if (headerIndex !== -1 && line.trim() === '' && i > headerIndex + 2) break;
      continue;
    }
    const cells = splitRow(line);
    if (cells[0] !== 'devnet') continue;
    const programId = backticks(cells[programCol] ?? '');
    const configPda = backticks(cells[configCol] ?? '');
    const usdcMint = backticks(cells[mintCol] ?? '');
    if (!programId) throw new Error('DEPLOYMENTS.md: devnet row is missing a backticked Program ID.');
    if (!configPda) throw new Error('DEPLOYMENTS.md: devnet row is missing a backticked Config PDA.');
    if (!usdcMint) throw new Error('DEPLOYMENTS.md: devnet row is missing a backticked USDC mint.');
    return { programId, configPda, usdcMint };
  }
  throw new Error('DEPLOYMENTS.md: no row with cluster cell exactly `devnet` was found.');
}

/** Read + parse the on-disk DEPLOYMENTS.md (default path resolved from this file). */
export function loadDevnetDeployment(path: string = resolveDeploymentsPath()): DevnetDeployment {
  if (!existsSync(path)) throw new Error(`DEPLOYMENTS.md not found at ${path}`);
  return parseDevnetDeployment(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export interface ResolvedConfig extends DevnetDeployment {
  rpcUrl: string;
}

/** Apply PAYTRUTH_* overrides on top of the parsed deployment. */
export function resolveEnvConfig(parsed: DevnetDeployment, env: NodeJS.ProcessEnv): DevnetDeployment {
  return {
    programId: env.PAYTRUTH_PROGRAM_ID?.trim() || parsed.programId,
    configPda: env.PAYTRUTH_CONFIG_PDA?.trim() || parsed.configPda,
    usdcMint: env.PAYTRUTH_USDC_MINT?.trim() || parsed.usdcMint,
  };
}

/** Resolve the RPC URL from env, refusing any URL that contains "mainnet". */
export function resolveRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PAYTRUTH_DEVNET_RPC?.trim() || DEFAULT_DEVNET_RPC;
  if (/mainnet/i.test(raw)) {
    throw new Error(`Refusing a mainnet RPC URL: ${raw}. The devnet runner only talks to devnet.`);
  }
  return raw;
}

export function resolveConfig(parsed: DevnetDeployment, env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  return { ...resolveEnvConfig(parsed, env), rpcUrl: resolveRpcUrl(env) };
}

// ---------------------------------------------------------------------------
// Genesis guard
// ---------------------------------------------------------------------------

export async function assertDevnetGenesis(connection: Connection): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `Refusing to run: genesis hash ${genesis} is not devnet (${DEVNET_GENESIS_HASH}).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Keypair path safety
// ---------------------------------------------------------------------------

/** Whether `target` resolves to a path at or below `root`. */
export function isInsideRepo(target: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  if (rel === '') return true;
  if (rel === '..') return false;
  if (rel.startsWith(`..${sep}`)) return false;
  return !isAbsolute(rel);
}

/**
 * Load a solana-keygen JSON keypair from a path outside the repo.
 * Refuses any path inside the repo; only the public key is ever surfaced.
 */
export function loadKeypair(path: string, repoRoot: string = resolveRepoRoot()): Keypair {
  const resolved = resolve(path);
  if (isInsideRepo(resolved, repoRoot)) {
    throw new Error(
      `Refusing to load a keypair from inside the git repo (${resolved}). Keep keypairs outside the repo.`,
    );
  }
  if (!existsSync(resolved)) throw new Error(`Keypair file not found: ${resolved}`);
  let secret: number[];
  try {
    secret = JSON.parse(readFileSync(resolved, 'utf8')) as number[];
  } catch {
    throw new Error(`Keypair file is not valid JSON: ${resolved}`);
  }
  if (!Array.isArray(secret)) throw new Error(`Keypair file is not a JSON byte array: ${resolved}`);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// ---------------------------------------------------------------------------
// USDC wait logic
// ---------------------------------------------------------------------------

export type BalanceGetter = () => Promise<bigint>;

export interface UsdcWaitInput {
  need: bigint;
  current: bigint;
  getBalance: BalanceGetter;
  /** Interval between balance polls. */
  pollMs: number;
  /** Maximum time to poll. 0 disables waiting entirely. */
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type UsdcWaitResult =
  | { ok: true; balance: bigint }
  | { ok: false; balance: bigint; shortfall: bigint; reason: string };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shortfallMessage(need: bigint, have: bigint): string {
  const shortfall = need - have;
  return `payer USDC balance ${formatUsdc(have)} is below the required ${formatUsdc(need)} (short by ${formatUsdc(shortfall)} = ${shortfall.toString()} base units).`;
}

/**
 * Poll the payer's USDC balance until it reaches `need` or the bound expires.
 * Aborts immediately (no polling) when timeoutMs is 0.
 */
export async function resolveUsdcWait(input: UsdcWaitInput): Promise<UsdcWaitResult> {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;

  if (input.current >= input.need) return { ok: true, balance: input.current };

  if (input.timeoutMs <= 0) {
    return { ok: false, balance: input.current, shortfall: input.need - input.current, reason: shortfallMessage(input.need, input.current) };
  }

  const started = now();
  let balance = input.current;
  for (;;) {
    if (balance >= input.need) return { ok: true, balance };
    if (now() - started >= input.timeoutMs) {
      return { ok: false, balance, shortfall: input.need - balance, reason: `${shortfallMessage(input.need, balance)} Timed out waiting for USDC.` };
    }
    await sleep(input.pollMs);
    balance = await input.getBalance();
  }
}

export interface EnsureUsdcInput {
  need: bigint;
  /** Seconds to wait for the balance to rise; 0 aborts on the first check. */
  waitSeconds: number;
  getBalance: BalanceGetter;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Read the live balance, then run resolveUsdcWait with the given bound. */
export async function ensureUsdcBalance(input: EnsureUsdcInput): Promise<UsdcWaitResult> {
  const current = await input.getBalance();
  if (current >= input.need) return { ok: true, balance: current };
  return resolveUsdcWait({
    need: input.need,
    current,
    getBalance: input.getBalance,
    pollMs: input.pollMs ?? 10_000,
    timeoutMs: Math.max(0, input.waitSeconds) * 1000,
    sleep: input.sleep,
    now: input.now,
  });
}

// ---------------------------------------------------------------------------
// Failed-transaction error mapping
// ---------------------------------------------------------------------------

interface InstructionErrorLike {
  InstructionError?: [number, unknown];
}

/** Pull a program `Custom` code out of a transaction meta.err, if present. */
export function extractCustomCode(metaErr: unknown): number | null {
  if (!metaErr || typeof metaErr !== 'object') return null;
  const ie = (metaErr as InstructionErrorLike).InstructionError;
  if (!Array.isArray(ie) || ie.length !== 2) return null;
  const detail = ie[1];
  if (detail && typeof detail === 'object' && 'Custom' in (detail as object)) {
    return Number((detail as { Custom: number }).Custom);
  }
  return null;
}

/**
 * Map a recorded (on-chain) failed transaction's meta.err to the same Paytruth
 * error names the SDK uses. Returns null for a successful tx.
 */
export function mapFailureMetaErr(metaErr: unknown): MappedError | null {
  if (metaErr === null || metaErr === undefined) return null;
  return mapError(metaErr);
}

/** Parse an explorer link for a devnet transaction signature. */
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

// ---------------------------------------------------------------------------
// Clock helpers (pure): format in WAT
// ---------------------------------------------------------------------------

/** Format an instant as `YYYY-MM-DD HH:mm:ss WAT` in Africa/Lagos. */
export function formatWat(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} WAT`;
}

/** Build a filesystem-safe ISO timestamp for report filenames. */
export function reportTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

// ---------------------------------------------------------------------------
// Unique invoice ids
// ---------------------------------------------------------------------------

/**
 * A base invoice id derived from the current time, unique enough that closed
 * invoices (tombstones) never collide on a rerun. Each step adds its own k.
 */
export function invoiceIdBase(nowMs: number): bigint {
  return BigInt(Math.floor(nowMs / 10)) * 10n;
}

// Re-exported for callers that want to validate addresses without importing web3.
export function parsePubkey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid ${label} public key: ${value}`);
  }
}
