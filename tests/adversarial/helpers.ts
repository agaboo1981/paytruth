import * as anchor from "@anchor-lang/core";
import { AnchorProvider, BN, Program, web3 } from "@anchor-lang/core";
import { expect } from "chai";

declare const require: (moduleName: string) => any;

export const USDC_DECIMALS = 6;
export const AMOUNT_DUE = new BN(1_000_000);
export const OVERPAY_AMOUNT = new BN(2_500_000);
export const STRAY_AMOUNT = new BN(123_456);

const ERROR_NUMBERS: Record<string, number> = {
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
  InvalidMint: 6011,
  InvalidEscrow: 6012,
  UnauthorizedMerchant: 6013,
  InvalidPayerAta: 6014,
  Overflow: 6015,
  VaultNotEmpty: 6016,
  InvoiceNotTerminal: 6017,
  ExcessOutstanding: 6018,
  NothingToRecover: 6019,
  PayerNotRecorded: 6020,
  ConfigMintMismatch: 6021,
  InvoiceMismatch: 6022,
};

export type ErrorExpectation = string | RegExp | Array<string | RegExp>;
export type Keypair = anchor.web3.Keypair;
export type PublicKey = anchor.web3.PublicKey;
export type BalanceSnapshot = Record<string, string>;

export interface RoleWallets {
  merchant: Keypair;
  payer: Keypair;
  attacker: Keypair;
  altMerchant: Keypair;
  mintAuthority: Keypair;
}

export interface TestContext {
  provider: anchor.AnchorProvider;
  program: anchor.Program<any>;
  wallets: RoleWallets;
  atas: Record<string, PublicKey>;
  mint: PublicKey;
  altMint: PublicKey;
  configPda: PublicKey;
  configBump: number;
  tokenProgram: PublicKey;
  associatedTokenProgram: PublicKey;
  token2022Program: PublicKey;
}

export interface InvoiceFixture {
  id: BN;
  pda: PublicKey;
  escrow: PublicKey;
  mint: PublicKey;
  amountDue: BN;
  expiresAt: BN;
}

export interface CreateInvoiceOptions {
  id?: BN;
  amountDue?: BN;
  expiresAt?: BN;
  memo?: string;
  merchant?: Keypair;
  mint?: PublicKey;
  invoice?: PublicKey;
  escrow?: PublicKey;
  tokenProgram?: PublicKey;
}

interface SplTokenApi {
  TOKEN_PROGRAM_ID: PublicKey;
  TOKEN_2022_PROGRAM_ID: PublicKey;
  createMint(...args: any[]): Promise<PublicKey>;
  createAssociatedTokenAccount(...args: any[]): Promise<PublicKey>;
  getOrCreateAssociatedTokenAccount(...args: any[]): Promise<{ address: PublicKey }>;
  createAccount(...args: any[]): Promise<PublicKey>;
  getAccount(...args: any[]): Promise<{ amount: any }>;
  mintTo(...args: any[]): Promise<string>;
  transferChecked(...args: any[]): Promise<string>;
}

let splTokenCache: SplTokenApi | undefined;

export function splToken(): SplTokenApi {
  if (!splTokenCache) {
    splTokenCache = require("@solana/spl-token") as SplTokenApi;
    if (!splTokenCache || !splTokenCache.TOKEN_PROGRAM_ID) {
      throw new Error("@solana/spl-token is required by tests/adversarial");
    }
  }
  return splTokenCache;
}

export function bn(value: BN | number | string): BN {
  return BN.isBN(value) ? value : new BN(value);
}

export function runtimeProgram(): anchor.Program<any> | undefined {
  try {
    return (anchor.workspace.paytruth as anchor.Program<any>) || undefined;
  } catch (_error) {
    return undefined;
  }
}

export function isPaytruthProgram(
  program: anchor.Program<any> | undefined
): boolean {
  if (!program || !program.methods || !program.account) {
    return false;
  }
  const methods = [
    "initializeConfig",
    "createInvoice",
    "payInvoice",
    "merchantClaim",
    "refundOverpayment",
    "expireInvoice",
    "recoverUnattributed",
    "closeInvoice",
  ];
  const accounts = ["config", "invoice"];
  return (
    methods.every((name) => typeof (program.methods as any)[name] === "function") &&
    accounts.every((name) => Boolean((program.account as any)[name]))
  );
}

