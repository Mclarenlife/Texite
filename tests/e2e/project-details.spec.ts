import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('context deletion confirms, removes nested content, persists and restores from automatic backup', async ({
  page,
}) => {
  const zip = new JSZip();
  zip.file('main.tex', '\\documentclass{article}\n\\begin{document}Main\\end{document}');
  zip.file('notes/child/note.tex', 'Keep this note');
  zip.file('notes/child/image.png', Buffer.from([0, 255, 128]));
  zip.folder('notes/empty');
  await page.goto('/');
  await page.locator('input[accept=".zip"]').setInputFiles({
    name: 'Delete test.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  const folder = page.locator('.file-tree button[title="notes"]');
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除文件夹？' })).toContainText(
    '所有子文件夹与文件',
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(folder).toBeVisible();
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(folder).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.file-tree button[title="main.tex"]')).toBeVisible();
  await expect(folder).toHaveCount(0);
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await page.getByRole('button', { name: '还原备份 删除前自动备份 · notes', exact: true }).click();
  await page.getByRole('button', { name: '项目文件', exact: true }).click();
  await expect(folder).toBeVisible();
  await expect(page.locator('.file-tree button[title="notes/child/image.png"]')).toBeVisible();
  await page.locator('.file-tree button[title="main.tex"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.editor-tab')).toContainText('notes/child/note.tex');
  await folder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('添加文件，开始编辑')).toBeVisible();
  await page.reload();
  await expect(page.getByText('添加文件，开始编辑')).toBeVisible();
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('请先创建 .tex');
});

test('undo redo, hierarchical outline and About settings use consistent workspace spacing', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await expect(editor).toBeVisible();
  await editor.fill(
    '\\section{Parent}\n\\subsection{Child}\n\\subsubsection{Detail}\n\\section{Next}\nText',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(editor).toContainText('Research Notes');
  await expect(editor).not.toContainText('Parent');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(editor).toContainText('Detail');
  await page.getByRole('button', { name: '折叠 Child', exact: true }).click();
  await expect(page.locator('.outline-title').filter({ hasText: 'Detail' })).toHaveCount(0);
  await page.getByRole('button', { name: '折叠全部标题' }).click();
  await expect(page.locator('.outline-title')).toHaveCount(2);
  await page.getByRole('button', { name: '展开全部标题' }).click();
  await expect(page.locator('.outline-title')).toHaveCount(4);
  await page.getByRole('button', { name: 'Detail', exact: true }).click();
  await expect(page.locator('.editor-footer')).toContainText('行 3');
  const bounds = await page.evaluate(() => {
    const rect = (q: string) => document.querySelector(q)!.getBoundingClientRect();
    const header = rect('.app-header'),
      status = rect('.status-bar'),
      editor = rect('.editor-pane'),
      pdf = rect('.preview-container');
    return [
      editor.top - header.bottom,
      pdf.top - header.bottom,
      status.top - editor.bottom,
      status.top - pdf.bottom,
      innerWidth - pdf.right,
      pdf.left - editor.right,
    ];
  });
  for (const gap of bounds) expect(Math.abs(gap - 12)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '.qa/preview-0.9.5-workspace.png', animations: 'disabled' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '关于', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('0.9.0-preview.5');
  await expect(page.getByRole('link', { name: /作者官网/ })).toHaveAttribute(
    'href',
    'https://mclarenlife.github.io/',
  );
  await expect(page.getByRole('link', { name: /GitHub 项目/ })).toHaveAttribute(
    'href',
    'https://github.com/Mclarenlife/Texite',
  );
  await page.screenshot({ path: '.qa/preview-0.9.5-about.png', animations: 'disabled' });
});

test('successful compilation creates a persistent first-page cover and a failed compilation keeps it', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.evaluate(async () => {
    const pdf = Array.from(new Uint8Array(await (await fetch('./sample.pdf')).arrayBuffer()));
    window.texite = {
      compile: async (p) => ({ success: true, revision: p.revision, pdf, log: '' }),
      saveProject: async () => ({}),
    } as NonNullable<Window['texite']>;
  });
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('编译完成');
  await page.getByRole('button', { name: '项目首页' }).click();
  const cover = page.locator('.project-pdf-cover');
  await expect(cover).toBeVisible();
  const image = await cover.getAttribute('src');
  expect(image?.startsWith('data:image/jpeg')).toBeTruthy();
  await expect
    .poll(() => cover.evaluate((e: HTMLImageElement) => e.naturalWidth))
    .toBeGreaterThan(400);
  const title = await page.locator('.project-open > strong').first().boundingBox(),
    subtitle = await page.locator('.project-open > span').first().boundingBox();
  expect(title!.x).toBe(subtitle!.x);
  await page.screenshot({ path: '.qa/preview-0.9.5-cover.png', animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: '项目首页' }).click();
  await expect(cover).toHaveAttribute('src', image!);
  await page.getByRole('button', { name: '打开项目 示例项目', exact: true }).click();
  await page.evaluate(() => {
    window.texite = {
      compile: async (p) => ({ success: false, revision: p.revision, log: '! Compilation failed' }),
    } as NonNullable<Window['texite']>;
  });
  await page.getByRole('button', { name: '编译文稿', exact: false }).click();
  await expect(page.getByRole('status')).toContainText('编译未完成');
  await page.evaluate(() => {
    window.texite = undefined;
  });
  await page.getByRole('button', { name: '项目首页' }).click();
  await expect(cover).toHaveAttribute('src', image!);
});
