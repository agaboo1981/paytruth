/**
 * REAL devnet E2E of the UI (real-SDK build). Signs with throwaway keypairs held
 * outside the repo (see test-wallet.ts). Writes results (signatures, PDAs; never
 * secrets) to ../ui-screens/devnet-run.json. Devnet only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

import { installTestWallet, loadRole } from './test-wallet';

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
if (RPC.toLowerCase().includes('mainnet')) throw new Error('Refusing mainnet RPC.');
const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const SHOTS = join(process.cwd(), '..', 'ui-screens');
const FINAL = 'Done. Final on Solana.';

// Invoices created by Full-Stack's devnet runner (sdk/docs/DEVNET-RUN.md): read-only checks.
const FS_A = 'Er18wwcfa4sqbFq6kAKHYLefB1TQnM5X6aFwtrdmSqDA'; // paid + claimed
const FS_B = '3vdhiiF1YjCmo5m8Y6H3A1nAEcCn2BXQ9rk1JPx4KaCW'; // overpaid, refunded, claimed
const FS_C = 'Gf8EFcdfrj8LJg9pC6T74UqCsv4LsP6S25PjHmktRVdW'; // expired + closed

type Rec = { step: string; signature?: string; explorer?: string; pda?: string; result: string };
const records: Rec[] = [];
function record(r: Rec) {
  if (r.signature) r.explorer = `https://explorer.solana.com/tx/${r.signature}?cluster=devnet`;
  records.push(r);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, 'devnet-run.json'), JSON.stringify(records, null, 2));
}

async function shot(page: Page, name: string) {
  for (const [w, h] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: join(SHOTS, `${name}-devnet-${w}.png`), fullPage: true });
  }
}

async function lastSignature(page: Page): Promise<string | undefined> {
  const links = page.locator('main a[href*="explorer.solana.com/tx/"]');
  const n = await links.count();
  if (n === 0) return undefined;
  const href = (await links.nth(n - 1).getAttribute('href')) ?? '';
  return href.match(/\/tx\/([1-9A-HJ-NP-Za-km-z]+)/)?.[1];
}

async function waitFinal(page: Page) {
  await expect(page.locator('main').getByRole('status').filter({ hasText: FINAL }).last()).toBeVisible({
    timeout: 150_000,
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('devnet: read-only (Full-Stack runner invoices)', () => {
  test('verify A/B/C render real chain state', async ({ page }) => {
    await page.goto(`/verify/${FS_A}`);
    await expect(page.getByRole('heading', { name: /Paid & claimed|Paid — confirming/ })).toBeVisible({ timeout: 60_000 });
    await shot(page, 'verify-claimed');
    await page.goto(`/verify/${FS_B}`);
    await expect(page.getByRole('heading', { name: /Paid & claimed|Paid — confirming/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('main')).toContainText('0.50 USDC');
    await shot(page, 'verify-refunded');
    await page.goto(`/verify/${FS_C}`);
    await expect(page.getByRole('heading', { name: 'Closed' })).toBeVisible({ timeout: 60_000 });
    await shot(page, 'verify-closed');
    await page.goto(`/pay/${FS_A}`);
    await expect(page.getByRole('heading', { name: 'This invoice is already paid' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    await shot(page, 'pay-paid');
    await page.goto(`/pay/${FS_C}`);
    await expect(page.locator('main')).toContainText(/closed by the merchant/i, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    await shot(page, 'pay-closed');
    record({ step: 'read-only verify of FS invoices A/B/C', result: 'ok' });
  });
});

test.describe('devnet: full UI flow with test wallets', () => {
  let merchant: BrowserContext;
  let payer: BrowserContext;
  let funded = false;
  let reason = '';

  test.beforeAll(async ({ browser }) => {
    const conn = new Connection(RPC, 'confirmed');
    const m = loadRole('merchant');
    const p = loadRole('payer');
    const [mSol, pSol] = await Promise.all([conn.getBalance(m.publicKey), conn.getBalance(p.publicKey)]);
    let pUsdc = 0n;
    try {
      const bal = await conn.getTokenAccountBalance(getAssociatedTokenAddressSync(USDC, p.publicKey));
      pUsdc = BigInt(bal.value.amount);
    } catch {
      pUsdc = 0n;
    }
    funded = mSol >= 50_000_000 && pSol >= 20_000_000 && pUsdc >= 2_500_000n;
    reason = `merchant ${m.publicKey.toBase58()} SOL=${mSol / 1e9}; payer ${p.publicKey.toBase58()} SOL=${pSol / 1e9} USDC=${Number(pUsdc) / 1e6} (need merchant>=0.05 SOL, payer>=0.02 SOL and >=2.5 USDC)`;
    record({ step: 'funding check', result: funded ? `funded: ${reason}` : `NOT FUNDED: ${reason}` });
    merchant = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    payer = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    await installTestWallet(merchant, m);
    await installTestWallet(payer, p);
  });

  test.afterAll(async () => {
    await merchant?.close();
    await payer?.close();
  });

  async function create(amount: string, memo: string, customExpiry?: Date): Promise<string> {
    const page = await merchant.newPage();
    await page.goto('/merchant/new');
    await expect(page.getByRole('button', { name: 'Create invoice' })).toBeEnabled({ timeout: 30_000 });
    await page.getByLabel('Amount (USDC)').fill(amount);
    await page.getByLabel('Description').fill(memo);
    if (customExpiry) {
      await page.locator('#expiry').selectOption('custom');
      const pad = (n: number) => String(n).padStart(2, '0');
      const d = customExpiry;
      await page
        .getByLabel('Custom expiry date and time')
        .fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page.getByRole('heading', { name: 'Invoice created' })).toBeVisible({ timeout: 150_000 });
    const href = (await page.getByRole('link', { name: /Open merchant view/ }).getAttribute('href')) ?? '';
    const pda = href.split('/').pop()!;
    record({ step: `create ${memo}`, pda, signature: await lastSignature(page), result: 'ok' });
    if (memo === 'UI devnet A') await shot(page, 'merchant-new-success');
    await page.close();
    return pda;
  }

  test('create -> pay exact -> claim; duplicate pay blocked; verify', async () => {
    test.skip(!funded, `Test wallets not funded. ${reason}`);
    test.setTimeout(600_000);
    const pda = await create('1', 'UI devnet A');

    const pp = await payer.newPage();
    await pp.goto(`/pay/${pda}`);
    await shot(pp, 'pay-open');
    await pp.getByRole('button', { name: /^Pay 1\.00 USDC$/ }).click();
    await expect(pp.locator('main').getByRole('status').filter({ hasText: 'Check your wallet' })).toBeVisible();
    await waitFinal(pp);
    record({ step: 'pay exact A', pda, signature: await lastSignature(pp), result: 'ok' });

    await pp.goto(`/pay/${pda}`);
    await expect(pp.getByRole('heading', { name: 'This invoice is already paid' })).toBeVisible({ timeout: 60_000 });
    await expect(pp.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    record({ step: 'duplicate pay A blocked in UI (no pay button)', pda, result: 'ok' });

    const mp = await merchant.newPage();
    await mp.goto(`/merchant/${pda}`);
    await shot(mp, 'merchant-paid');
    await mp.getByRole('button', { name: 'Claim payment' }).click();
    await waitFinal(mp);
    record({ step: 'claim A', pda, signature: await lastSignature(mp), result: 'ok' });

    await pp.goto(`/verify/${pda}`);
    await expect(pp.getByRole('heading', { name: /Paid & claimed/ })).toBeVisible({ timeout: 90_000 });
    await shot(pp, 'verify-ui-a');
    await pp.close();
    await mp.close();
  });

  test('overpay -> refund', async () => {
    test.skip(!funded, `Test wallets not funded. ${reason}`);
    test.setTimeout(600_000);
    const pda = await create('1', 'UI devnet B');
    const pp = await payer.newPage();
    await pp.goto(`/pay/${pda}`);
    await pp.getByRole('button', { name: 'Pay a different amount' }).click();
    await pp.getByLabel('Amount to pay (USDC)').fill('1.5');
    await pp.getByRole('button', { name: /^Pay 1\.50 USDC$/ }).click();
    await waitFinal(pp);
    record({ step: 'overpay B (1.50 for 1.00)', pda, signature: await lastSignature(pp), result: 'ok' });
    await pp.goto(`/pay/${pda}`);
    await expect(pp.getByRole('heading', { name: /You paid 0\.50 USDC extra/ })).toBeVisible({ timeout: 90_000 });
    await shot(pp, 'pay-overpaid');
    await pp.getByRole('button', { name: /^Refund 0\.50 USDC$/ }).click();
    await waitFinal(pp);
    record({ step: 'refund B excess', pda, signature: await lastSignature(pp), result: 'ok' });
    await pp.goto(`/verify/${pda}`);
    await expect(pp.locator('main')).toContainText('0.50 USDC', { timeout: 90_000 });
    await shot(pp, 'verify-ui-b');
    await pp.close();
  });

  test('short expiry -> expire -> close -> closed copy on pay/verify', async () => {
    test.skip(!funded, `Test wallets not funded. ${reason}`);
    test.setTimeout(600_000);
    const expiry = new Date(Date.now() + 2 * 60_000);
    const pda = await create('1', 'UI devnet C', expiry);
    const wait = expiry.getTime() - Date.now() + 15_000;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const pp = await payer.newPage();
    await pp.goto(`/pay/${pda}`);
    await expect(pp.getByRole('heading', { name: 'This invoice has expired' })).toBeVisible({ timeout: 60_000 });
    await expect(pp.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    await shot(pp, 'pay-expired');

    const mp = await merchant.newPage();
    await mp.goto(`/merchant/${pda}`);
    await mp.getByRole('button', { name: 'Mark as expired' }).click();
    await waitFinal(mp);
    record({ step: 'expire C', pda, signature: await lastSignature(mp), result: 'ok' });
    await mp.goto(`/merchant/${pda}`);
    await mp.getByRole('button', { name: 'Close invoice' }).click();
    await expect(mp.locator('main')).toContainText(/Closed/, { timeout: 150_000 });
    record({ step: 'close C', pda, signature: await lastSignature(mp), result: 'ok' });
    await mp.goto(`/merchant/${pda}`);
    await expect(mp.getByRole('heading', { name: 'Closed' })).toBeVisible({ timeout: 90_000 });
    await shot(mp, 'merchant-closed');

    await pp.goto(`/pay/${pda}`);
    await expect(pp.locator('main')).toContainText(/closed by the merchant/i, { timeout: 90_000 });
    await expect(pp.getByRole('button', { name: /^Pay / })).toHaveCount(0);
    await pp.goto(`/verify/${pda}`);
    await expect(pp.getByRole('heading', { name: 'Closed' })).toBeVisible({ timeout: 90_000 });
    await shot(pp, 'verify-ui-c');
    await pp.close();
    await mp.close();
  });
});