export function describeAdversarial(title: string, define: () => void): void {
  describe(title, function () {
    before(function () {
      try {
        const provider = anchor.AnchorProvider.env();
        anchor.setProvider(provider);
        const program = anchor.workspace.paytruth as anchor.Program<any>;
        if (!isPaytruthProgram(program)) {
          this.skip();
        }
      } catch (_error) {
        this.skip();
      }
    });
    define();
  });
}

export function configPdaFor(programId: PublicKey): [PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId
  );
}

export function invoicePdaFor(
  merchant: PublicKey,
  invoiceId: BN,
  programId: PublicKey
): [PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("invoice"), merchant.toBuffer(), invoiceIdLeBytes(invoiceId)],
    programId
  );
}

export function invoiceIdLeBytes(invoiceId: BN): Buffer {
  return Buffer.from(bn(invoiceId).toArrayLike(Buffer, "le", 8));
}

export function escrowAtaFor(invoice: PublicKey, mint: PublicKey): PublicKey {
  return anchor.utils.token.associatedAddress({ mint, owner: invoice });
}

export function ataFor(owner: PublicKey, mint: PublicKey): PublicKey {
  return anchor.utils.token.associatedAddress({ mint, owner });
}

export function makeMemo(text = "qa-adversarial"): number[] {
  const memo = Buffer.alloc(64);
  Buffer.from(text, "utf8").copy(memo, 0, 0, Math.min(64, memo.length));
  return Array.from(memo);
}

let lastInvoiceId = new BN(Math.floor(Date.now() / 1000)).mul(new BN(1000));

export function nextInvoiceId(): BN {
  lastInvoiceId = lastInvoiceId.add(new BN(1));
  return lastInvoiceId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerPayer(provider: anchor.AnchorProvider): Keypair | undefined {
  return (provider.wallet as any)?.payer as Keypair | undefined;
}

async function fundWallet(
  provider: anchor.AnchorProvider,
  recipient: PublicKey
): Promise<void> {
  const funder = providerPayer(provider);
  if (funder) {
    await provider.sendAndConfirm(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: recipient,
          lamports: 2 * web3.LAMPORTS_PER_SOL,
        })
      ),
      [funder]
    );
    return;
  }
  const signature = await provider.connection.requestAirdrop(
    recipient,
    2 * web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(signature, "confirmed");
}

async function makeAndFundWallets(
  provider: anchor.AnchorProvider
): Promise<RoleWallets> {
  const wallets: RoleWallets = {
    merchant: web3.Keypair.generate(),
    payer: web3.Keypair.generate(),
    attacker: web3.Keypair.generate(),
    altMerchant: web3.Keypair.generate(),
    mintAuthority: web3.Keypair.generate(),
  };
  for (const name of Object.keys(wallets)) {
    await fundWallet(provider, (wallets as any)[name].publicKey);
  }
  return wallets;
}

async function createLocalMint(
  provider: anchor.AnchorProvider,
  mintAuthority: PublicKey,
  payer: Keypair
): Promise<PublicKey> {
  const spl = splToken();
  return spl.createMint(
    provider.connection,
    payer,
    mintAuthority,
    null,
    USDC_DECIMALS,
    undefined,
    undefined,
    spl.TOKEN_PROGRAM_ID
  );
}

export async function createAta(
  ctx: TestContext,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = ctx.tokenProgram
): Promise<PublicKey> {
  const spl = splToken();
  const payer = providerPayer(ctx.provider) ?? ctx.wallets.merchant;
  // Invoice PDA owners are off-curve; allowOwnerOffCurve must be true when deriving/creating.
  if (typeof spl.getOrCreateAssociatedTokenAccount === "function") {
    const account = await spl.getOrCreateAssociatedTokenAccount(
      ctx.provider.connection,
      payer,
      mint,
      owner,
      true,
      undefined,
      undefined,
      tokenProgram,
      ctx.associatedTokenProgram
    );
    return account.address;
  }
  return spl.createAssociatedTokenAccount(
    ctx.provider.connection,
    payer,
    mint,
    owner,
    undefined,
    tokenProgram,
    ctx.associatedTokenProgram
  );
}

