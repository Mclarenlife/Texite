import { test, expect } from '@playwright/test';
test('completion snippets and right-click tools insert real, undoable LaTeX', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-tools')).toHaveCSS('position', 'static');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('');
  await editor.press('Escape');
  await page.keyboard.type('\\fra');
  await expect(page.getByRole('option').filter({ hasText: '\\frac' })).toBeVisible();
  await page.screenshot({ path: '.qa/modern-completion.png', animations: 'disabled' });
  await page.getByRole('option').filter({ hasText: '\\frac' }).click();
  await expect(editor).toContainText('\\frac{numerator}{denominator}');
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await expect(editor).toHaveText('\\frac{a}{b}');
  await editor.fill('\\begin{ali');
  await editor.press('Control+Space');
  await page
    .getByRole('option')
    .filter({ hasText: /^align对齐/ })
    .click();
  await expect(editor).toContainText('\\begin{align}');
  await expect(editor).toContainText('\\end{align}');
  await editor.fill('\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}');
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await editor.press('ArrowDown');
  await editor.press('Home');
  const line = page.locator('.cm-line').filter({ hasText: /^Body$/ });
  await line.click({ button: 'right' });
  await page.getByRole('button', { name: '插入表格', exact: true }).click();
  await page.getByLabel('表格行数').fill('2');
  await page.getByLabel('表格列数').fill('2');
  await page.getByRole('button', { name: '插入表格代码' }).click();
  await expect(editor).toContainText('\\begin{tabular}{ll}');
  await editor.press('Control+z');
  await expect(editor).not.toContainText('tabular');
  await line.click({ button: 'right' });
  await page.getByRole('button', { name: '插入公式', exact: true }).click();
  await page.getByLabel('公式内容').fill('x^2 + y^2 = 1');
  await page.getByRole('button', { name: '插入公式代码' }).click();
  await expect(editor).toContainText('x^2 + y^2 = 1');
  await editor.press('Control+z');
  await line.click({ button: 'right' });
  await page.getByRole('button', { name: '插入图片', exact: true }).click();
  await page.getByLabel('导入图片文件').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('combobox', { name: '项目图片' })).toContainText('assets/dot.png');
  await page.screenshot({ path: '.qa/insert-tools.png', animations: 'disabled' });
  await page.getByRole('button', { name: '插入图片代码' }).click();
  await expect(editor).toContainText('\\usepackage{graphicx}');
  await expect(editor).toContainText('\\includegraphics[width=0.8\\linewidth]{assets/dot.png}');
});
test('custom API chat streams without editing documents or storing the API key', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let received: any;
  await page.route('https://chat.example.test/v1/chat/completions', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      });
      return;
    }
    received = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: 'data: {"choices":[{"delta":{"content":"API conversation works."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  const before = await editor.innerText();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByRole('combobox', { name: '对话服务' }).click();
    await page.getByRole('option', { name: '自定义 API', exact: true }).click();
  await page.getByRole('button', { name: '配置对话 API', exact: false }).click();
  await page.getByLabel('API 地址', { exact: true }).fill('https://chat.example.test/v1');
  await page.getByLabel('API 模型名称').fill('local-test');
  await page.getByLabel('API Key', { exact: true }).fill('test-private-key');
  await page.getByRole('button', { name: '保存配置' }).click();
  await page.getByLabel('发送给 API 的消息').fill('Explain this paper');
  await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
  await expect(page.locator('.ai-reply')).toHaveText('API conversation works.');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(received.tools).toBeUndefined();
  expect(received.messages.at(-1).content).toContain('Explain this paper');
  expect(await editor.innerText()).toBe(before);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-private-key');
  await page.screenshot({ path: '.qa/ai-api-chat.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
