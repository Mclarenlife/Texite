// Real Electron IPC and deterministic loopback API; no paid model or user data.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
(async () => {
  await fs.mkdir('.qa', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.qa/api-agent-desktop-'));
  let desktop,
    requests = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests++;
    const result =
      data.messages.at(-1).role === 'tool' ? JSON.parse(data.messages.at(-1).content) : null;
    let tool, args;
    if (!result) {
      tool = 'texite_read_lines';
      args = { path: 'main.tex', startLine: 1, endLine: 3 };
    } else if (result.value?.lines) {
      tool = 'texite_patch';
      args = {
        path: 'main.tex',
        revision: result.value.revision,
        oldText: '苹果',
        newText: 'apple',
      };
    }
    const message = tool
      ? {
          tool_calls: [
            {
              id: 'c-' + requests,
              type: 'function',
              function: { name: tool, arguments: JSON.stringify(args) },
            },
          ],
        }
      : {
          content: result.success
            ? '已将选区改为 **apple**。'
            : '修改被拒绝：' + JSON.stringify(result.value),
        };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message, finish_reason: tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }),
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: directory },
    });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.evaluate(async (baseURL) => {
      await window.texite.chat.save({
        baseURL,
        model: 'fixture',
        apiKey: 'fixture-secret',
        name: 'API Agent 测试',
      });
      localStorage.setItem('texite-agent-provider', JSON.stringify('api'));
    }, `http://127.0.0.1:${server.address().port}/v1`);
    await page.reload();
    const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await editor.fill('Before\n苹果\nAfter');
    const mac = process.platform === 'darwin';
    await editor.press(mac ? 'Meta+ArrowUp' : 'Control+Home');
    await editor.press('ArrowDown');
    await editor.press(mac ? 'Meta+ArrowLeft' : 'Home');
    await editor.press(mac ? 'Meta+Shift+ArrowRight' : 'Shift+End');
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-selection-range')).toContainText('第 2 行，第 1–2 字');
    await page.getByLabel('发送给 API 的消息').fill('改写成英文');
    await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
    await expect(editor.locator('.cm-line')).toHaveText(['Before', 'apple', 'After']);
    await expect(page.getByText('已完成', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Agent 用量')).toContainText('输入 300 · 输出 60');
    const projects = await page.evaluate(() => window.texite.listProjects());
    expect(projects[0].files.find((f) => f.path === 'main.tex').content).toBe(
      'Before\napple\nAfter',
    );
    const history = await page.evaluate((id) => window.texite.aiHistory.read(id), projects[0].id);
    expect(history.tasks[0].usage.inputTokens).toBe(300);
    expect(history.tasks[0].changes[0].before).toBe('Before\n苹果\nAfter');
    await page.screenshot({ path: '.qa/api-agent-desktop.png' });
    await page.reload();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.getByLabel('Agent 用量')).toContainText('输入 300 · 输出 60');
    await page.getByRole('button', { name: '1 个文件 · 查看差异' }).click();
    await page.getByRole('button', { name: '撤回整次修改' }).click();
    await expect(page.getByText('已撤回，修改记录仍保留')).toBeVisible();
    const restored = await page.evaluate(() => window.texite.listProjects());
    expect(restored[0].files.find((f) => f.path === 'main.tex').content).toBe(
      'Before\n苹果\nAfter',
    );
    expect(errors).toEqual([]);
    console.log(
      'PASS: API Agent Electron IPC, selection patch, native save, persisted usage and whole-task undo.',
    );
  } finally {
    if (desktop) await desktop.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
