const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const base = path.resolve('.qa/navigation-native-' + Date.now()),
    folder = path.join(base, 'project');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, '.texite.json'),
    JSON.stringify({ name: 'Navigation test', mainFile: 'main.tex', engine: 'pdflatex' }),
  );
  const source =
    '\\documentclass{article}\n\\begin{document}\nFirst page text.\n\\newpage\nSelected second page words.\n\\input{chapter}\n\\end{document}\n';
  await fs.writeFile(path.join(folder, 'main.tex'), source);
  await fs.writeFile(path.join(folder, 'chapter.tex'), 'Included chapter text.');
  await fs.writeFile(path.join(folder, 'asset.bin'), Buffer.from([0, 255, 13, 128]));
  await fs.mkdir(path.join(folder, 'notes', 'nested'), { recursive: true });
  await fs.mkdir(path.join(folder, 'notes', 'empty'), { recursive: true });
  await fs.writeFile(path.join(folder, 'notes', 'nested', 'draft.txt'), 'Deletion recovery text');
  let desktop;
  const errors = [];
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: path.join(base, 'profile') },
    });
    await desktop.evaluate(({ dialog, BrowserWindow }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(false);
    }, folder);
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (e) => errors.push(e.message));
    const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await expect(editor).toBeVisible();
    await page.getByRole('button', { name: '项目首页' }).click();
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    await page.getByRole('button', { name: 'main.tex 主文件', exact: true }).click();
    await expect(editor).toContainText('Selected second page words.');
    await page.getByRole('button', { name: '编译文稿', exact: false }).click();
    await expect(page.getByRole('status')).toContainText('编译完成', { timeout: 90000 });
    await expect(page.locator('.pdf-page')).toHaveCount(2);
    const mac = process.platform === 'darwin';
    await editor.press(mac ? 'Meta+ArrowUp' : 'Control+Home');
    for (let i = 0; i < 4; i++) await editor.press('ArrowDown');
    await editor.press(mac ? 'Meta+ArrowLeft' : 'Home');
    await editor.press(mac ? 'Meta+Shift+ArrowRight' : 'Shift+End');
    await editor.press('Alt+Enter');
    await page.getByRole('button', { name: '定位到 PDF', exact: true }).click();
    await expect(page.getByLabel('PDF 页码')).toHaveValue('2');
    const pdfPage = page.locator('.pdf-page[data-page="2"]');
    await expect(pdfPage.locator('.pdf-locate-highlight').first()).toBeVisible();
    const span = pdfPage
      .locator('.texite-text-layer span')
      .filter({ hasText: 'Selected second page words.' })
      .first();
    await expect(span).toHaveCount(1);
    const bounds = await span.boundingBox();
    expect(bounds.width).toBeGreaterThan(40);
    expect(bounds.height).toBeGreaterThan(3);
    // Native PDF text-layer selection, followed by the UI's inverse-search action.
    await span.scrollIntoViewIfNeeded();
    await span.evaluate((el) => {
      document.activeElement?.blur();
      const r = document.createRange();
      const from = el.textContent.indexOf('Selected second page words.');
      r.setStart(el.firstChild, from);
      r.setEnd(el.firstChild, from + 'Selected second page words.'.length);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await span.dispatchEvent('mouseup');
    await expect(page.getByLabel('选中文字词数')).toHaveText('4 词');
    await page.getByRole('button', { name: '定位到源码', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('Selected second page words.');
    await expect(page.locator('.editor-footer')).toContainText('行 5');
    await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
    await page.screenshot({ path: path.join(base, 'bidirectional.png') });
    const included = pdfPage
      .locator('.texite-text-layer span')
      .filter({ hasText: 'Included chapter text.' })
      .first();
    await included.scrollIntoViewIfNeeded();
    await included.evaluate((el) => {
      document.activeElement?.blur();
      const text = el.textContent,
        from = text.indexOf('Included chapter text.');
      const r = document.createRange();
      r.setStart(el.firstChild, from);
      r.setEnd(el.firstChild, from + 'Included chapter text.'.length);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await included.dispatchEvent('mouseup');
    await page.getByRole('button', { name: '定位到源码', exact: true }).click();
    await expect(page.locator('.editor-tab')).toContainText('chapter.tex');
    await expect(editor).toHaveText('Included chapter text.');
    await page.getByRole('button', { name: 'main.tex 主文件', exact: true }).click();
    await page.getByRole('button', { name: '修改历史', exact: true }).click();
    await page.getByRole('button', { name: '备份当前项目', exact: true }).click();
    await page.getByLabel('备份备注').fill('Native baseline');
    await page.getByRole('button', { name: '保存备份', exact: true }).click();
    await expect(page.locator('.backup-row')).toHaveCount(1);
    await page.locator('input[type="file"][multiple]').setInputFiles({
      name: 'new-image.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0, 17, 255]),
    });
    await expect(page.getByRole('status')).toContainText('文件已加入项目');
    await page.getByRole('button', { name: '项目文件', exact: true }).click();
    await page.getByRole('button', { name: 'main.tex 主文件', exact: true }).click();
    await editor.fill(source.replace('First page text.', 'Modified version.'));
    await editor.press(mac ? 'Meta+s' : 'Control+s');
    await expect(page.getByRole('status')).toContainText('项目已保存到磁盘');
    expect([...(await fs.readFile(path.join(folder, 'new-image.bin')))]).toEqual([0, 17, 255]);
    await page.getByRole('button', { name: '修改历史', exact: true }).click();
    await page.getByRole('button', { name: '还原备份 Native baseline', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('项目已还原');
    expect(await fs.readFile(path.join(folder, 'main.tex'), 'utf8')).toBe(source);
    expect([...(await fs.readFile(path.join(folder, 'asset.bin')))]).toEqual([0, 255, 13, 128]);
    await expect(page.locator('.backup-row')).toHaveCount(2);
    await expect(fs.access(path.join(folder, 'new-image.bin'))).rejects.toThrow();
    await page
      .getByRole('button', { name: '还原备份 还原前自动备份 · Native baseline', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('项目已还原');
    await expect(page.locator('.backup-row')).toHaveCount(3);
    expect([...(await fs.readFile(path.join(folder, 'new-image.bin')))]).toEqual([0, 17, 255]);
    // A conflicting external edit must be preserved, and restoration must report the conflict.
    await page.getByRole('button', { name: '项目文件', exact: true }).click();
    await page.locator('.file-tree button[title="notes"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(await fs.readFile(path.join(folder, 'notes/nested/draft.txt'), 'utf8')).toBe(
      'Deletion recovery text',
    );
    await page.locator('.file-tree button[title="notes"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.locator('.file-tree button[title="notes"]')).toHaveCount(0);
    await expect(fs.access(path.join(folder, 'notes'))).rejects.toThrow();
    await page.getByRole('button', { name: '修改历史', exact: true }).click();
    await page
      .getByRole('button', { name: '还原备份 删除前自动备份 · notes', exact: true })
      .click();
    await expect(page.locator('.backup-row')).toHaveCount(5);
    expect(await fs.readFile(path.join(folder, 'notes/nested/draft.txt'), 'utf8')).toBe(
      'Deletion recovery text',
    );
    await page.getByRole('button', { name: '项目首页' }).click();
    await expect(page.locator('.project-pdf-cover')).toBeVisible();
    expect(
      await page.locator('.project-pdf-cover').evaluate((el) => el.naturalWidth),
    ).toBeGreaterThan(400);
    await page.getByRole('button', { name: '打开项目 Navigation test', exact: true }).click();
    // Project selection awaits disk persistence before closing the space and resetting dialogs.
    // Wait for that transition before opening Settings, otherwise the reset closes it again.
    await expect(
      page.getByRole('button', { name: '打开项目 Navigation test', exact: true }),
    ).toHaveCount(0);
    await expect(editor).toBeVisible();
    await desktop.evaluate(({ shell }) => {
      global.texiteExternalLinks = [];
      shell.openExternal = async (url) => {
        global.texiteExternalLinks.push(url);
      };
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '关于', exact: true }).click();
    await expect(page.getByRole('tabpanel')).toContainText(
      await desktop.evaluate(({ app }) => app.getVersion()),
    );
    await page.getByRole('link', { name: /GitHub 项目/ }).click();
    await page.getByRole('link', { name: /作者官网/ }).click();
    await expect
      .poll(() => desktop.evaluate(() => global.texiteExternalLinks))
      .toEqual(['https://github.com/Mclarenlife/Texite', 'https://mclarenlife.github.io/']);
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.getByRole('button', { name: '修改历史', exact: true }).click();
    await fs.writeFile(path.join(folder, 'main.tex'), source + '% external edit');
    await page.getByRole('button', { name: '还原备份 Native baseline', exact: true }).click();
    await expect(page.locator('.project-backups [role="alert"]')).toContainText(/外部|修改/);
    expect(await fs.readFile(path.join(folder, 'main.tex'), 'utf8')).toContain('% external edit');
    expect(errors).toEqual([]);
    console.log(
      'PASS native PDF forward/inverse location, selection word count, persistent cover, confirmed folder deletion, full-project restore and external-edit protection',
      base,
    );
  } finally {
    await desktop?.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await desktop?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
