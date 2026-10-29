import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test('active entry compiles, successful entry persists, failure and assets reuse it', async ({
  page,
}) => {
  const installMock = async () =>
    page.evaluate(
      (pdf) => {
        const calls: string[] = [];
        (window as any).compileCalls = calls;
        window.texite = {
          openProject: async () => null,
          listProjects: async () => [],
          reopenProject: async () => null,
          importProject: async (p) => p,
          saveProject: async () => ({ cancelled: true }),
          detectEngines: async () => ({
            bundled: true,
            latexmk: true,
            engines: { pdflatex: true, xelatex: false, lualatex: false, tectonic: false },
          }),
          onCompileLog: () => () => {},
          cancelCompile: async () => {},
          compile: async (p) => {
            calls.push(p.mainFile);
            return p.mainFile === 'main.tex'
              ? {
                  success: false,
                  revision: p.revision,
                  log: 'main.tex:2: Undefined control sequence.',
                }
              : { success: true, revision: p.revision, pdf, log: 'PDF ready' };
          },
        };
      },
      [...pdfBytes],
    );
  const pdfBytes = await readFile('public/sample.pdf');
  const zip = new JSZip();
  zip.file('main.tex', '\\documentclass{article}\n\\begin{document}\\badcommand\\end{document}');
  zip.file('paper.tex', '\\documentclass{article}\n\\begin{document}Paper\\end{document}');
  zip.file('refs.bib', '@book{example,title={Example}}');
  await page.goto('/');
  await expect(page.locator('.pdf-scroll canvas').first()).toBeVisible();
  await installMock();
  await page.getByRole('button', { name: '项目首页' }).click();
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles({
      name: 'entry-test.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
  await page.locator('.file-tree button[title="paper.tex"]').click();
  const compile = page.getByRole('button', { name: '编译文稿', exact: false });
  await compile.click();
  await expect(page.locator('.pdf-scroll canvas').first()).toBeVisible();
  await expect(page.getByText('编译完成，PDF 已更新。', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).compileCalls)).toEqual(['paper.tex']);
  await page.locator('.file-tree button[title="main.tex"]').click();
  await compile.click();
  await expect(
    page.getByText('已编译 paper.tex；当前打开的文件未作为入口。', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).compileCalls))
    .toEqual(['paper.tex', 'main.tex', 'paper.tex']);
  await page.reload();
  await installMock();
  await page.locator('.file-tree button[title="refs.bib"]').click();
  await compile.click();
  await expect.poll(() => page.evaluate(() => (window as any).compileCalls)).toEqual(['paper.tex']);
});
