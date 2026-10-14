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
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await span.dispatchEvent('mouseup');
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
    await fs.writeFile(path.join(folder, 'main.tex'), source + '% external edit');
    await page.getByRole('button', { name: '还原备份 Native baseline', exact: true }).click();
    await expect(page.locator('.project-backups [role="alert"]')).toContainText(/外部|修改/);
    expect(await fs.readFile(path.join(folder, 'main.tex'), 'utf8')).toContain('% external edit');
    expect(errors).toEqual([]);
    console.log(
      'PASS native PDF forward/inverse location, full-project restore and external-edit protection',
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
