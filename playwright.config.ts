import { defineConfig } from '@playwright/test';
const port = Number(process.env.TEXITE_E2E_PORT ?? 5273);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TEXITE_E2E_PORT');
const baseURL = 'http://127.0.0.1:' + port;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.TEXITE_BROWSER_PATH
      ? { executablePath: process.env.TEXITE_BROWSER_PATH }
      : {},
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --strictPort --port ' + port,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
