import { test, expect, type Page } from '@playwright/test';
import { createProject } from '../../packages/core/sample';

async function readLocal(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('texite-workspace');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['projects', 'settings', 'recoveries'], 'readonly');
    const get = <T>(req: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const [projects, points] = await Promise.all([
      get(tx.objectStore('projects').getAll()),
      get(tx.objectStore('recoveries').getAll()),
    ]);
    db.close();
    return { projects, points };
  });
}
async function seedHistory(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '添加文件', exact: true }).click();
  await page.getByLabel('文件路径').fill('recover.tex');
  await page.getByRole('button', { name: '创建文件', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('first version\nkeep');
  await page.waitForTimeout(1600);
  await editor.fill('middle version\nkeep');
  await page.waitForTimeout(1600);
  await editor.fill('latest work\nkeep\nunsubmitted thought');
  await expect(page.getByText('本地恢复副本已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.history-list > button')).toHaveCount(3);
  await page.locator('.history-list > button').nth(1).click();
  await page.getByRole('button', { name: '恢复到修改前', exact: true }).click();
  return page.getByRole('dialog', { name: '预览恢复差异' });
}
test('restore previews current-to-target differences, cancellation is inert and a durable safety copy can undo restoration', async ({
  page,
}) => {
  const dialog = await seedHistory(page);
  await expect(dialog.locator('.diff-removed')).toContainText([
    'latest work',
    'unsubmitted thought',
  ]);
  await expect(dialog.locator('.diff-added')).toContainText('first version');
  expect((await readLocal(page)).points).toHaveLength(0);
  await page.screenshot({ animations: 'disabled', path: '.qa/restore-preview.png' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    (await readLocal(page)).projects[0].files.find(
      (f: { path: string }) => f.path === 'recover.tex',
    ).content,
  ).toContain('latest work');
  await page.getByRole('button', { name: '恢复到修改前', exact: true }).click();
  await page.getByRole('button', { name: '保留当前版本并恢复', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'first version',
  );
  await expect(page.getByRole('status')).toContainText('恢复前的版本已单独保存');
  const saved = await readLocal(page);
  expect(saved.points).toHaveLength(1);
  expect(saved.points[0].before).toBe('latest work\nkeep\nunsubmitted thought');
  expect(
    saved.projects[0].files.find((f: { path: string }) => f.path === 'main.tex').content,
  ).toContain('Introduction');
  // Pruning ordinary history must never prune the protected recovery point.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('texite-workspace');
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction(['projects', 'settings'], 'readwrite');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => {
      for (const project of req.result) tx.objectStore('settings').put([], 'history:' + project.id);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.history-list > button')).toHaveCount(1);
  await expect(page.locator('.history-list > button')).toContainText('恢复前备份');
  await page.locator('.history-list > button').click();
  await page.getByRole('button', { name: '恢复到备份版本', exact: true }).click();
  await expect(dialog.locator('.diff-added')).toContainText(['latest work', 'unsubmitted thought']);
  await page.getByRole('button', { name: '保留当前版本并恢复', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'unsubmitted thought',
  );
  await expect.poll(async () => (await readLocal(page)).points.length).toBe(2);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'latest work',
  );
});
for (const stage of ['backup', 'project'] as const)
  test(`failed ${stage} write aborts restoration atomically without losing current content`, async ({
    page,
  }) => {
    const dialog = await seedHistory(page);
    await page.evaluate((stage) => {
      const method = stage === 'backup' ? 'add' : 'put';
      const original = IDBObjectStore.prototype[method];
      (window as unknown as { restoreWrite: () => void }).restoreWrite = () => {
        IDBObjectStore.prototype[method] = original;
      };
      IDBObjectStore.prototype[method] = function (...args: Parameters<typeof original>) {
        if (this.name === (stage === 'backup' ? 'recoveries' : 'projects'))
          throw new DOMException('模拟存储空间不足', 'QuotaExceededError');
        return original.apply(this, args);
      };
    }, stage);
    await page.getByRole('button', { name: '保留当前版本并恢复', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('未执行恢复');
    await page.evaluate(() => (window as unknown as { restoreWrite: () => void }).restoreWrite());
    const saved = await readLocal(page);
    expect(saved.points).toHaveLength(0);
    expect(
      saved.projects[0].files.find((f: { path: string }) => f.path === 'recover.tex').content,
    ).toContain('latest work');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '返回编辑', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
      'unsubmitted thought',
    );
  });
test('database upgrade retains existing projects and history', async ({ page }) => {
  const project = createProject();
  project.name = 'Existing v0.3 project';
  await page.route('**/legacy-seed', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body>seed</body></html>' }),
  );
  await page.goto('/legacy-seed');
  await page.evaluate(async (project) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('texite-workspace', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' });
        req.result.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(['projects', 'settings'], 'readwrite');
    tx.objectStore('projects').put(project);
    tx.objectStore('settings').put(project.id, 'lastProject');
    tx.objectStore('settings').put(
      [
        {
          id: 'legacy',
          path: 'main.tex',
          before: 'old',
          after: project.files[0].content,
          time: 1,
          startedAt: 1,
        },
      ],
      'history:' + project.id,
    );
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, project);
  await page.goto('/');
  await expect(page.locator('.project-tab.active > button:first-child')).toContainText(
    'Existing v0.3 project',
  );
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.history-list > button')).toHaveCount(1);
  await page.locator('.history-list > button').click();
  await page.getByRole('button', { name: '恢复到修改前', exact: true }).click();
  await page.getByRole('button', { name: '保留当前版本并恢复', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toHaveText('old');
  expect((await readLocal(page)).points).toHaveLength(1);
});
test('independent body and syntax colors update preview and editor, reject invalid HEX and persist', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await page.getByRole('radio', { name: '浅色', exact: true }).click();
  await page.getByRole('radio', { name: '晴空', exact: true }).click();
  await page.getByRole('tab', { name: '编辑器文字', exact: true }).click();
  await page.getByRole('button', { name: '调整正文颜色', exact: true }).click();
  await page.getByLabel('正文颜色 HEX', { exact: true }).fill('#17478e');
  await page.getByLabel('正文颜色 HEX', { exact: true }).press('Enter');
  await expect(page.locator('[data-token="text"]')).toHaveCSS('color', 'rgb(23, 71, 142)');
  await page.getByRole('button', { name: '调整命令与关键字颜色', exact: true }).click();
  await page.getByRole('button', { name: '使用颜色 #7150BD', exact: true }).click();
  await expect(page.locator('[data-token="keyword"]')).toHaveCSS('color', 'rgb(113, 80, 189)');
  await page.getByLabel('命令与关键字颜色 HEX', { exact: true }).fill('#nope');
  await page.getByLabel('命令与关键字颜色 HEX', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('十六进制');
  await expect(page.locator('[data-token="keyword"]')).toHaveCSS('color', 'rgb(113, 80, 189)');
  await page.getByLabel('命令与关键字颜色 HEX', { exact: true }).press('Escape');
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByLabel('命令与关键字颜色编辑')).not.toBeVisible();
  await page.getByRole('button', { name: '调整参数与字符串颜色', exact: true }).click();
  await page.getByRole('button', { name: '使用颜色 #257253', exact: true }).click();
  await page.getByRole('button', { name: '调整注释颜色', exact: true }).click();
  const square = page.getByRole('slider', { name: '饱和度与明度', exact: true });
  await square.focus();
  await square.press('ArrowRight');
  await square.press('ArrowDown');
  const hex = await page.getByLabel('注释颜色 HEX', { exact: true }).inputValue();
  expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  await page.screenshot({ animations: 'disabled', path: '.qa/color-studio-light.png' });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await expect(page.locator('.cm-editor')).toHaveCSS('color', 'rgb(23, 71, 142)');
  await expect(
    page.locator('.cm-line').filter({ hasText: '\\documentclass' }).locator('span').first(),
  ).toHaveCSS('color', 'rgb(113, 80, 189)');
  await expect(
    page
      .locator('.cm-line')
      .filter({ hasText: '\\documentclass' })
      .locator('span')
      .filter({ hasText: 'article' })
      .first(),
  ).toHaveCSS('color', 'rgb(37, 114, 83)');
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '编辑器文字', exact: true }).click();
  await expect(page.locator('[data-token="text"]')).toHaveCSS('color', 'rgb(23, 71, 142)');
  await expect(page.locator('[data-token="keyword"]')).toHaveCSS('color', 'rgb(113, 80, 189)');
  await page.getByRole('button', { name: '调整注释颜色', exact: true }).click();
  await expect(page.getByLabel('注释颜色 HEX', { exact: true })).toHaveValue(hex);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = await page.getByRole('dialog', { name: '设置', exact: true }).boundingBox();
  expect(dialog!.x + dialog!.width).toBeLessThanOrEqual(390);
});

test('a newer local snapshot invalidates restoration and is not overwritten by autosave', async ({
  page,
}) => {
  const dialog = await seedHistory(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('texite-workspace');
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const req = store.getAll();
    req.onsuccess = () => {
      const p = req.result[0];
      store.put({
        ...p,
        revision: p.revision + 1,
        updatedAt: Date.now(),
        files: p.files.map((f: { path: string; content: string }) =>
          f.path === 'recover.tex' ? { ...f, content: 'other window update' } : f,
        ),
      });
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.getByRole('button', { name: '保留当前版本并恢复', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('其他窗口更新');
  await page.waitForTimeout(600);
  const saved = await readLocal(page);
  expect(saved.points).toHaveLength(0);
  expect(
    saved.projects[0].files.find((f: { path: string }) => f.path === 'recover.tex').content,
  ).toBe('other window update');
});

test('an old open tab cannot leave the database upgrade silently hanging', async ({
  page,
  context,
}) => {
  await page.route('**/legacy-hold', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body>legacy tab</body></html>' }),
  );
  await page.goto('/legacy-hold');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('texite-workspace', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' });
        req.result.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
    });
    (window as unknown as { legacyDb: IDBDatabase }).legacyDb = db;
  });
  const upgraded = await context.newPage();
  await upgraded.goto('/');
  await expect(
    upgraded.getByText('请关闭其他 Texite 标签页后重试，以完成本地存储升级。', { exact: true }),
  ).toBeVisible();
  await page.close();
  await upgraded.getByRole('button', { name: '重试打开工作区', exact: true }).click();
  await expect(upgraded.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toBeVisible();
});
