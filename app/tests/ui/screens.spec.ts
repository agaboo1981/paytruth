import { appPath } from '../paths';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { fixtureSpecs } from '../../components/ui/sdk/fixtures';

const OUT = join(process.cwd(), '..', 'ui-screens');

const viewports = [
  { suffix: '390', width: 390, height: 844 },
  { suffix: '1280', width: 1280, height: 800 },
];

const screens: { name: string; path: string }[] = [
  { name: 'landing', path: appPath('/') },
  { name: 'merchant-new', path: appPath('/merchant/new') },
  { name: 'pay-open', path: appPath(`/pay?invoice=${fixtureSpecs.open.pda}`) },
  { name: 'pay-overpaid', path: appPath(`/pay?invoice=${fixtureSpecs.overpaid.pda}`) },
  { name: 'pay-expired', path: appPath(`/pay?invoice=${fixtureSpecs.expired.pda}`) },
  { name: 'pay-paid', path: appPath(`/pay?invoice=${fixtureSpecs.paid.pda}`) },
  { name: 'pay-closed', path: appPath(`/pay?invoice=${fixtureSpecs.closed.pda}`) },
  { name: 'merchant-paid', path: appPath(`/merchant?invoice=${fixtureSpecs.paid.pda}`) },
  { name: 'merchant-overpaid', path: appPath(`/merchant?invoice=${fixtureSpecs.overpaid.pda}`) },
  { name: 'merchant-closed', path: appPath(`/merchant?invoice=${fixtureSpecs.closed.pda}`) },
  { name: 'verify-claimed', path: appPath(`/verify?invoice=${fixtureSpecs.claimed.pda}`) },
  { name: 'verify-expired', path: appPath(`/verify?invoice=${fixtureSpecs.expired.pda}`) },
  { name: 'verify-closed', path: appPath(`/verify?invoice=${fixtureSpecs.closed.pda}`) },
  { name: 'verify-invalid', path: appPath('/verify?invoice=not-a-valid-address') },
  { name: 'states', path: appPath('/states') },
];

async function shoot(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `${name}-${vp.suffix}.png`), fullPage: true });
  }
}

test.beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
});

test.describe('screens', () => {
  for (const screen of screens) {
    test(`screenshot: ${screen.name}`, async ({ page }) => {
      await page.goto(screen.path);
      await shoot(page, screen.name);
    });
  }

  test('screenshot: create invoice success share card', async ({ page }) => {
    await page.goto(appPath('/merchant/new'));
    await page.getByLabel('Amount (USDC)').fill('42.50');
    await page.getByLabel('Description').fill('Screenshot invoice');
    await page.getByRole('button', { name: 'Create invoice' }).click();
    await expect(page.getByRole('heading', { name: 'Invoice created' })).toBeVisible({ timeout: 15000 });
    await shoot(page, 'merchant-new-success');
  });
});
