import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'mobile.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    launchOptions: { executablePath: process.env.TEXITE_BROWSER_PATH },
  },
  webServer: {
    command: 'pnpm exec vite preview --mode android --host 127.0.0.1 --port 5184',
    url: 'http://127.0.0.1:5184/android.html',
    reuseExistingServer: true,
  },
});
