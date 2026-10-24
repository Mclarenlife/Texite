const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const profile = path.resolve('.qa/ai-history-desktop-' + Date.now());
  let desktop;
  const launch = async () => {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.'],
      env: { ...process.env, TEXITE_TEST_USER_DATA: profile },
    });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(30000);
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    return page;
  };
  try {
    let page = await launch();
    const id = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('texite-workspace');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const project = (await window.texite.listProjects())[0];
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(
        [
          {
            id: 'old-task',
            conversationId: 'old-conversation',
            prompt: '保留这条对话',
            reply: '# 已保留\n\n**旧版记录**\n\n```latex\n\\alpha\n```',
            time: 1,
            status: 'completed',
            changes: [],
            activities: [],
            mode: 'agent',
          },
        ],
        'ai:' + project.id,
      );
      tx.objectStore('settings').put(
        {
          items: [{ id: 'old-conversation', mode: 'agent', title: '旧版对话', time: 1 }],
          selected: { agent: 'old-conversation' },
        },
        'ai-conversations:' + project.id,
      );
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return project.id;
    });
    await page.reload();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-reply h1')).toHaveText('已保留');
    await expect
      .poll(() =>
        page.evaluate(async (id) => (await window.texite.aiHistory.read(id))?.tasks.length, id),
      )
      .toBe(1);
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    expect(await desktop.evaluate(({ clipboard }) => clipboard.readText())).toContain('\\alpha');
    const destination = path.join(profile, 'selected-data');
    await fs.mkdir(destination, { recursive: true });
    await desktop.evaluate(({ dialog }, destination) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
    }, destination);
    const moved = await page.evaluate(() => window.texite.aiHistory.choose());
    expect(moved).toBe(path.join(destination, 'Texite-AI-data'));
    // Simulate browser cache replacement while leaving ordinary user files intact.
    await page.evaluate(async (id) => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open('texite-workspace');
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').delete('ai:' + id);
      tx.objectStore('settings').delete('ai-conversations:' + id);
      await new Promise((resolve) => {
        tx.oncomplete = resolve;
      });
      db.close();
    }, id);
    await desktop.evaluate(({ app }) => app.exit(0));
    page = await launch();
    await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
    await expect(page.locator('.ai-reply strong')).toHaveText('旧版记录');
    expect(await page.evaluate(() => window.texite.aiHistory.directory())).toBe(moved);
    expect(await page.evaluate(() => window.texite.updates.status())).toMatchObject({
      directory: path.join(profile, 'updates'),
    });
    console.log(
      'PASS: legacy AI history migrates, copied code is exact, directory changes preserve originals, and records survive restart without browser history.',
    );
  } finally {
    if (desktop) await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
