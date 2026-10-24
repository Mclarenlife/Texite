import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'mobile.spec.ts',
  workers: 1,
  use: { browserName: 'webkit', baseURL: 'http://127.0.0.1:5186' },
  webServer: {
    command: 'pnpm exec vite preview --mode ios --host 127.0.0.1 --port 5186',
    url: 'http://127.0.0.1:5186/android.html',
    reuseExistingServer: false,
  },
});
