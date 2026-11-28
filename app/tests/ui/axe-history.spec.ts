import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { appPath } from '../paths';

test('axe: /invoices with a status filter and inline history expanded', async ({ page }) => {
  await page.goto(appPath('/invoices/'));
  await page.getByRole('tablist', { name: 'Filter by status' }).getByRole('tab', { name: /^Paid\s*,/ }).click();
  await page.getByRole('button', { name: 'Show history' }).first().click();
  await expect(page.getByText('Invoice created').first()).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    console.log(`axe history ${width}px: ${r.violations.length} violations, ${r.passes.length} passes`);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  }
});