export async function createPlainTokenAccount(
  ctx: TestContext,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = ctx.tokenProgram
): Promise<PublicKey> {
  const spl = splToken();
  return spl.createAccount(
    ctx.provider.connection,
    providerPayer(ctx.provider) ?? ctx.wallets.merchant,
    mint,
    owner,
    web3.Keypair.generate(),
    undefined,
    tokenProgram
  );
}

async function fetchNullableAccount(
  account: any,
  address: PublicKey
): Promise<any> {
  if (account && typeof account.fetchNullable === "function") {
    return account.fetchNullable(address);
  }
  try {
    return await account.fetch(address);
  } catch (error) {
    if (isMissingAccountError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingAccountError(error: any): boolean {
  const name = String(error?.name ?? error?.constructor?.name ?? "");
  const text = String(error?.message ?? error ?? "");
  return /TokenAccountNotFound|TokenInvalidAccountOwner|does not exist|not initialized|AccountNotInitialized|AccountDoesNotExist|could not find account/i.test(
    `${name} ${text}`
  );
}

export async function setupSuite(): Promise<TestContext> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.paytruth as anchor.Program<any>;
  if (!isPaytruthProgram(program)) {
    throw new Error("skipped: Paytruth instructions not on program yet");
  }

  const spl = splToken();
  const wallets = await makeAndFundWallets(provider);
  const [configPda, configBump] = configPdaFor(program.programId);

  const existingConfig = await fetchNullableAccount(
    (program.account as any).config,
    configPda
  );
  if (existingConfig) {
    throw new Error(
      "Paytruth Config PDA already exists on this validator. This suite initializes Config itself and needs a fresh localnet (or a run isolated from tests/program). Do not reuse a validator that already called initialize_config."
    );
  }

  const mint = await createLocalMint(
    provider,
    wallets.mintAuthority.publicKey,
    providerPayer(provider) ?? wallets.merchant
  );
  await (program.methods as any)
    .initializeConfig(mint)
    .accountsPartial({
      authority: provider.wallet.publicKey,
      config: configPda,
      usdcMint: mint,
      systemProgram: web3.SystemProgram.programId,
    })
    .rpc();

  const altMint = await createLocalMint(
    provider,
    wallets.mintAuthority.publicKey,
    providerPayer(provider) ?? wallets.merchant
  );

  const baseContext: TestContext = {
    provider,
    program,
    wallets,
    atas: {},
    mint,
    altMint,
    configPda,
    configBump,
    tokenProgram: spl.TOKEN_PROGRAM_ID,
    associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
    token2022Program:
      spl.TOKEN_2022_PROGRAM_ID ??
      new web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
  };

  for (const name of Object.keys(wallets)) {
    baseContext.atas[name] = await createAta(
      baseContext,
      mint,
      (wallets as any)[name].publicKey
    );
    baseContext.atas[`${name}Alt`] = await createAta(
      baseContext,
      altMint,
      (wallets as any)[name].publicKey
    );
  }

  // Fund payer/merchant/attacker ATAs so first pays (and stray transfers) can succeed.
  const fundAmount = BigInt(1_000_000_000_000); // 1_000_000 tokens at 6 decimals
  const feePayer = providerPayer(provider) ?? wallets.merchant;
  for (const name of Object.keys(wallets)) {
    await spl.mintTo(
      provider.connection,
      feePayer,
      mint,
      baseContext.atas[name],
      wallets.mintAuthority,
      fundAmount,
      [],
      undefined,
      spl.TOKEN_PROGRAM_ID
    );
    await spl.mintTo(
      provider.connection,
      feePayer,
      altMint,
      baseContext.atas[`${name}Alt`],
      wallets.mintAuthority,
      fundAmount,
      [],
      undefined,
      spl.TOKEN_PROGRAM_ID
    );
  }

  return baseContext;
}

export async function fetchConfig(ctx: TestContext): Promise<any> {
  return (ctx.program.account as any).config.fetch(ctx.configPda);
}

export function configSnapshot(config: any): string {
  return JSON.stringify([
    serializeField(config?.authority),
    serializeField(config?.usdcMint ?? config?.usdc_mint),
    serializeField(config?.bump),
  ]);
}

export async function fetchInvoice(
  ctx: TestContext,
  invoice: PublicKey
): Promise<any> {
  return (ctx.program.account as any).invoice.fetch(invoice);
}

export async function fetchInvoiceNullable(
  ctx: TestContext,
  invoice: PublicKey
): Promise<any | null> {
  return fetchNullableAccount((ctx.program.account as any).invoice, invoice);
}

function serializeField(value: any): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (BN.isBN(value) || typeof value?.toBase58 === "function") {
    return value.toString();
  }
  return JSON.stringify(value);
}

export function invoiceSnapshot(invoice: any): string {
  return JSON.stringify([
    serializeField(invoice?.merchant),
    serializeField(invoice?.payer),
    serializeField(invoice?.mint),
    serializeField(invoice?.invoiceId ?? invoice?.invoice_id),
    serializeField(invoice?.amountDue ?? invoice?.amount_due),
    serializeField(invoice?.paidAmount ?? invoice?.paid_amount),
    serializeField(invoice?.refundedExcess ?? invoice?.refunded_excess),
    serializeField(invoice?.createdAt ?? invoice?.created_at),
    serializeField(invoice?.expiresAt ?? invoice?.expires_at),
    serializeField(invoice?.status),
    serializeField(invoice?.claimed),
    serializeField(invoice?.bump),
    serializeField(invoice?.memo),
  ]);
}

export async function assertInvoiceUnchanged(
  ctx: TestContext,
  invoice: PublicKey,
  before: string
): Promise<void> {
  expect(invoiceSnapshot(await fetchInvoice(ctx, invoice))).to.equal(before);
}

export async function assertInvoiceExists(
  ctx: TestContext,
  invoice: PublicKey
): Promise<void> {
  expect(
    await fetchInvoiceNullable(ctx, invoice),
    "invoice account should exist"
  ).to.not.equal(null);
}

export async function assertInvoiceGone(
  ctx: TestContext,
  invoice: PublicKey
): Promise<void> {
  expect(
    await fetchInvoiceNullable(ctx, invoice),
    "invoice account should be closed"
  ).to.equal(null);
}

/** PR2 tombstone: close_invoice keeps the Invoice account with status = Closed (3). */
export async function assertInvoiceTombstoned(
  ctx: TestContext,
  invoice: PublicKey
): Promise<any> {
  const account = await fetchInvoice(ctx, invoice);
  const status = account?.status;
  const closed =
    status === 3 ||
    status === "Closed" ||
    status === "closed" ||
    (status && typeof status === "object" && "closed" in status);
  expect(closed, "invoice should remain as a Closed tombstone").to.equal(true);
  return account;
}

export async function tokenAmount(
  ctx: TestContext,
  account: PublicKey
): Promise<BN> {
  const spl = splToken();
  const parsed = await spl.getAccount(ctx.provider.connection, account);
  return bn(parsed.amount.toString());
}

export async function tokenAmountOrZero(
  ctx: TestContext,
  account: PublicKey
): Promise<BN> {
  try {
    return await tokenAmount(ctx, account);
  } catch (error) {
    if (isMissingAccountError(error)) {
      return new BN(0);
    }
    throw error;
  }
}

export async function snapshotBalances(
  ctx: TestContext,
  accounts: Record<string, PublicKey>
): Promise<BalanceSnapshot> {
  const snapshot: BalanceSnapshot = {};
  for (const [name, address] of Object.entries(accounts)) {
    snapshot[name] = (await tokenAmountOrZero(ctx, address)).toString();
  }
  return snapshot;
}

export function standardAccounts(
  ctx: TestContext,
  escrow: PublicKey,
  extras: Record<string, PublicKey> = {}
): Record<string, PublicKey> {
  return {
    merchant: ctx.atas.merchant,
    payer: ctx.atas.payer,
    attacker: ctx.atas.attacker,
    altMerchant: ctx.atas.altMerchant,
    escrow,
    ...extras,
  };
}

export function assertBalancesUnchanged(
  before: BalanceSnapshot,
  after: BalanceSnapshot
): void {
  expect(
    after,
    "token balances changed when the transaction should have been rejected"
  ).to.deep.equal(before);
}

export async function nowUnix(ctx: TestContext): Promise<BN> {
  try {
    const slot = await ctx.provider.connection.getSlot("confirmed");
    const blockTime = await ctx.provider.connection.getBlockTime(slot);
    if (typeof blockTime === "number") {
      return new BN(blockTime);
    }
  } catch (_error) {
    return new BN(Math.floor(Date.now() / 1000));
  }
  return new BN(Math.floor(Date.now() / 1000));
}

export async function warpToUnixTimestamp(
  ctx: TestContext,
  timestamp: BN | number
): Promise<BN> {
  const target = bn(timestamp);
  const sources: any[] = [
    ctx,
    (ctx as any).clock,
    ctx.provider,
    ctx.provider.connection,
    (ctx.provider as any).context,
    (ctx.provider as any).bankrun,
    (ctx.provider as any).litesvm,
  ];
  const warpNames = [
    "warpToUnixTimestamp",
    "warpTo",
    "setTime",
    "setClock",
    "setSysvarStamp",
    "warp",
  ];

  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const name of warpNames) {
      const warp = source[name];
      if (typeof warp !== "function") {
        continue;
      }
      try {
        await warp.call(source, target.toNumber());
        return await nowUnix(ctx);
      } catch (_error) {
        // Try the next known warp entry point, then fall back to waiting.
      }
    }
  }

  const current = await nowUnix(ctx);
  const waitMs = Math.max(0, target.sub(current).toNumber() * 1000 + 1200);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  return nowUnix(ctx);
}

