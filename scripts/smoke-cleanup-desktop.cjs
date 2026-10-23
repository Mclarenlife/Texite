const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const base = path.resolve('.qa/cleanup-desktop-' + Date.now()),
    profile = path.join(base, 'profile');
  let desktop;
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: profile },
    });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30000);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false),
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    const project = (await page.evaluate(() => window.texite.listProjects()))[0];
    const sourcePath = path.join(project.location.directory, 'main.tex'),
      source = await fs.readFile(sourcePath, 'utf8');
    await page.evaluate(async (id) => {
      const db = await new Promise((r) => {
        const q = indexedDB.open('texite-workspace');
        q.onsuccess = () => r(q.result);
      });
      const t = db.transaction('settings', 'readwrite');
      t.objectStore('settings').put(
        [
          {
            id: 'seed-agent',
            time: Date.now(),
            status: 'completed',
            mode: 'agent',
            prompt: 'Native agent record',
            reply: 'Recorded',
            activities: [],
            changes: [{ path: 'main.tex', before: 'old', after: 'new' }],
          },
        ],
        'ai:' + id,
      );
      await new Promise((r) => (t.oncomplete = r));
      db.close();
    }, project.id);
    await page.reload();
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.getByText('Native agent record', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清空当前项目 Agent 记录', exact: true }).click();
    await page
      .getByRole('dialog', { name: '清空 Agent 记录？' })
      .getByRole('button', { name: '确认清空', exact: true })
      .click();
    await expect(page.getByText('Native agent record', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '关闭 AI 面板', exact: true }).click();
    await page.getByRole('button', { name: '修改历史', exact: true }).click();
    await page.getByRole('button', { name: '备份当前项目', exact: true }).click();
    await page.getByLabel('备份备注').fill('Cleanup baseline');
    await page.getByRole('button', { name: '保存备份', exact: true }).click();
    await expect(page.locator('.backup-row')).toHaveCount(1);
    await fs.mkdir(path.join(profile, 'sync-backups'), { recursive: true });
    const backup = path.join(profile, 'sync-backups', '11111111-1111-4111-8111-111111111111.json');
    await fs.writeFile(backup, '{}');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '关于', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(dialog).toHaveCSS('transform', 'none');
    if (process.platform === 'win32')
      await expect(page.locator('.project-tabs')).toHaveCSS('-webkit-app-region', 'drag');
    await page.getByRole('tab', { name: '同步与存储', exact: true }).click();
    const davBox = await page.locator('.sync-connection-card').boundingBox();
    const cleanupBox = await page.locator('.storage-cleanup').boundingBox();
    expect(Math.abs(davBox.width - cleanupBox.width)).toBeLessThan(1);
    expect(Math.abs(davBox.x - cleanupBox.x)).toBeLessThan(1);
    const cleanup = page.locator('.storage-cleanup');
    for (const name of ['清空备份', '清空修改历史', '清空 AI 对话记录']) {
      await cleanup.getByRole('button', { name, exact: true }).click();
      await page
        .getByRole('dialog', { name: name + '？' })
        .getByRole('button', { name: '确认清空', exact: true })
        .click();
      await expect(cleanup.getByRole('status')).toHaveText('清理完成。');
    }
    await expect(fs.access(backup)).rejects.toThrow();
    expect(await fs.readFile(sourcePath, 'utf8')).toBe(source);
    await dialog.getByRole('button', { name: '关闭弹窗' }).click();
    await expect(page.locator('.backup-row')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: '修改历史', exact: true }).click();
    await expect(page.locator('.backup-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-task')).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log(
      'PASS: native confirmed AI context cleanup, global records cleanup, sync backup deletion, source preservation, reload, About layout and titlebar drag regions',
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
