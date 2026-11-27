import { appPath } from '../paths';
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