export async function createShortLivedInvoice(
  ctx: TestContext,
  ttlSeconds = 4,
  options: Partial<CreateInvoiceOptions> = {}
): Promise<InvoiceFixture> {
  const expiresAt = (await nowUnix(ctx)).add(new BN(ttlSeconds));
  return createOpenInvoice(ctx, { ...options, expiresAt });
}

export function errorText(error: any): string {
  const pieces = [
    error?.message,
    error?.toString?.(),
    error?.error?.errorMessage,
    error?.error?.errorCode?.name,
    error?.error?.errorCode?.code,
    error?.error?.code,
    error?.logs?.join?.("\n"),
  ];
  return pieces
    .filter((piece) => piece !== undefined && piece !== null)
    .map(String)
    .join("\n");
}

function matchesExpectation(
  text: string,
  expectation: string | RegExp
): boolean {
  if (expectation instanceof RegExp) {
    return expectation.test(text);
  }
  if (text.toLowerCase().includes(expectation.toLowerCase())) {
    return true;
  }
  const code = ERROR_NUMBERS[expectation];
  return code !== undefined && new RegExp(`\\b${code}\\b`).test(text);
}

export async function expectTxFail(
  promise: Promise<unknown> | (() => Promise<unknown>),
  expected: ErrorExpectation
): Promise<any> {
  const expectations = Array.isArray(expected) ? expected : [expected];
  let error: any;
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (caught) {
    error = caught;
  }
  if (!error) {
    throw new Error(
      `Expected transaction to fail with ${expectations
        .map(String)
        .join(" / ")}, but it succeeded`
    );
  }
  const text = errorText(error);
  if (
    !expectations.some((expectation) => matchesExpectation(text, expectation))
  ) {
    throw new Error(
      `Expected transaction to fail with ${expectations
        .map(String)
        .join(" / ")}, but got: ${text}`
    );
  }
  return error;
}

