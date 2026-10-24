import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test('Android workspace edits, persists, imports and compiles Chinese fully offline', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const external: string[] = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.protocol !== 'data:') {
      external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/android.html');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByPlaceholder('输入名称').fill('安卓中文');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('region', { name: '文稿编辑器' })).toBeVisible();
  await page.getByRole('button', { name: '编译', exact: true }).click();
  await page
    .getByRole('button', { name: '停止', exact: true })
    .waitFor({ state: 'hidden', timeout: 130_000 });
  await expect(page.locator('.texite-text-layer')).toContainText('离线中文文稿');
  await expect(page.getByRole('tab', { name: /编译诊断/ })).toContainText('0');
  await page.screenshot({ path: '.qa/android-phone.png' });
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByPlaceholder('章节/intro.tex').fill('章节/intro.tex');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.locator('.cm-content').fill('可持久保存的中文段落');
  await expect(page.locator('.mobile-heading small')).toHaveText('已保存');
  await page.reload();
  await page.getByRole('button', { name: /安卓中文/ }).click();
  await expect(page.locator('.cm-content')).toContainText('可持久保存的中文段落');
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('.mobile-preview-pane')).toBeVisible();
  await expect(page.locator('.texite-text-layer')).toContainText('离线中文文稿');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.qa/android-tablet.png' });
  expect(external).toEqual([]);
});

test('ZIP round trip keeps nested files and generates a continuous two-page PDF', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const zip = new JSZip();
  zip.file(
    'main.tex',
    String.raw`\documentclass{article}
\begin{document}
\input{sections/intro}
\newpage Second page
\end{document}`,
  );
  zip.file('sections/intro.tex', 'Nested file content');
  await page.goto('/android.html');
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'nested.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
  await expect(page.locator('.mobile-heading strong')).toHaveText('nested');
  await page.getByRole('button', { name: '编译', exact: true }).click();
  await page
    .getByRole('button', { name: '停止', exact: true })
    .waitFor({ state: 'hidden', timeout: 110_000 });
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect(page.locator('.texite-text-layer').first()).toContainText('Nested file content');
  await expect(page.locator('.texite-text-layer').last()).toContainText('Second page');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const archive = await downloaded;
  expect(archive.suggestedFilename()).toBe('nested.zip');
  const readable = await archive.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of readable!) chunks.push(Buffer.from(chunk));
  const exported = await JSZip.loadAsync(Buffer.concat(chunks));
  expect(await exported.file('sections/intro.tex')!.async('string')).toBe('Nested file content');
  expect(exported.file('main.pdf')).not.toBeNull();
});

test('English bibliography resolves, errors stay diagnostic, and cancellation stops worker', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/android.html');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByPlaceholder('输入名称').fill('English');
  await page.getByRole('button', { name: '英文论文', exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('button', { name: '编译', exact: true }).click();
  await page
    .getByRole('button', { name: '停止', exact: true })
    .waitFor({ state: 'hidden', timeout: 130_000 });
  await expect(page.locator('.texite-text-layer')).toContainText('Research');
  await page.getByRole('tab', { name: /编译诊断/ }).click();
  await expect(page.getByText(/Citation .* undefined/)).toHaveCount(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page
    .locator('.cm-content')
    .fill('\\documentclass{article}\n\\begin{document}\n\\missingcommand\n\\end{document}');
  await page.getByRole('button', { name: '编译', exact: true }).click();
  await page
    .getByRole('button', { name: '停止', exact: true })
    .waitFor({ state: 'hidden', timeout: 130_000 });
  await expect(page.getByText(/Undefined control sequence/).first()).toBeVisible();
  await page.getByRole('button', { name: '编译', exact: true }).click();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('编译已取消');
});
