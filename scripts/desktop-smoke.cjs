const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');
(async () => {
  const base = path.resolve('.qa/desktop-' + Date.now());
  const folder = path.join(base, 'linked-project');
  const profile = path.join(base, 'profile');
  await fs.mkdir(folder, { recursive: true });
  const source =
    '\\documentclass{ctexart}\n\\begin{document}\n桌面离线测试\\newpage 第二页\n\\end{document}\n';
  await fs.writeFile(path.join(folder, 'main.tex'), source);
  let desktop;
  const errors = [];
  const launch = async () => {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: profile },
    });
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    });
    const page = await desktop.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (/translateFont failed|Unable to load.*CMap|Ensure that the.*cMapUrl/.test(message.text()))
        errors.push(message.text());
    });
    try {
      await page.getByRole('textbox', { name: 'LaTeX 源码编辑器' }).waitFor();
    } catch (error) {
      await fs.writeFile(path.join(base, 'startup.html'), await page.content());
      console.error('Desktop startup', { url: page.url(), errors });
      throw error;
    }
    return page;
  };
  try {
    let page = await launch();
    await desktop.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, folder);
    await page.getByRole('button', { name: '项目首页' }).click();
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await expect(editor).toContainText('桌面离线测试');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('% saved from Texite');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('项目已保存到磁盘');
    expect(await fs.readFile(path.join(folder, 'main.tex'), 'utf8')).toContain('saved from Texite');
    await page.getByRole('button', { name: '编译文稿', exact: false }).click();
    await expect(page.getByRole('status')).toContainText('编译完成', { timeout: 60000 });
    await expect(page.getByLabel('PDF 总页数')).toHaveText('/ 2');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByLabel('PDF 页码')).toHaveValue('2');
    await page.getByRole('button', { name: 'PDF 暗色模式' }).click();
    await expect(page.locator('.pdf-pane')).toHaveAttribute('data-pdf-dark', 'true');
    await page.getByRole('button', { name: '创建文件夹', exact: true }).click();
    await page.getByLabel('文件夹路径').fill('figures/empty');
    await page.getByRole('dialog').getByRole('button', { name: '创建文件夹', exact: true }).click();
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('项目已保存到磁盘');
    expect((await fs.stat(path.join(folder, 'figures/empty'))).isDirectory()).toBe(true);
    const zip = new JSZip();
    zip.file('main.tex', source.replace('桌面离线测试', 'ZIP 导入测试'));
    zip.folder('assets/empty');
    await page.getByRole('button', { name: '项目首页' }).click();
    await page.locator('input[accept=".zip"]').setInputFiles({
      name: 'Archive.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
    await expect(editor).toContainText('ZIP 导入测试');
    const projects = await page.evaluate(() => window.texite.listProjects());
    const imported = projects.find((p) => p.name === 'Archive');
    expect(imported.location.directory.startsWith(path.join(profile, 'projects'))).toBe(true);
    expect(
      (await fs.stat(path.join(imported.location.directory, 'assets/empty'))).isDirectory(),
    ).toBe(true);
    await page.getByRole('button', { name: '项目首页' }).click();
    await page.locator('.project-card').filter({ hasText: 'linked-project' }).click();
    await expect(editor).toContainText('saved from Texite');
    await fs.writeFile(path.join(folder, 'main.tex'), source + '% External edit');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n% conflict');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('外部修改');
    expect(await fs.readFile(path.join(folder, 'main.tex'), 'utf8')).toContain('% External edit');
    await desktop.close();
    desktop = null;
    page = await launch();
    await page.getByRole('button', { name: '项目首页' }).click();
    await page.locator('.project-card').filter({ hasText: 'Archive' }).click();
    await page.getByRole('button', { name: '项目首页' }).click();
    await page.locator('.project-card').filter({ hasText: 'linked-project' }).click();
    await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
      '% External edit',
    );
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('项目已保存到磁盘');
    await page.screenshot({ path: '.qa/desktop-smoke.png' });
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        offlineChinese: 'passed',
        pdfPagination: 'passed',
        folders: 'passed',
        zipManagedStorage: 'passed',
        conflictAndRelaunchBindings: 'passed',
        errors,
      }),
    );
  } finally {
    if (desktop) await desktop.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