export function makeCreateInvoiceTx(
  ctx: TestContext,
  options: CreateInvoiceOptions
): { tx: any; fixture: InvoiceFixture } {
  const id = options.id ?? nextInvoiceId();
  const merchant = options.merchant ?? ctx.wallets.merchant;
  const mint = options.mint ?? ctx.mint;
  const amountDue = options.amountDue ?? AMOUNT_DUE;
  const expiresAt =
    options.expiresAt ?? bn(Math.floor(Date.now() / 1000) + 3600);
  const pda =
    options.invoice ??
    invoicePdaFor(merchant.publicKey, id, ctx.program.programId)[0];
  const escrow = options.escrow ?? escrowAtaFor(pda, mint);
  const tx = (ctx.program.methods as any)
    .createInvoice(
      id,
      amountDue,
      expiresAt,
      options.memo === undefined ? makeMemo() : makeMemo(options.memo)
    )
    .accountsPartial({
      merchant: merchant.publicKey,
      config: ctx.configPda,
      invoice: pda,
      mint,
      escrow,
      tokenProgram: options.tokenProgram ?? ctx.tokenProgram,
      associatedTokenProgram: ctx.associatedTokenProgram,
      systemProgram: web3.SystemProgram.programId,
    })
    .signers([merchant]);
  return {
    tx,
    fixture: { id, pda, escrow, mint, amountDue, expiresAt },
  };
}

