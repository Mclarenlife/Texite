// Desktop bridge smoke: connects the local Codex account, without running model inference.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  await fs.mkdir('.qa', { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('.qa/ai-desktop-'));
  let desktop;
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: directory },
    });
    const page = await desktop.firstWindow();
    expect(await desktop.evaluate(({ app }) => app.getVersion())).toBe(
      require('../package.json').version,
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await page.getByRole('button', { name: '连接 Agent CLI', exact: true }).click();
    await expect(page.getByText('Agent CLI · 已连接')).toBeVisible({ timeout: 60000 });
    await page.getByRole('combobox', { name: 'AI 模型' }).click();
    const models = await page.getByRole('option').count();
    await page.keyboard.press('Escape');
    expect(models).toBeGreaterThan(0);
    // Hide account details before saving a screenshot of the actual Electron view.
    await page
      .getByLabel('发送给 Agent CLI 的指令')
      .fill('请检查当前文稿的公式与引用，并修复编译错误。');
    await page.screenshot({ path: path.join(directory, 'desktop-ai.png') });
    expect(errors).toEqual([]);
    console.log(
      'PASS: real Electron IPC, local Codex authentication, model list and AI panel.',
      models,
      'models',
    );
  } finally {
    if (desktop) await desktop.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
