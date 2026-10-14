const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const base = path.resolve('.qa/project-actions-native-' + Date.now());
  const folder = path.join(base, 'Dropped project');
  await fs.mkdir(path.join(folder, 'figures'), { recursive: true });
  await fs.writeFile(path.join(folder, 'main.tex'), 'Keep original');
  let desktop;
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: path.join(base, 'profile') },
    });
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ dialog, BrowserWindow }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    }, folder);
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.getByRole('button', { name: '项目首页', exact: true }).click();
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    await expect(page.locator('.file-tree button[title="figures"]')).toBeVisible();
    const data = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(['Dragged text'], 'note.tex'));
      d.items.add(new File([new Uint8Array([0, 255, 128, 33])], 'image.png'));
      return d;
    });
    await page
      .locator('.file-tree button[title="figures"]')
      .dispatchEvent('drop', { dataTransfer: data });
    await expect(page.getByRole('progressbar', { name: '文件导入进度' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(await fs.readFile(path.join(folder, 'figures/note.tex'), 'utf8')).toBe('Dragged text');
    expect(await fs.readFile(path.join(folder, 'figures/image.png'))).toEqual(
      Buffer.from([0, 255, 128, 33]),
    );
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await page.getByRole('button', { name: '项目首页', exact: true }).click();
    const card = page
      .locator('.project-card')
      .filter({ has: page.getByRole('button', { name: '打开项目 Dropped project', exact: true }) });
    const lefts = await card.evaluate((el) =>
      ['strong', '.project-location'].map((q) => el.querySelector(q).getBoundingClientRect().left),
    );
    expect(lefts[0]).toBe(lefts[1]);
    async function remove(physical) {
      await page.getByLabel('选择项目 Dropped project', { exact: true }).check();
      await page.getByRole('button', { name: '删除项目', exact: true }).click();
      await page.getByRole('button', { name: '移到最近删除', exact: true }).click();
      await page.getByRole('button', { name: /最近删除/ }).click();
      await page.getByLabel('选择项目 Dropped project', { exact: true }).check();
      await page.getByRole('button', { name: '永久删除', exact: true }).click();
      const d = page.getByRole('dialog', { name: '永久删除 1 个项目？' });
      await expect(d).toContainText(folder);
      await expect(d.getByRole('checkbox')).not.toBeChecked();
      if (physical) await d.getByRole('checkbox').check();
      await d.getByRole('button', { name: '确认永久删除', exact: true }).click();
      await expect(d).toBeHidden();
      await expect(page.locator('.project-card')).toHaveCount(0);
      expect(
        (await page.evaluate(() => window.texite.listProjects())).some(
          (p) => p.name === 'Dropped project',
        ),
      ).toBe(false);
    }
    await remove(false);
    expect(await fs.readFile(path.join(folder, 'main.tex'), 'utf8')).toBe('Keep original');
    await page.getByRole('button', { name: '项目', exact: true }).click();
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    await expect(page.locator('.file-tree button[title="figures/note.tex"]')).toBeVisible();
    await page.getByRole('button', { name: '项目首页', exact: true }).click();
    await remove(true);
    let exists = true;
    try {
      await fs.access(folder);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
    await page.reload();
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.getByRole('button', { name: '项目首页', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '打开项目 Dropped project', exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => window.texite.updates.status())).toEqual({
      info: null,
      busy: false,
      ready: false,
      progress: 0,
      error: '',
    });
    expect(errors).toEqual([]);
    console.log(
      'PASS: native drag imports persist text/binary bytes, card alignment, permanent delete retains/removes directories and survives reload, updater bridge',
    );
  } finally {
    if (desktop) {
      await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await desktop.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
