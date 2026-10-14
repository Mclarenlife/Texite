import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test('drag files into the root or a folder, show progress, persist bytes and reject collisions', async ({
  page,
}) => {
  await page.goto('/');
  const zip = new JSZip();
  zip.file('main.tex', 'Original source');
  zip.folder('figures');
  await page.locator('input[accept=".zip"]').setInputFiles({
    name: 'Drop test.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.locator('.file-tree button[title="figures"]')).toBeVisible();
  const drop = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['Dropped text'], 'note.tex', { type: 'text/plain' }));
    return data;
  });
  await page.locator('.file-tree').dispatchEvent('drop', { dataTransfer: drop });
  await expect(page.getByRole('progressbar', { name: '文件导入进度' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await page.screenshot({ path: '.qa/preview-0.9.6-import.png', animations: 'disabled' });
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'Dropped text',
  );
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: 'toolbar.tex',
    mimeType: 'text/plain',
    buffer: Buffer.from('Toolbar import persists'),
  });
  await expect(page.locator('.file-tree button[title="toolbar.tex"]')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('文件已加入项目');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'Toolbar import persists',
  );
  const binary = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([0, 255, 128, 33])], 'figure.png', { type: 'image/png' }),
    );
    return data;
  });
  const folder = page.locator('.file-tree button[title="figures"]');
  await folder.dispatchEvent('dragover', { dataTransfer: binary });
  await expect(folder).toHaveClass(/drop-target/);
  await folder.dispatchEvent('drop', { dataTransfer: binary });
  await expect(page.locator('.file-tree button[title="figures/figure.png"]')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await folder.dispatchEvent('drop', { dataTransfer: binary });
  await expect(page.getByRole('status')).toContainText('已存在');
  await page.reload();
  await expect(page.locator('.file-tree button[title="figures/figure.png"]')).toBeVisible();
  await page.locator('.file-tree button[title="note.tex"]').click();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'Dropped text',
  );
  await page.getByRole('button', { name: '项目首页', exact: true }).click();
});

test('permanent deletion defaults to keeping files, can cancel, and remains deleted after reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '项目首页', exact: true }).click();
  await page.getByLabel('选择项目 示例项目', { exact: true }).check();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('button', { name: '移到最近删除', exact: true }).click();
  await page.getByRole('button', { name: /最近删除/ }).click();
  await page.getByLabel('选择项目 示例项目', { exact: true }).check();
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除 1 个项目？' });
  await expect(dialog.getByRole('checkbox')).not.toBeChecked();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('选择项目 示例项目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '永久删除', exact: true }).click();
  await page.screenshot({ path: '.qa/preview-0.9.6-permanent.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: '确认永久删除', exact: true }).click();
  // The card disappears before the replacement workspace finishes saving.
  // Wait for the confirmed operation to finish before simulating a restart.
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('所选项目已永久删除');
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '项目首页', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开项目 示例项目', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /最近删除/ }).click();
  await expect(page.locator('.project-card')).toHaveCount(0);
});

test('About checks, downloads and reopens a verified update after switching settings tabs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.evaluate(() => {
    let info: any = null,
      ready = false;
    (window as any).updateOpened = 0;
    window.texite = {
      platform: 'win32',
      saveProject: async () => ({ kind: 'managed', directory: 'C:/test' }),
      updates: {
        status: async () => ({ info, ready, busy: false, progress: ready ? 100 : 0, error: '' }),
        check: async () =>
          (info = {
            current: '0.9.0-preview.6',
            version: 'v1.0.0',
            available: true,
            supported: true,
            size: 100,
            notes: '',
          }),
        download: async () => {
          ready = true;
          return true;
        },
        install: async () => {
          (window as any).updateOpened++;
        },
        onProgress: () => () => {},
      },
    } as any;
  });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '关于', exact: true }).click();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.locator('.update-settings')).toContainText('发现 v1.0.0');
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await expect(page.locator('.update-settings')).toContainText('SHA-256');
  await page.getByRole('tab', { name: '编译设置', exact: true }).click();
  await page.getByRole('tab', { name: '关于', exact: true }).click();
  await page.getByRole('button', { name: '打开安装包', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).updateOpened)).toBe(1);
  await page.screenshot({ path: '.qa/preview-0.9.6-update.png', animations: 'disabled' });
});
