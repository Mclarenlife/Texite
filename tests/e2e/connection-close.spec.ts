import { test, expect } from '@playwright/test';
test('close inspection catches uploaded-project edits and project space confirms unlink without deleting files', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state: any = { linked: false, hash: '', disk: null, detached: 0 };
    (window as any).closeTest = state;
    const config = () => ({
      url: 'https://dav.test/',
      username: 'test',
      hasPassword: true,
      persistent: true,
      projects: state.linked ? [{ id: state.disk.id, hash: state.hash, time: 1 }] : [],
    });
    window.texite = {
      onCloseRequest: (fn: any) => {
        state.inspect = fn;
        return () => {};
      },
      listProjects: async () => [],
      reopenProject: async () => state.disk,
      openProject: async () => null,
      importProject: async (p: any) => p,
      saveProject: async (p: any) => {
        state.disk = structuredClone(p);
        return {};
      },
      detectEngines: async () => ({ bundled: false, latexmk: false, engines: { pdflatex: false } }),
      onCompileLog: () => () => {},
      webdav: {
        get: async () => config(),
        detach: async () => {
          state.linked = false;
          state.detached++;
          return config();
        },
        batch: async () => {
          const modulePath = '/packages/core/syncState.ts';
          const { syncFingerprint } = await import(modulePath);
          state.linked = true;
          state.hash = await syncFingerprint(state.disk);
          return { config: config(), projects: [state.disk], results: [] };
        },
      },
    } as any;
  });
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '项目首页' }).click();
  await page.getByRole('button', { name: '同步', exact: true }).click();
  await expect(page.getByLabel('WebDAV 项目')).toBeVisible();
  expect(
    await page.evaluate(async () => (await (window as any).closeTest.inspect()).unsynced),
  ).toBe(0);
  await page.getByRole('button', { name: '打开项目 示例项目', exact: true }).click();
  await page.getByRole('textbox', { name: 'LaTeX 源码编辑器' }).fill('未上传的内容');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  const check = await page.evaluate(async () => (window as any).closeTest.inspect());
  expect(check).toMatchObject({ unsaved: false, unsynced: 1, syncing: false });
  await page.getByRole('button', { name: '项目首页' }).click();
  await page.getByRole('checkbox', { name: '选择项目 示例项目' }).check();
  await expect(page.getByRole('button', { name: '上传项目', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '停止关联', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText('本地项目和云端文件都会保留');
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => (window as any).closeTest.detached)).toBe(0);
  await page.getByRole('button', { name: '停止关联', exact: true }).click();
  await modal.getByRole('button', { name: '停止关联', exact: true }).click();
  await expect(page.getByLabel('WebDAV 项目')).toHaveCount(0);
  await page.getByRole('checkbox', { name: '选择项目 示例项目' }).check();
  await expect(page.getByRole('button', { name: '上传项目', exact: true })).toBeVisible();
  expect(
    await page.evaluate(async () => (await (window as any).closeTest.inspect()).unsynced),
  ).toBe(0);
  expect(
    await page.evaluate(
      () => (window as any).closeTest.disk.files.find((f: any) => f.path === 'main.tex').content,
    ),
  ).toBe('未上传的内容');
});
