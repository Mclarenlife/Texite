import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('layout diagnostics are grouped, retain navigation and copy, and explain EPS without hiding warnings', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(async () => {
    const pdf = Array.from(new Uint8Array(await (await fetch('./sample.pdf')).arrayBuffer()));
    window.texite = {
      saveProject: async () => ({ cancelled: true }),
      compile: async (p) => ({
        success: true,
        revision: p.revision,
        pdf,
        log: '(./main.tex\nPackage epstopdf Warning: Shell escape feature is not enabled.\nLaTeX Warning: Citation missing on input line 2.\nUnderfull \\hbox (badness 4403) in paragraph at lines 3--4\nUnderfull \\vbox (badness 10000) has occurred while \\output is active [7 <./figure.pdf>] [8]',
      }),
    } as NonNullable<Window['texite']>;
  });
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('编译完成');
  await expect(page.locator('.diagnostic-count')).toHaveClass(/diagnostic-warning/);
  await page.getByRole('tab', { name: /编译诊断/ }).click();
  const diagnostics = page.getByRole('region', { name: '编译诊断', exact: true });
  await expect(diagnostics.locator('.diagnostics-summary')).toHaveText(
    '0 个错误 · 2 个警告 · 2 条排版提示',
  );
  await expect(
    diagnostics.getByText('LaTeX Warning: Citation missing on input line 2.', { exact: true }),
  ).toBeVisible();
  await expect(
    diagnostics.locator('.diagnostic-message').filter({ hasText: 'epstopdf' }),
  ).toHaveAttribute('title', /未启用 EPS 图片自动转换/);
  await expect(diagnostics.getByText(/未启用 EPS 图片自动转换/)).toHaveCount(0);
  const layout = diagnostics.locator('.diagnostics-layout');
  await expect(layout.locator('.diagnostic-row').first()).toBeHidden();
  await layout.locator('summary').click();
  await expect(layout.locator('.diagnostic-row').first()).toBeVisible();
  await expect(layout).not.toContainText('figure.pdf');
  await layout.locator('.diagnostic-message').first().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Underfull \\hbox');
  await layout.getByRole('button', { name: '定位到 main.tex:3', exact: true }).click();
  await expect(page.locator('.editor-footer')).toContainText('行 3');
  await page.screenshot({ path: '.qa/diagnostics-grouped.png', animations: 'disabled' });
  await diagnostics.getByText('原始日志', { exact: true }).click();
  await expect(diagnostics.locator('pre')).toContainText('[7 <./figure.pdf>] [8]');
});

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
  await expect(page.locator('.diagnostic-count')).toHaveClass(/diagnostic-error/);
  await expect(preview.locator('.pdf-scroll')).toBeHidden();
  await expect(preview.getByRole('tab', { name: /编译诊断/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
  await preview.getByRole('tab', { name: 'PDF', exact: true }).click();
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

test('resolved citations leave the diagnostic list while full multi-pass output remains available', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const pdf = [...new Uint8Array(await (await fetch('/sample.pdf')).arrayBuffer())];
    window.texite = {
      compile: async (p) => ({
        success: true,
        revision: p.revision,
        pdf,
        log: "pdfLaTeX · 第 1 遍\n(./main.tex\nLaTeX Warning: Citation `resolved' on page 2 undefined on input line 70.\n)\npdfLaTeX · 第 2 遍\n(./main.tex\nOutput written on main.pdf\n)",
      }),
    } as NonNullable<Window['texite']>;
  });
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('编译完成');
  await page.getByRole('tab', { name: /^编译诊断\s*0$/ }).click();
  const diagnostics = page.getByRole('region', { name: '编译诊断', exact: true });
  await expect(diagnostics.locator('.diagnostic-row')).toHaveCount(0);
  await expect(diagnostics.locator('pre')).toBeHidden();
  await diagnostics.getByText('原始日志', { exact: true }).click();
  await expect(diagnostics.locator('pre')).toContainText("Citation `resolved'");
});
