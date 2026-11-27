import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { fixtureSpecs } from '../../components/ui/sdk/fixtures';

const routes: { name: string; path: string }[] = [
  { name: 'landing', path: '/' },
  { name: 'merchant-new', path: '/merchant/new' },
  { name: 'pay-open', path: `/pay/${fixtureSpecs.open.pda}` },
  { name: 'pay-overpaid', path: `/pay/${fixtureSpecs.overpaid.pda}` },
  { name: 'pay-expired', path: `/pay/${fixtureSpecs.expired.pda}` },
  { name: 'merchant-paid', path: `/merchant/${fixtureSpecs.paid.pda}` },
  { name: 'verify-claimed', path: `/verify/${fixtureSpecs.claimed.pda}` },
  { name: 'states', path: '/states' },
];

const OUT = join(process.cwd(), 'tests/ui/axe');

test.describe('accessibility', () => {
  for (const theme of ['dark', 'light'] as const)
  for (const route of routes) {
    test(`axe (${theme}): ${route.name}`, async ({ page }) => {
      if (theme === 'light') {
        await page.addInitScript(() => window.localStorage.setItem('paytruth-theme', 'light'));
      }
      await page.goto(route.path);
      await page.waitForLoadState('networkidle');
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();

      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        join(OUT, `${theme}-${route.name}.json`),
        JSON.stringify({ route: route.path, theme, violations: scan.violations.length, passes: scan.passes.length, details: scan.violations }, null, 2),
      );

      expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
    });
  }
});
