import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open('texite-workspace');
      q.onsuccess = () => r(q.result);
    });
    const tx = db.transaction(['projects', 'settings', 'recoveries'], 'readwrite');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => {
      const p = req.result[0],
        other = { ...p, id: 'other-cleanup-project', name: 'Other project' };
      tx.objectStore('projects').put(other);
      for (const project of [p, other]) {
        const s = tx.objectStore('settings');
        const task = {
          time: Date.now(),
          status: 'completed',
          activities: [],
          reply: 'Answer',
          model: 'test',
        };
        s.put(
          [
            {
              ...task,
              id: 'agent',
              mode: 'agent',
              prompt: 'Agent task',
              changes: [
                {
                  path: 'main.tex',
                  before: 'Old line',
                  after: 'LONG_LINE_' + 'abcdef'.repeat(140),
                },
              ],
            },
            {
              ...task,
              id: 'chat',
              mode: 'chat',
              provider: 'codex',
              prompt: 'Codex chat',
              changes: [],
            },
            { ...task, id: 'api', mode: 'chat', provider: 'api', prompt: 'API chat', changes: [] },
          ],
          'ai:' + project.id,
        );
        s.put(
          [{ id: 'history', path: 'main.tex', before: 'before', after: 'after', time: Date.now() }],
          'history:' + project.id,
        );
        s.put(
          { id: 'backup', projectId: project.id, time: Date.now(), note: 'Seed backup', project },
          'backup:' + project.id + ':backup',
        );
        tx.objectStore('recoveries').put({
          id: 'recovery-' + project.id,
          projectId: project.id,
          time: Date.now(),
          path: 'main.tex',
          before: 'before',
          after: 'after',
          kind: 'recovery',
        });
      }
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('.save-indicator')).toContainText('已保存');
}
async function read(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open('texite-workspace');
      q.onsuccess = () => r(q.result);
    });
    const get = <T>(q: IDBRequest<T>) => new Promise<T>((r) => (q.onsuccess = () => r(q.result)));
    const t = db.transaction(['settings', 'projects', 'recoveries']);
    const keys = await get(t.objectStore('settings').getAllKeys());
    const values = await get(t.objectStore('settings').getAll());
    const projects = await get(t.objectStore('projects').getAll());
    const recoveries = await get(t.objectStore('recoveries').getAll());
    db.close();
    return {
      settings: Object.fromEntries(keys.map((k, i) => [String(k), values[i]])),
      projects,
      recoveries,
    };
  });
}

