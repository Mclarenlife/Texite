const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
(async () => {
  await fs.mkdir('.qa', { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.TEXITE_BROWSER_PATH ? { executablePath: process.env.TEXITE_BROWSER_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('textbox', { name: 'LaTeX 源码编辑器' }).waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: '.qa/workspace-light.png', fullPage: true });
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await page.screenshot({ path: '.qa/workspace-dark.png', fullPage: true });
  await page.getByRole('button', { name: '专注', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.qa/workspace-focus.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '校对', exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.qa/workspace-mobile.png', fullPage: true });
  console.log(
    JSON.stringify({
      errors,
      overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    }),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
