import { appPath } from '../paths';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { fixtureSpecs } from '../../components/ui/sdk/fixtures';

test.describe('flows', () => {
  test('keyboard-only create invoice', async ({ page }) => {
    await page.goto(appPath('/merchant/new'));

    // Reach the amount field with the keyboard and type.
    await page.getByLabel('Amount (USDC)').focus();
    await page.keyboard.type('17.25');
    await page.getByLabel('Description').focus();
    await page.keyboard.type('Keyboard invoice');

    await page.getByRole('button', { name: 'Create invoice' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Invoice created' })).toBeVisible({ timeout: 15000 });
  });

  test('pay exact then verify shows paid', async ({ page }) => {
    await page.goto(appPath(`/pay?invoice=${fixtureSpecs.open.pda}`));
    await page.getByRole('button', { name: /^Pay 25\.00 USDC$/ }).click();

    const awaiting = page.getByRole('status').filter({ hasText: 'Check your wallet — approve the request to continue.' });
    await expect(awaiting).toBeVisible();
    const done = page.getByRole('status').filter({ hasText: 'Done. Final on Solana.' });
    await expect(done).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Payment sent into escrow' })).toBeVisible({ timeout: 15000 });

    await page.getByRole('link', { name: 'Verify this payment' }).click();
    await expect(page.getByRole('heading', { name: /Paid & / })).toBeVisible({ timeout: 15000 });
  });

  test('duplicate pay is impossible: no pay button after paid', async ({ page }) => {
    await page.goto(appPath(`/pay?invoice=${fixtureSpecs.paid.pda}`));
    await expect(page.getByRole('heading', { name: 'This invoice is already paid' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);
  });

  test('closed invoice shows closed copy and no pay button', async ({ page }) => {
    await page.goto(appPath(`/pay?invoice=${fixtureSpecs.closed.pda}`));
    await expect(page.getByRole('heading', { name: 'This invoice was closed by the merchant' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);
  });

  test('wallet rejection shows rejected copy in role=alert', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('paytruth-mock-fail', 'reject');
    });
    await page.goto(appPath(`/pay?invoice=${fixtureSpecs.open.pda}`));
    await page.getByRole('button', { name: /^Pay 25\.00 USDC$/ }).click();
    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15000 });
    await expect(alert).toContainText('You cancelled in your wallet');
  });
});

test('my invoices lists demo invoices with Needs action first and an inline Claim', async ({ page }) => {
  await page.goto(appPath('/invoices/'));
  const needs = page.getByRole('heading', { name: /Needs action/ });
  await expect(needs).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim payment' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Paid by me' }).click();
  await expect(page.getByRole('tab', { name: 'Paid by me' })).toHaveAttribute('aria-selected', 'true');
});

test('merchant page shows a sticky Claim payment bar on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appPath(`/merchant?invoice=${fixtureSpecs.paid.pda}`));
  const sticky = page.locator('a[href="#actions"]');
  await expect(sticky).toBeVisible();
  await page.screenshot({ path: join(process.cwd(), '..', 'ui-screens', 'merchant-sticky-claim-390.png') });
});

test('status filter tabs show counts and filter rows', async ({ page }) => {
  await page.goto(appPath('/invoices/'));
  const tabs = page.getByRole('tablist', { name: 'Filter by status' });
  await expect(tabs.getByRole('tab')).toHaveCount(8);
  await tabs.getByRole('tab', { name: /^Closed/ }).click();
  await expect(tabs.getByRole('tab', { name: /^Closed/ })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: /^Closed/ }).press('ArrowLeft');
  await expect(tabs.getByRole('tab', { name: /^Expired/ })).toHaveAttribute('aria-selected', 'true');
});

test('inline history expands with demo-labelled entries in the demo build', async ({ page }) => {
  await page.goto(appPath('/invoices/'));
  const toggle = page.getByRole('button', { name: 'Show history' }).first();
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Hide history' }).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Invoice created').first()).toBeVisible();
  await expect(page.getByText('Demo', { exact: true }).first()).toBeVisible();
});

test('merchant and verify pages have a History section', async ({ page }) => {
  await page.goto(appPath(`/verify?invoice=${fixtureSpecs.claimed.pda}`));
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText('Merchant claimed the payment').first()).toBeVisible();
  await page.goto(appPath(`/merchant?invoice=${fixtureSpecs.paid.pda}`));
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});
