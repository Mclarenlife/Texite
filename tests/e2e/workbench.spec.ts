import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

test('edit, retain undo across files, restore after reload, and export project', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n% persistence check');
  await page.getByRole('button', { name: 'references.bib', exact: true }).click();
  await page.getByRole('button', { name: 'main.tex 主文件', exact: true }).click();
  await editor.click();
  await page.keyboard.press('Control+z');
  await expect(editor).not.toContainText('persistence check');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+End');
  await expect(editor).toContainText('persistence check');
  await expect(page.getByText('本地恢复副本已保存', { exact: true })).toBeVisible();
  await page.reload();
  await editor.click();
  await page.keyboard.press('Control+End');
  await expect(editor).toContainText('persistence check');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(errors).toEqual([]);
});
test('mode changes preserve editor selection and browser compile is clearly unavailable', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: '仅编辑器', exact: true }).click();
  await expect(page.getByRole('region', { name: 'PDF 预览' })).not.toBeVisible();
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: '仅 PDF', exact: true }).click();
  await expect(page.getByRole('region', { name: 'PDF 预览' })).toBeVisible();
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('dialog')).toContainText('浏览器 WASM 编译尚未接入');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('create files and search, command dialog keyboard close, narrow layout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await page.getByLabel('文件路径').fill('chapters/intro.tex');
  await page.getByRole('button', { name: '创建文件', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.click();
  await page.keyboard.insertText('Unique research note');
  await page.getByRole('button', { name: '项目搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索项目内容' }).fill('Unique');
  await expect(page.getByRole('button', { name: /chapters\/intro.tex : 1/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await page.getByRole('button', { name: '仅 PDF', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ZIP import and export preserve binary resources and main-file metadata', async ({ page }) => {
  const zip = new JSZip();
  zip.file(
    'chapters/main.tex',
    '\\documentclass{article}\n\\begin{document}ZIP round trip\\end{document}',
  );
  const asset = Buffer.from([0, 255, 13, 10, 9, 128]);
  zip.file('assets/data.bin', asset);
  zip.file(
    '.texite.json',
    JSON.stringify({ name: 'Imported project', mainFile: 'chapters/main.tex', engine: 'pdflatex' }),
  );
  await page.goto('/');
  await page.locator('input[type=file][accept=".zip"]').setInputFiles({
    name: 'project.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'ZIP round trip',
  );
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const result = await event;
  const data = await JSZip.loadAsync(await readFile((await result.path())!));
  expect(await data.file('assets/data.bin')!.async('nodebuffer')).toEqual(asset);
  expect(JSON.parse(await data.file('.texite.json')!.async('string')).mainFile).toBe(
    'chapters/main.tex',
  );
});

test('compiled revision stays visibly stale after edits and a failed compile preserves PDF', async ({
  page,
}) => {
  const bytes = [...(await readFile('public/sample.pdf'))];
  await page.addInitScript((pdf) => {
    let count = 0;
    window.texite = {
      openProject: async () => null,
      listProjects: async () => [],
      reopenProject: async () => null,
      importProject: async (p) => p,
      saveProject: async () => ({ cancelled: true }),
      detectEngines: async () => ({
        bundled: true,
        latexmk: true,
        engines: { tectonic: true, pdflatex: true, xelatex: true, lualatex: true },
      }),
      onCompileLog: () => () => {},
      cancelCompile: async () => {},
      compile: async (project) => {
        count++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return count === 1
          ? { success: true, pdf, log: 'compiled', revision: project.revision }
          : {
              success: false,
              log: 'main.tex:4: Undefined control sequence.',
              revision: project.revision,
            };
      },
    };
  }, bytes);
  await page.goto('/');
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n% a newer edit');
  await expect(page.getByText('编译完成，PDF 已更新。')).toBeVisible();
  await expect(page.getByText('源码已更新 · 当前保留上次预览')).toBeVisible();
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.locator('.diagnostics')).toContainText('Undefined control sequence');
  await expect(page.locator('.pdf-scroll canvas')).toBeVisible();
});

test('project space imports ZIP, creates nested and empty folders, and returns via logo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '项目首页' }).click();
  const space = page.getByRole('region', { name: '项目空间', exact: true });
  await expect(space).toBeVisible();
  await expect(space.getByRole('button', { name: '导入 ZIP' })).toBeVisible();
  const zip = new JSZip();
  zip.file(
    'wrapped/main.tex',
    '\\documentclass{article}\n\\begin{document}Archive test\\end{document}',
  );
  zip.folder('wrapped/assets/empty');
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles({
      name: 'wrapped.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
  await expect(space).not.toBeVisible();
  await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
  await page.getByLabel('文件夹路径').fill('chapters/drafts');
  await page.getByRole('dialog').getByRole('button', { name: '创建文件夹', exact: true }).click();
  await expect(page.locator('.file-tree button[title="chapters/drafts"]')).toBeVisible();
  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await expect(page.getByLabel('文件路径')).toHaveValue('chapters/drafts/');
  await page.getByLabel('文件路径').fill('chapters/drafts/note.tex');
  await page.getByRole('button', { name: '创建文件', exact: true }).click();
  await expect(page.locator('.file-tree button[title="chapters/drafts/note.tex"]')).toBeVisible();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const exported = await JSZip.loadAsync(await readFile((await (await event).path())!));
  expect(exported.file('main.tex')).not.toBeNull();
  expect(exported.files['assets/empty/'].dir).toBe(true);
  expect(exported.file('chapters/drafts/note.tex')).not.toBeNull();
  await page.getByRole('button', { name: '项目首页' }).click();
  await expect(space.locator('.project-card')).toHaveCount(2);
});

test('visual editing preserves unsupported LaTeX and Code history, PDF controls are functional', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.pdf-scroll canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: '导入 PDF' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '专注', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.visual-section').first()).toContainText('Introduction');
  await expect(page.locator('.visual-math .katex')).toBeVisible();
  await page.locator('.visual-section .visual-content').first().click();
  await page.getByRole('textbox', { name: '编辑标题' }).fill('Changed introduction');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await event).path())!));
  const source = await zip.file('main.tex')!.async('string');
  expect(source).toContain('\\section{Changed introduction}');
  expect(source).toContain('\\bibliographystyle{plain}');
  await editor.click();
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(page.locator('.visual-section').first()).toContainText('Introduction');
  await page.getByRole('button', { name: 'PDF 暗色模式' }).click();
  await expect(page.locator('.pdf-pane')).toHaveAttribute('data-pdf-dark', 'true');
  await page.getByRole('button', { name: '放大 PDF' }).click();
  await expect(page.getByRole('button', { name: '适合宽度' })).toHaveText('110%');
  await page.getByRole('button', { name: '适合宽度' }).click();
  await expect(page.getByRole('button', { name: '适合宽度' })).toHaveText('100%');
  await page.getByRole('textbox', { name: 'PDF 页码' }).fill('999');
  await page.getByRole('textbox', { name: 'PDF 页码' }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'PDF 页码' })).toHaveValue('1');
});
