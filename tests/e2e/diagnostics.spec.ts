import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('PDF diagnostics copy separately from locating, restore Code/split, and retain editor height', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const zip = new JSZip();
  zip.file(
    'main.tex',
    '\\documentclass{article}\n\\begin{document}\n\\input{chapters/intro}\n\\end{document}',
  );
  zip.file('chapters/intro.tex', 'First\nSecond\nThird\n\\badcommand\nLast');
  await page.locator('input[accept=".zip"]').setInputFiles({
    name: 'diagnostics.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.getByRole('button', { name: 'intro.tex', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.texite = {
      compile: async (p) => ({
        success: false,
        revision: p.revision,
        log: 'LaTeX Warning: Reference missing on input line 3.\nC:/cache/chapters/intro.tex:4: Undefined control sequence.\n/texlive/missing.sty:8: External error.\n!pdfTeX error: Font ptmb8r at 58 not found',
      }),
    } as NonNullable<Window['texite']>;
  });
  const editorPane = page.getByRole('region', { name: '编辑区域' });
  const height = (await editorPane.boundingBox())!.height;
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  const preview = page.getByRole('region', { name: 'PDF 预览' });
  const diagnostics = preview.getByRole('region', { name: '编译诊断' });
  await expect(diagnostics).toContainText('Undefined control sequence');
  expect((await editorPane.boundingBox())!.height).toBeCloseTo(height, 0);
  await expect(page.locator('.status-bar .diagnostics')).toHaveCount(0);
  await expect(diagnostics.getByRole('button', { name: '无源码位置' })).toHaveCount(2);
  await expect(diagnostics.getByRole('button', { name: '无源码位置' }).first()).toBeDisabled();
  await diagnostics
    .getByTitle('点击复制诊断信息')
    .filter({ hasText: 'Undefined control sequence' })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Undefined control sequence.');
  await expect(page.locator('.editor-tab')).toContainText('main.tex');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: '仅 PDF', exact: true }).click();
  await diagnostics
    .getByRole('button', { name: '定位到 chapters/intro.tex:4', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '拆分', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.editor-tab')).toContainText('chapters/intro.tex');
  await expect(page.locator('.editor-footer')).toContainText('行 4');
  await page.screenshot({ path: '.qa/pdf-diagnostics.png', animations: 'disabled' });
  await diagnostics.getByRole('button', { name: '关闭诊断' }).click();
  await expect(diagnostics.locator('.diagnostics-body')).toHaveCount(0);
  await page.getByRole('button', { name: '仅编辑器', exact: true }).click();
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(diagnostics.locator('.diagnostics-body')).toBeVisible();
});

test('default editor syntax colors match settings previews and follow system appearance', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const colors = () =>
    page.evaluate(() =>
      [
        '--editor-text',
        '--syntax-keyword',
        '--syntax-string',
        '--syntax-comment',
        '--syntax-punctuation',
      ].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()),
    );
  const light = await colors();
  expect(new Set(light).size).toBe(5);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('radio', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(colors).not.toEqual(light);
  expect(new Set(await colors()).size).toBe(5);
  await page.getByRole('tab', { name: '编辑器文字', exact: true }).click();
  await page.screenshot({ path: '.qa/default-syntax-colors.png', animations: 'disabled' });
});
