import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { fixtureSpecs } from '../../components/ui/sdk/fixtures';
import { appPath } from '../paths';

const viewports = [
  { width: 320, height: 740 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 640, height: 960 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
];

const routes = [
  '/',
  '/invoices/',
  '/merchant/new',
  '/verify',
  '/verify?invoice=invalid',
  '/pay',
  '/merchant',
  '/states',
  ...Object.values(fixtureSpecs).flatMap(({ pda }) => [
    `/pay?invoice=${pda}`,
    `/merchant?invoice=${pda}`,
    `/verify?invoice=${pda}`,
  ]),
];

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document, `Document overflow at ${page.url()}`).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body, `Body overflow at ${page.url()}`).toBeLessThanOrEqual(widths.viewport + 1);
}

async function settlePage(page: Page) {
  await expect(page.locator('main .page-container').first()).toBeVisible();
  await expect(page.locator('main .skeleton')).toHaveCount(0);
  // Wait for client hydration and invoice reads before measuring the final layout.
  await expect(page.getByRole('button', { name: /Switch to .* theme/ })).toBeEnabled();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
}

test.describe('responsive layout', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const viewport of viewports) {
    test(`pages fit ${viewport.width} × ${viewport.height}`, async ({ page }) => {
      test.setTimeout(120000);
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await test.step(route, async () => {
          await page.goto(appPath(route));
          await settlePage(page);
          await expectNoPageOverflow(page);
          // Technical details are collapsed by default; full addresses must fit too.
          for (const summary of await page.locator('main details > summary').all()) {
            await summary.click();
          }
          await expectNoPageOverflow(page);
        });
      }
    });
  }

  test('mobile navigation is accessible, closes on Escape and after navigating', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(appPath('/'));
    const open = page.getByRole('button', { name: 'Open menu' });
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    await expect(nav).toBeHidden();
    await open.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    await expectNoPageOverflow(page);
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(open).toBeFocused();
    await open.click();
    await nav.getByRole('link', { name: 'Create invoice' }).click();
    await expect(page.getByRole('heading', { name: 'Create an invoice' })).toBeVisible();
    await expect(nav).toBeHidden();
    await expect(page.locator('#main-navigation a[aria-current="page"]')).toHaveText('Create invoice');
    await open.click();
    await expect(nav.getByRole('link', { name: 'Create invoice' })).toHaveAttribute('aria-current', 'page');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(open).toBeHidden();
    await expect(nav).toBeVisible();
    await expectNoPageOverflow(page);
    await page.setViewportSize({ width: 320, height: 740 });
    await expect(nav).toBeHidden();
  });

  test('landscape navigation remains scrollable and usable', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto(appPath('/'));
    await page.getByRole('button', { name: 'Open menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Main', exact: true });
    await nav.getByRole('link', { name: 'Verify', exact: true }).click();
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page).toHaveURL(/\/verify\//);
    await expectNoPageOverflow(page);
  });

  test('mobile inputs, custom expiry and long content fit without focus zoom', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(appPath('/merchant/new'));
    await page.getByLabel('Amount (USDC)').fill('123456789.123456');
    await page.getByLabel('Description').fill('A'.repeat(60));
    await page.getByLabel('Expires', { exact: true }).selectOption('custom');
    const expiry = page.getByLabel('Custom expiry date and time');
    await expiry.fill('2099-12-31T23:59');
    await expiry.focus();
    expect(await expiry.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await expectNoPageOverflow(page);
    await page.getByText('Technical details', { exact: true }).click();
    await expectNoPageOverflow(page);
    await page.getByRole('button', { name: 'Create invoice', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Invoice created' })).toBeVisible({ timeout: 15000 });
    await expectNoPageOverflow(page);
    const payLink = await page.getByRole('link', { name: 'Open pay page' }).getAttribute('href');
    expect(payLink).toBeTruthy();
    await page.goto(payLink!);
    await settlePage(page);
    await expectNoPageOverflow(page);
    await page.getByText('Technical details', { exact: true }).click();
    await expectNoPageOverflow(page);
  });

  test('light theme and increased text size reflow on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(appPath('/'));
    await page.getByRole('button', { name: /Switch to light theme/ }).click();
    await expect(page.locator('html')).toHaveClass('light');
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await expectNoPageOverflow(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expectNoPageOverflow(page);
    await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'My invoices' }).click();
    await settlePage(page);
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    await expectNoPageOverflow(page);
  });

  test('touch viewport uses device width and allows zooming', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });
    try {
      const page = await context.newPage();
      await page.goto(appPath('/verify'));
      await settlePage(page);
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
      expect(viewport).toContain('width=device-width');
      expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
      expect(await page.evaluate(() => window.innerWidth)).toBe(390);
      await page.getByLabel('Invoice address').tap();
      await expectNoPageOverflow(page);
      expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    } finally {
      await context.close();
    }
  });

  for (const theme of ['dark', 'light']) {
    test(`mobile accessibility in ${theme} theme`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('paytruth-theme', value), theme);
      for (const route of ['/', '/merchant/new', `/verify?invoice=${fixtureSpecs.claimed.pda}`]) {
        await page.goto(appPath(route));
        await settlePage(page);
        if (route === '/') await page.getByRole('button', { name: 'Open menu' }).click();
        const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
        await expectNoPageOverflow(page);
      }
    });
  }

});