export async function createOpenInvoice(
  ctx: TestContext,
  options: CreateInvoiceOptions = {}
): Promise<InvoiceFixture> {
  const expiresAt = options.expiresAt ?? (await nowUnix(ctx)).add(new BN(3600));
  const built = makeCreateInvoiceTx(ctx, { ...options, expiresAt });
  await built.tx.rpc();
  await assertInvoiceExists(ctx, built.fixture.pda);
  return built.fixture;
}

export interface PayOptions {
  payer?: Keypair;
  payerAta?: PublicKey;
  mint?: PublicKey;
  escrow?: PublicKey;
  tokenProgram?: PublicKey;
  /** Bound to invoice.amountDue unless testing InvoiceMismatch. */
  expectedAmountDue?: BN;
}

export function payTx(
  ctx: TestContext,
  invoice: InvoiceFixture,
  amount: BN,
  options: PayOptions = {}
): any {
  const payer = options.payer ?? ctx.wallets.payer;
  const expectedAmountDue = options.expectedAmountDue ?? invoice.amountDue;
  const payerAta =
    options.payerAta ??
    (payer.publicKey.equals(ctx.wallets.payer.publicKey)
      ? ctx.atas.payer
      : payer.publicKey.equals(ctx.wallets.attacker.publicKey)
        ? ctx.atas.attacker
        : payer.publicKey.equals(ctx.wallets.merchant.publicKey)
          ? ctx.atas.merchant
          : ctx.atas.payer);
  return (ctx.program.methods as any)
    .payInvoice(bn(amount), bn(expectedAmountDue))
    .accountsPartial({
      payer: payer.publicKey,
      config: ctx.configPda,
      invoice: invoice.pda,
      mint: options.mint ?? invoice.mint,
      payerAta,
      escrow: options.escrow ?? invoice.escrow,
      tokenProgram: options.tokenProgram ?? ctx.tokenProgram,
    })
    .signers([payer]);
}

export interface ClaimOptions {
  merchant?: Keypair;
  merchantAta?: PublicKey;
  mint?: PublicKey;
  escrow?: PublicKey;
  tokenProgram?: PublicKey;
}

export function claimTx(
  ctx: TestContext,
  invoice: InvoiceFixture,
  options: ClaimOptions = {}
): any {
  const merchant = options.merchant ?? ctx.wallets.merchant;
  return (ctx.program.methods as any)
    .merchantClaim()
    .accountsPartial({
      merchant: merchant.publicKey,
      invoice: invoice.pda,
      mint: options.mint ?? invoice.mint,
      escrow: options.escrow ?? invoice.escrow,
      merchantAta: options.merchantAta ?? ctx.atas.merchant,
      tokenProgram: options.tokenProgram ?? ctx.tokenProgram,
      associatedTokenProgram: ctx.associatedTokenProgram,
      systemProgram: web3.SystemProgram.programId,
    })
    .signers([merchant]);
}

export interface RefundOptions {
  caller?: Keypair;
  payerAta?: PublicKey;
  /** Recorded invoice.payer pubkey (required account on current program). */
  recordedPayer?: PublicKey;
  mint?: PublicKey;
  escrow?: PublicKey;
  tokenProgram?: PublicKey;
}

export function refundTx(
  ctx: TestContext,
  invoice: InvoiceFixture,
  options: RefundOptions = {}
): any {
  const caller = options.caller ?? ctx.wallets.attacker;
  return (ctx.program.methods as any)
    .refundOverpayment()
    .accountsPartial({
      caller: caller.publicKey,
      invoice: invoice.pda,
      mint: options.mint ?? invoice.mint,
      escrow: options.escrow ?? invoice.escrow,
      payer: options.recordedPayer ?? ctx.wallets.payer.publicKey,
      payerAta: options.payerAta ?? ctx.atas.payer,
      tokenProgram: options.tokenProgram ?? ctx.tokenProgram,
      associatedTokenProgram: ctx.associatedTokenProgram,
      systemProgram: web3.SystemProgram.programId,
    })
    .signers([caller]);
}

