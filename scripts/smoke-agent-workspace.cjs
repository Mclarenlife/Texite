const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
(async () => {
  const profile = path.resolve('.qa/agent-workspace-' + Date.now());
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
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.evaluate(
      async ({ command, fixture }) => {
        await window.texite.ai.configure({
          preset: 'custom',
          protocol: 'acp',
          command,
          args: [fixture],
        });
      },
      { command: process.execPath, fixture: path.resolve('tests/fixtures/acp-agent.cjs') },
    );
    const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await editor.fill('Before\n苹果\nAfter');
    const mac = process.platform === 'darwin';
    await editor.press(mac ? 'Meta+ArrowUp' : 'Control+Home');
    await editor.press('ArrowDown');
    await editor.press(mac ? 'Meta+ArrowLeft' : 'Home');
    await editor.press(mac ? 'Meta+Shift+ArrowRight' : 'Shift+End');
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-selection-range')).toContainText('第 2 行，第 1–2 字');
    await page.getByRole('button', { name: '连接 Agent CLI', exact: true }).click();
    await expect(page.getByText('已连接')).toBeVisible();
    await page.getByRole('button', { name: '断开 CLI 连接' }).click();
    await expect(page.getByText('已连接')).toHaveCount(0);
    await page.evaluate(async () => {
      await window.texite.ai.setIdleSettings({ idleMinutes: 1 });
      if ((await window.texite.ai.getIdleSettings()).idleMinutes !== 1)
        throw new Error('Idle preference was not saved');
    });
    await page.getByLabel('发送给 Agent CLI 的指令').fill('改写成英文');
    await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
    await expect(editor.locator('.cm-line')).toHaveText(['Before', 'apple', 'After']);
    await expect(page.getByText('已完成', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '1 个文件 · 查看差异' })).toBeVisible();
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await expect(page.locator('.ai-task')).toHaveCount(0);
    await page.getByRole('button', { name: '对话记录', exact: true }).click();
    await page.getByRole('button', { name: '打开对话 改写成英文', exact: true }).click();
    await expect(page.locator('.ai-task')).toHaveCount(1);
    await page.evaluate(async () => {
      const a = await window.texite.chat.save({
        id: '',
        name: 'A',
        baseURL: 'https://a.test/v1',
        model: 'a',
        apiKey: 'test-A',
      });
      const b = await window.texite.chat.save({
        id: '',
        name: 'B',
        baseURL: 'https://b.test/v1',
        model: 'b',
        apiKey: 'test-B',
      });
      if (a.id === b.id || (await window.texite.chat.list()).length !== 2)
        throw new Error('API profiles not isolated');
      if (JSON.stringify(await window.texite.chat.list()).includes('test-A'))
        throw new Error('Secret exposed');
      await window.texite.chat.select(a.id);
      if ((await window.texite.chat.get()).model !== 'a') throw new Error('Wrong selected API');
    });
    await page.reload();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-task')).toHaveCount(1);
    expect(await page.evaluate(async () => (await window.texite.chat.get()).name)).toBe('A');
    expect(
      await page.evaluate(async () => (await window.texite.ai.getIdleSettings()).idleMinutes),
    ).toBe(1);
    await page.getByRole('button', { name: '1 个文件 · 查看差异' }).click();
    await page.getByRole('button', { name: '撤回整次修改', exact: true }).click();
    await expect(page.locator('.cm-content .cm-line')).toHaveText(['Before', '苹果', 'After']);
    await page
      .getByRole('dialog', { name: 'AI 修改差异' })
      .getByRole('button', { name: '关闭弹窗' })
      .click();
    await page.getByRole('button', { name: '对话记录', exact: true }).click();
    await page
      .getByRole('button', { name: '打开对话 改写成英文', exact: true })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
    await page.getByRole('textbox', { name: '对话名称' }).fill('Native renamed conversation');
    await page.getByRole('button', { name: '保存名称', exact: true }).click();
    const renamed = page.getByRole('button', {
      name: '打开对话 Native renamed conversation',
      exact: true,
    });
    await expect(renamed).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await page.getByRole('button', { name: '对话记录', exact: true }).click();
    await renamed.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除对话', exact: true }).click();
    await page
      .getByRole('dialog', { name: '删除这条对话？' })
      .getByRole('button', { name: '确认删除' })
      .click();
    await expect(renamed).toHaveCount(0);
    await expect(page.locator('.ai-task')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '打开对话 新对话', exact: true })).toBeVisible();
    await expect(page.locator('.cm-content .cm-line')).toHaveText(['Before', '苹果', 'After']);
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await Promise.all([
      page.waitForEvent('close'),
      page.evaluate(() => window.texite.windowControl('close')).catch(() => {}),
    ]);
    console.log(
      'PASS: native ACP edit/undo, disconnect/reconnect, conversation rename/delete persistence and isolated API profiles',
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
