import { defineConfig, devices } from '@playwright/test';

// Real-SDK build against devnet. Build first with `npm run build` (NEXT_PUBLIC_PAYTRUTH_SDK unset).
export default defineConfig({
  testDir: './tests/devnet',
  workers: 1,
  timeout: 180_000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3297', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'node scripts/serve-pages.mjs --port 3297',
    url: 'http://127.0.0.1:3297/paytruth/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