export interface ExpireOptions {
  caller?: Keypair;
}

export function expireTx(
  ctx: TestContext,
  invoice: InvoiceFixture,
  options: ExpireOptions = {}
): any {
  const caller = options.caller ?? ctx.wallets.attacker;
  return (ctx.program.methods as any)
    .expireInvoice()
    .accountsPartial({
      caller: caller.publicKey,
      invoice: invoice.pda,
    })
    .signers([caller]);
}

export interface RecoverOptions {
  merchant?: Keypair;
  destinationAta?: PublicKey;
  mint?: PublicKey;
  escrow?: PublicKey;
  tokenProgram?: PublicKey;
}

export function recoverTx(
  ctx: TestContext,
  invoice: InvoiceFixture,
  options: RecoverOptions = {}
): any {
  const merchant = options.merchant ?? ctx.wallets.merchant;
  return (ctx.program.methods as any)
    .recoverUnattributed()
    .accountsPartial({
      merchant: merchant.publicKey,
      invoice: invoice.pda,
      mint: options.mint ?? invoice.mint,
      escrow: options.escrow ?? invoice.escrow,
      destinationAta: options.destinationAta ?? ctx.atas.merchant,
      tokenProgram: options.tokenProgram ?? ctx.tokenProgram,
      associatedTokenProgram: ctx.associatedTokenProgram,
      systemProgram: web3.SystemProgram.programId,
    })
    .signers([merchant]);
}

export interface CloseOptions {
  merchant?: Keypair;
  mint?: PublicKey;
  escrow?: PublicKey;
  tokenProgram?: PublicKey;
}

export function closeTx(
  ctx: TestContext,
  invoice: InvoiceFixture,
  options: CloseOptions = {}
): any {
  const merchant = options.merchant ?? ctx.wallets.merchant;
  return (ctx.program.methods as any)
    .closeInvoice()
    .accountsPartial({
      merchant: merchant.publicKey,
      invoice: invoice.pda,
      mint: options.mint ?? invoice.mint,
      escrow: options.escrow ?? invoice.escrow,
      tokenProgram: options.tokenProgram ?? ctx.tokenProgram,
    })
    .signers([merchant]);
}

export async function transferToken(
  ctx: TestContext,
  amount: BN,
  from: Keypair,
  sourceAta: PublicKey,
  destinationAta: PublicKey,
  mint: PublicKey = ctx.mint,
  tokenProgram: PublicKey = ctx.tokenProgram
): Promise<string> {
  const spl = splToken();
  return spl.transferChecked(
    ctx.provider.connection,
    providerPayer(ctx.provider) ?? ctx.wallets.merchant,
    sourceAta,
    mint,
    destinationAta,
    from,
    BigInt(bn(amount).toString()),
    USDC_DECIMALS,
    [],
    undefined,
    tokenProgram
  );
}

export async function createToken2022MintAndAta(
  ctx: TestContext,
  owner: Keypair
): Promise<{ mint: PublicKey; ata: PublicKey }> {
  const spl = splToken();
  const mint = await spl.createMint(
    ctx.provider.connection,
    providerPayer(ctx.provider) ?? ctx.wallets.merchant,
    owner.publicKey,
    null,
    USDC_DECIMALS,
    undefined,
    undefined,
    ctx.token2022Program
  );
  const ata = await createAta(ctx, mint, owner.publicKey, ctx.token2022Program);
  return { mint, ata };
}

export async function createDecoyEscrow(
  ctx: TestContext,
  invoice: InvoiceFixture,
  mint: PublicKey = ctx.altMint
): Promise<PublicKey> {
  return createAta(ctx, mint, invoice.pda, ctx.tokenProgram);
}

export async function createFakeEscrowWithInvoiceAuthority(
  ctx: TestContext,
  invoice: InvoiceFixture
): Promise<PublicKey> {
  return createPlainTokenAccount(
    ctx,
    invoice.mint,
    invoice.pda,
    ctx.tokenProgram
  );
}
