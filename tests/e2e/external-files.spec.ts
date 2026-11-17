import { test, expect } from '@playwright/test';

test('linked browser folders refresh from disk and can save back into the original file', async ({
  page,
}) => {
  await page.goto('/');
  const writeDisk = async (text: string) =>
    page.evaluate(async (content) => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle('External paper', { create: true });
      const file = await directory.getFileHandle('main.tex', { create: true });
      const stream = await file.createWritable();
      await stream.write(content);
      await stream.close();
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: async () => directory,
        configurable: true,
      });
    }, text);
  await writeDisk('baseline');
  await page.getByRole('button', { name: '项目首页' }).click();
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await expect(editor).toContainText('baseline');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await writeDisk('changed by another app');
  await expect(editor).toContainText('changed by another app', { timeout: 12000 });
  await editor.fill('continued here');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const dir = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('External paper');
        return (await (await dir.getFileHandle('main.tex')).getFile()).text();
      }),
    )
    .toBe('continued here');
});
