import { test, expect } from '@playwright/test';

test('API Agent searches, reads lines, patches live buffers and preserves usage and undo after reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('texite-agent-provider', JSON.stringify('api'));
    localStorage.setItem(
      'texite-chat-profiles',
      JSON.stringify([
        {
          id: 'test',
          name: '测试 API',
          baseURL: 'https://agent.example.test/v1',
          model: 'agent-test',
        },
      ]),
    );
    localStorage.setItem('texite-chat-active', 'test');
  });
  let requests = 0;
  await page.route('https://agent.example.test/**', async (route) => {
    const body = route.request().postDataJSON();
    const toolResult =
      body.messages.at(-1).role === 'tool' ? JSON.parse(body.messages.at(-1).content) : undefined;
    let tool: string | undefined,
      args = {};
    requests++;
    if (requests === 1) {
      tool = 'texite_search';
      args = { query: 'Research Notes', paths: [], caseSensitive: true };
    }
    if (requests === 2) {
      expect(toolResult.success).toBe(true);
      expect(toolResult.value.matches[0].path).toBe('main.tex');
      tool = 'texite_read_lines';
      args = { path: 'main.tex', startLine: 8, endLine: 9 };
    }
    if (requests === 3) {
      expect(toolResult.success).toBe(true);
      tool = 'texite_patch';
      args = {
        path: 'main.tex',
        revision: toolResult.value.revision,
        oldText: 'Research Notes',
        newText: 'API Edited Title',
      };
    }
    if (requests === 4) expect(toolResult.success).toBe(true);
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: tool ? 'tool_calls' : 'stop',
            message: tool
              ? {
                  tool_calls: [
                    {
                      id: 'tool-' + requests,
                      type: 'function',
                      function: { name: tool, arguments: JSON.stringify(args) },
                    },
                  ],
                }
              : { content: '**已修改标题。**' },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Agent 接入方式' })).toContainText('自定义 API');
  await page.getByLabel('发送给 API 的消息').fill('修改标题');
  await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'API Edited Title',
  );
  await expect(page.getByLabel('Agent 用量')).toContainText('输入 400 · 输出 80');
  await page.screenshot({ path: '.qa/api-agent-panel.png', animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.getByLabel('Agent 用量')).toContainText('输入 400 · 输出 80');
  await page.getByRole('button', { name: '1 个文件 · 查看差异' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 修改差异' });
  await dialog.getByRole('button', { name: '撤回整次修改' }).click();
  await expect(dialog.getByText('已撤回，修改记录仍保留')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'Research Notes',
  );
  expect(requests).toBe(4);
});

test('API request limit persists and reports partial usage without inventing tokens', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('texite-agent-provider', JSON.stringify('api'));
    localStorage.setItem(
      'texite-chat-profiles',
      JSON.stringify([
        { id: 'test', baseURL: 'https://agent.example.test/v1', model: 'agent-test' },
      ]),
    );
    localStorage.setItem('texite-chat-active', 'test');
  });
  let requests = 0;
  await page.route('https://agent.example.test/**', async (route) => {
    requests++;
    await route.fulfill({
      json: {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              tool_calls: [
                {
                  id: 'c',
                  type: 'function',
                  function: { name: 'texite_list_files', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('combobox', { name: 'API Agent 最大执行轮数' }).click();
  await page.getByRole('option', { name: '最多 1 轮', exact: true }).click();
  await page.getByLabel('发送给 API 的消息').fill('列出项目');
  await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
  await expect(page.getByText(/已达到 1 轮 API 请求上限/)).toBeVisible();
  await expect(page.getByLabel('Agent 用量')).toContainText('API 未提供 Token 用量');
  expect(requests).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'API Agent 最大执行轮数' })).toContainText(
    '最多 1 轮',
  );
});