test('AI diff resizes and scrolls horizontally; clearing modes confirms, isolates projects and persists', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '1 个文件 · 查看差异', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'AI 修改差异', exact: true });
  const original = (await d.boundingBox())!;
  expect(original.width).toBeGreaterThan(800);
  const handle = await d.getByRole('separator', { name: '调整差异窗口大小' }).boundingBox();
  await page.mouse.move(handle!.x + 10, handle!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 100, handle!.y + 80, { steps: 5 });
  await page.mouse.up();
  expect((await d.boundingBox())!.width).toBeGreaterThan(original.width + 60);
  const scroll = d.locator('.ai-diff-files');
  expect(await scroll.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await scroll.evaluate((e) => (e.scrollLeft = 300));
  expect(await scroll.evaluate((e) => e.scrollLeft)).toBeGreaterThan(200);
  await page.screenshot({ path: '.qa/release-0.9.0-diff.png', animations: 'disabled' });
  await d.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByRole('button', { name: '清空当前项目 Agent 记录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '清空 Agent 记录？' })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(page.getByText('Agent task', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空当前项目 Agent 记录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '清空 Agent 记录？' })
    .getByRole('button', { name: '确认清空', exact: true })
    .click();
  await expect(page.getByText('Agent task', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.getByText('Codex chat', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空当前项目对话记录', exact: true }).click();
  await page
    .getByRole('dialog', { name: '清空对话记录？' })
    .getByRole('button', { name: '确认清空', exact: true })
    .click();
  await expect(page.getByText('Codex chat', { exact: true })).toHaveCount(0);
  const data = await read(page);
  expect(data.settings['ai:other-cleanup-project']).toHaveLength(3);
  const current = data.projects.find((p) => p.id !== 'other-cleanup-project');
  expect(data.settings['ai:' + current.id]).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.locator('.ai-task')).toHaveCount(0);
});

test('storage cleanup confirms each category, removes all projects records and keeps source files', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.backup-row')).toHaveCount(1);
  await expect(page.locator('.history-list > button')).toHaveCount(2);
  const before = (await read(page)).projects;
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '同步与存储', exact: true }).click();
  const cleanup = page.locator('.storage-cleanup');
  await cleanup.getByRole('button', { name: '清空备份', exact: true }).click();
  await page
    .getByRole('dialog', { name: '清空备份？' })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(
    Object.keys((await read(page)).settings).filter((k) => k.startsWith('backup:')),
  ).toHaveLength(2);
  for (const name of ['清空备份', '清空修改历史', '清空 AI 对话记录']) {
    await cleanup.getByRole('button', { name, exact: true }).click();
    await page
      .getByRole('dialog', { name: name + '？' })
      .getByRole('button', { name: '确认清空', exact: true })
      .click();
    await expect(cleanup.getByRole('status')).toHaveText('清理完成。');
  }
  await page.screenshot({ path: '.qa/release-0.9.0-cleanup.png', animations: 'disabled' });
  await page
    .getByRole('dialog', { name: '设置', exact: true })
    .getByRole('button', { name: '关闭弹窗' })
    .click();
  await expect(page.locator('.backup-row')).toHaveCount(0);
  await expect(page.locator('.history-list > button')).toHaveCount(0);
  const after = await read(page);
  expect(Object.keys(after.settings).filter((k) => /^(backup|history|ai):/.test(k))).toEqual([]);
  expect(after.recoveries).toEqual([]);
  expect(after.projects.map((p) => p.files)).toEqual(before.map((p) => p.files));
  await page.reload();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.backup-row')).toHaveCount(0);
  await expect(page.locator('.history-list > button')).toHaveCount(0);
});

test('a failed cleanup transaction retains records and source files for all projects', async ({
  page,
}) => {
  await seed(page);
  const before = await read(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    let count = 0;
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === 'settings' && String(key).startsWith('backup:') && ++count === 2)
        throw new Error('Cleanup test storage failure');
      return original.call(this, key);
    };
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '同步与存储', exact: true }).click();
  await page
    .locator('.storage-cleanup')
    .getByRole('button', { name: '清空备份', exact: true })
    .click();
  const d = page.getByRole('dialog', { name: '清空备份？' });
  await d.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Cleanup test storage failure');
  const after = await read(page);
  for (const key of Object.keys(before.settings).filter((k) => k.startsWith('backup:')))
    expect(after.settings[key]).toEqual(before.settings[key]);
  expect(after.projects.map((p) => p.files)).toEqual(before.projects.map((p) => p.files));
});

test('About scroll has one bounded content region and untransformed crisp borders; titlebar whitespace is draggable', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.app-header')).toBeVisible();
  await page.evaluate(() => document.querySelector('.app-header')!.classList.add('windows-header'));
  await expect(page.locator('.project-tabs')).toHaveCSS('-webkit-app-region', 'drag');
  await expect(page.getByRole('tab', { name: '示例项目', exact: true })).toHaveCSS(
    '-webkit-app-region',
    'no-drag',
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '关于', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true }),
    options = dialog.locator('.settings-options');
  await expect(dialog).toHaveCSS('transform', 'none');
  for (const top of [0, 120, 100000]) {
    await options.evaluate((e, t) => (e.scrollTop = t), top);
    const result = await options.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        d = el.closest('[role=dialog]')!.getBoundingClientRect();
      const update = el.querySelector('.update-settings')!;
      const css = getComputedStyle(update);
      return {
        within: r.bottom <= d.bottom,
        top: css.borderTopWidth,
        bottom: css.borderBottomWidth,
      };
    });
    expect(result.within).toBe(true);
    expect(result.top).toBe(result.bottom);
  }
  await page.screenshot({ path: '.qa/release-0.9.0-about-bottom.png', animations: 'disabled' });
  await options.evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ path: '.qa/release-0.9.0-about.png', animations: 'disabled' });
});
