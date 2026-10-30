import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
function multiPagePdf(heights = [840, 840, 840]) {
  const count = heights.length;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${heights.map((_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${count} >>`,
    ...heights.map(
      (height) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 ${height}] /Resources << >> /Contents ${count + 3} 0 R >>`,
    ),
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${count + 4}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, '0') + ' 00000 n ')
    .join('\n')}\ntrailer\n<< /Size ${count + 4} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
test('PDF is continuous, page controls scroll and scrolling updates the current page', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/sample.pdf', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: multiPagePdf() }),
  );
  await page.goto('/');
  await expect(page.locator('.pdf-page')).toHaveCount(3, { timeout: 20000 });
  const first = page.locator('.pdf-page[data-page="1"]'),
    second = page.locator('.pdf-page[data-page="2"]');
  const one = await first.boundingBox(),
    two = await second.boundingBox();
  expect(two!.y).toBeGreaterThan(one!.y + one!.height);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByLabel('PDF 页码')).toHaveValue('2');
  await expect
    .poll(() => page.locator('.pdf-scroll').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(200);
  await expect(page.locator('.pdf-page')).toHaveCount(3);
  await expect.poll(() => second.locator('canvas').evaluate((el) => el.width)).toBeGreaterThan(0);
  await page.getByLabel('PDF 页码').fill('3');
  await page.getByLabel('PDF 页码').press('Enter');
  await expect(page.getByLabel('PDF 页码')).toHaveValue('3');
  await page.locator('.pdf-scroll').evaluate((el) => el.scrollTo(0, 0));
  await expect(page.getByLabel('PDF 页码')).toHaveValue('1');
  await page.getByRole('button', { name: '缩小 PDF' }).click();
  await expect(page.getByRole('button', { name: '适合宽度' })).toHaveText('90%');
  await page.screenshot({ animations: 'disabled', path: '.qa/continuous-pdf.png' });
  await page.getByLabel('PDF 页码').fill('3');
  await page.getByLabel('PDF 页码').press('Enter');
  const preservedScroll = await page.locator('.pdf-scroll').evaluate((el) => el.scrollTop);
  await page.evaluate(
    (pdf) => {
      window.texite = {
        compile: async (project) => ({
          success: true,
          pdf,
          log: 'compiled',
          revision: project.revision,
        }),
      } as NonNullable<Window['texite']>;
    },
    [...multiPagePdf()],
  );
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByText('编译完成，PDF 已更新。')).toBeVisible();
  await expect(page.locator('.pdf-page')).toHaveCount(3);
  await expect(page.getByLabel('PDF 页码')).toHaveValue('3');
  await expect(page.locator('.pdf-page')).toHaveCount(3);
  await expect
    .poll(async () =>
      Math.abs(
        (await page.locator('.pdf-scroll').evaluate((el) => el.scrollTop)) - preservedScroll,
      ),
    )
    .toBeLessThan(3);

  await page.getByRole('tab', { name: /编译诊断/ }).click();
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(3);
  await expect(page.getByLabel('PDF 页码')).toHaveValue('3');
  await expect
    .poll(async () =>
      Math.abs(
        (await page.locator('.pdf-scroll').evaluate((el) => el.scrollTop)) - preservedScroll,
      ),
    )
    .toBeLessThan(3);

  await page.getByRole('button', { name: '仅编辑器', exact: true }).click();
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('button', { name: '编译文稿', exact: false })).toBeEnabled();
  await page.getByRole('button', { name: '拆分', exact: true }).click();
  await expect(page.getByLabel('PDF 页码')).toHaveValue('3');
  await expect
    .poll(async () =>
      Math.abs(
        (await page.locator('.pdf-scroll').evaluate((el) => el.scrollTop)) - preservedScroll,
      ),
    )
    .toBeLessThan(3);

  await page.evaluate(
    (pdf) => {
      window.texite!.compile = async (p) => ({
        success: true,
        pdf,
        log: 'shorter PDF',
        revision: p.revision,
      });
    },
    [...multiPagePdf([840])],
  );
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(1);
  await expect(page.getByLabel('PDF 页码')).toHaveValue('1');
  expect(await page.locator('.pdf-scroll').evaluate((el) => Number.isFinite(el.scrollTop))).toBe(
    true,
  );

  expect(errors).toEqual([]);
});
test('appearance, accents, contrast, fonts and sidebar width persist independently', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const resize = page.getByRole('separator', { name: '调整侧栏宽度' });
  await resize.focus();
  await resize.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', '256');
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + 100);
  await page.mouse.up();
  await expect(resize).toHaveAttribute('aria-valuenow', '306');
  await expect
    .poll(() =>
      page
        .locator('.project-sidebar')
        .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    )
    .toBe(306);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('radio', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: '鸢尾', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: '.qa/settings-appearance.png' });
  await page.getByRole('tab', { name: '编辑器文字', exact: true }).click();
  await page.getByRole('radio', { name: '高对比', exact: true }).click();
  await page.getByRole('radio', { name: '衬线 / 宋体', exact: true }).click();
  await page.getByRole('button', { name: '调整正文颜色', exact: true }).click();
  await page.getByRole('textbox', { name: '正文颜色 HEX', exact: true }).fill('#f4d59d');
  await page.screenshot({ animations: 'disabled', path: '.qa/settings-dark.png' });
  await page.getByRole('button', { name: '关闭颜色编辑', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-scroller')).toHaveCSS('font-family', /Georgia/);
  await expect(page.locator('.cm-editor')).toHaveCSS('color', 'rgb(244, 213, 157)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'violet');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
  await expect(resize).toHaveAttribute('aria-valuenow', '306');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '跟随系统', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('tab', { name: '编辑器文字', exact: true }).click();
  await page.getByRole('button', { name: '调整正文颜色', exact: true }).click();
  await page.getByRole('button', { name: '跟随主题', exact: true }).click();
  await page.getByRole('tab', { name: '外观与主题', exact: true }).click();
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
test('history groups typing and displays persisted additions and deletions with line numbers', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await page.getByLabel('文件路径').fill('history.tex');
  await page.getByRole('button', { name: '创建文件', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('keep\nold line\nend');
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.history-list > button')).toHaveCount(1);
  // A pause starts a new logical edit, while the two insertions below remain one record.
  await page.waitForTimeout(1600);
  await editor.fill('keep\nnew line\nend');
  await editor.press('Control+End');
  await page.keyboard.insertText('\nadded');
  await expect(page.locator('.history-list > button')).toHaveCount(2);
  await page.locator('.history-list > button').first().click();
  const review = page.getByLabel('修改内容对比');
  await expect(review.locator('.diff-removed')).toContainText('old line');
  await expect(review.locator('.diff-added')).toHaveCount(2);
  await expect(review.locator('.diff-removed > span').first()).toHaveText('2');
  await expect(review.locator('.diff-added').first().locator('span').nth(1)).toHaveText('2');
  await page.screenshot({ animations: 'disabled', path: '.qa/history-diff.png' });
  await page.getByRole('button', { name: '返回编辑' }).click();
  await expect(editor).toContainText('new line');
  await expect(page.getByText('本地恢复副本已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.history-list > button')).toHaveCount(2);
  await page.locator('.history-list > button').first().click();
  await expect(review.locator('.diff-removed')).toContainText('old line');
});
test('Visual renders nested formatting, lists, tables, images, included files and aligned math without rewriting source', async ({
  page,
}) => {
  const source = String.raw`\documentclass{article}
\usepackage{amsmath,graphicx}
\begin{document}
\section{A \textbf{bold \emph{nested}} heading}
\begin{itemize}
\item First item
\begin{enumerate}
\item Nested item
\end{enumerate}
\item Second item
\end{itemize}
\begin{table}
\caption{Results}
\begin{tabular}{ll}
\toprule
Name & Value \\
\midrule
Alpha & $x^2$ \\
\bottomrule
\end{tabular}
\end{table}
\begin{figure}
\includegraphics{assets/dot.png}
\caption{Local image}
\end{figure}
\begin{align}
x &= 1 \\
y &= 2
\end{align}
\input{chapters/intro}
\myunknown{preserved}
\end{document}`;
  const zip = new JSZip();
  zip.file('main.tex', source);
  zip.file('chapters/intro.tex', 'Included paragraph with \\textbf{bold words}.');
  zip.file(
    'assets/dot.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await page.goto('/');
  await page.locator('input[accept=".zip"]').setInputFiles({
    name: 'visual.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.visual-section strong em')).toHaveText('nested');
  await expect(page.locator('.visual-list ol li')).toContainText('Nested item');
  await expect(page.locator('.visual-table tr')).toHaveCount(2);
  await expect(page.locator('.visual-table td').nth(2)).toHaveText('Alpha');
  await expect(page.locator('.visual-image')).toBeVisible();
  await expect(page.locator('.visual-math .katex')).toHaveCount(1);
  await expect(page.locator('.katex-error')).toHaveCount(0);
  await expect(page.locator('.visual-include')).toContainText('Included paragraph');
  await expect(page.locator('.visual-unsupported').filter({ hasText: 'myunknown' })).toBeVisible();
  await page.getByRole('button', { name: '仅编辑器', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: '.qa/visual-rich.png' });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const exported = await JSZip.loadAsync(await readFile((await (await event).path())!));
  expect(await exported.file('main.tex')!.async('string')).toBe(source);
  await page.getByRole('button', { name: '打开 chapters/intro.tex', exact: true }).click();
  await expect(page.locator('.editor-tab')).toContainText('chapters/intro.tex');
});

test('Visual keeps editing boundaries stable while nested braces are incomplete', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.locator('.visual-section .visual-content').first().click();
  const heading = page.getByRole('textbox', { name: '编辑标题' });
  await heading.fill(String.raw`A \textbf{`);
  await expect(heading).toHaveValue(String.raw`A \textbf{`);
  await heading.press('End');
  await page.keyboard.insertText('bold} heading');
  await expect(heading).toHaveValue(String.raw`A \textbf{bold} heading`);
  await heading.press('Escape');
  await expect(page.locator('.visual-section strong').first()).toHaveText('bold');
  await expect(page.locator('.visual-section').nth(1)).toContainText('Method');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await download).path())!));
  const content = await zip.file('main.tex')!.async('string');
  expect(content).toContain(String.raw`\section{A \textbf{bold} heading}`);
  expect(content).toContain(String.raw`\bibliographystyle{plain}`);
});
