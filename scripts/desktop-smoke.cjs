const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const base = path.resolve('.qa/desktop-' + Date.now());
  const project = path.join(base, 'project');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(
    path.join(project, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nDesktop smoke test\n\\end{document}\n',
  );
  const desktop = await electron.launch({
    args: ['.'],
    env: { ...process.env, TEXITE_TEST_USER_DATA: path.join(base, 'profile') },
  });
  try {
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('textbox', { name: 'LaTeX 源码编辑器' }).waitFor();
    await expect(page.locator('.pdf-scroll canvas')).toBeVisible();
    const bridge = await page.evaluate(() => typeof window.texite?.compile);
    expect(bridge).toBe('function');
    await desktop.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, project);
    await page.getByRole('button', { name: '我的工作区', exact: true }).click();
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    const source = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await expect(source).toContainText('Desktop smoke test');
    await source.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('% saved from Texite');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('项目文件已保存到');
    expect(await fs.readFile(path.join(project, 'main.tex'), 'utf8')).toContain(
      'saved from Texite',
    );
    await fs.writeFile(path.join(project, 'main.tex'), 'External edit');
    await source.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n% conflict');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('外部修改');
    expect(await fs.readFile(path.join(project, 'main.tex'), 'utf8')).toBe('External edit');
    await page.getByRole('button', { name: '编译文稿', exact: false }).click();
    await expect(page.locator('.diagnostics')).toBeVisible();
    await expect(page.locator('.diagnostics')).toContainText('未找到');
    await page.screenshot({ path: '.qa/desktop-smoke.png' });
    console.log(
      JSON.stringify({ bridge, errors, saveAndConflict: 'passed', missingEngine: 'passed' }),
    );
  } finally {
    await desktop.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
