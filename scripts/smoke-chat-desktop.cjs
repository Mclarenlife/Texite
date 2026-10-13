// Real Electron IPC + local API fixture. No external service or account is used.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
(async () => {
  await fs.mkdir('.qa', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.qa/chat-desktop-'));
  let desktop, received, authorization;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    authorization = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(
      'data: {"choices":[{"delta":{"content":"桌面 API 流式对话成功。"}}]}\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: directory },
    });
    const page = await desktop.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await expect(editor).toBeVisible();
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    // CodeMirror renders only the visible lines. Compare persisted source data,
    // not viewport-dependent DOM text, when asserting read-only behavior.
    const readSource = () =>
      page.evaluate(async () => (await window.texite.listProjects())[0].files);
    const before = await readSource();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('combobox', { name: '对话服务' }).click();
    await page.getByRole('option', { name: '自定义 API', exact: true }).click();
    await page.getByRole('button', { name: '配置对话 API', exact: false }).click();
    await page
      .getByLabel('API 地址', { exact: true })
      .fill(`http://127.0.0.1:${server.address().port}/v1`);
    await page.getByLabel('API 模型名称').fill('desktop-fixture');
    await page.getByLabel('API Key', { exact: true }).fill('fixture-secret');
    await page.getByRole('button', { name: '保存配置' }).click();
    await expect(page.getByRole('dialog', { name: '配置对话 API' })).toBeHidden();
    await page.getByLabel('发送给 API 的消息').fill('解释公式');
    await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
    await expect(page.locator('.ai-reply')).toHaveText('桌面 API 流式对话成功。');
    await expect(page.getByText('已完成', { exact: true })).toBeVisible();
    expect(received.tools).toBeUndefined();
    expect(authorization).toBe('Bearer fixture-secret');
    expect(await readSource()).toEqual(before);
    const settings = await page.evaluate(() => window.texite.chat.get());
    expect(settings.hasKey).toBe(true);
    expect(settings.apiKey).toBeUndefined();
    const saved = await fs.readFile(path.join(directory, 'ai', 'chat.json'), 'utf8');
    expect(saved).not.toContain('fixture-secret');
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-secret');
    await page.screenshot({ path: '.qa/desktop-chat.png' });
    await page.reload();
    expect((await page.evaluate(() => window.texite.chat.get())).hasKey).toBe(true);
    expect(errors).toEqual([]);
    console.log(
      'PASS: Electron chat IPC, loopback SSE, encrypted key storage, reload and read-only conversation.',
    );
  } catch (e) {
    if (desktop) {
      const page = await desktop.firstWindow();
      await page.screenshot({ path: '.qa/desktop-chat-failure.png' });
      console.error('UI alerts:', await page.getByRole('alert').allTextContents());
    }
    throw e;
  } finally {
    if (desktop) {
      await desktop.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.removeAllListeners('will-prevent-unload');
          window.webContents.on('will-prevent-unload', (e) => e.preventDefault());
        }
      });
      await desktop.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
