const { chromium } = require('@playwright/test');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.TEXITE_BROWSER_PATH ? { executablePath: process.env.TEXITE_BROWSER_PATH } : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 512, height: 512 },
      deviceScaleFactor: 1,
    });
    const svg = await fs.readFile('public/favicon.svg', 'utf8');
    await page.setContent(
      '<style>body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>' +
        svg,
    );
    await fs.mkdir('build', { recursive: true });
    await page.screenshot({ path: 'build/icon.png', omitBackground: true });
    await page.setViewportSize({ width: 256, height: 256 });
    const png = await page.screenshot({ omitBackground: true });
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    await fs.writeFile('build/icon.ico', Buffer.concat([header, png]));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
