import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

test('project backups preserve all files, auto-back up before restore, and history clearing never deletes backups', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await page.getByRole('button', { name: '备份当前项目', exact: true }).click();
  await page.getByLabel('备份备注').fill('Baseline');
  await page.getByRole('button', { name: '保存备份', exact: true }).click();
  await expect(page.locator('.backup-row')).toHaveCount(1);
  await editor.fill(
    '\\documentclass{article}\n\\begin{document}\nChanged version\n\\end{document}',
  );
  await expect(page.locator('.history-list button')).toHaveCount(1);
  await page.getByRole('button', { name: '还原备份 Baseline', exact: true }).click();
  await expect(editor).toContainText('Research Notes');
  await expect(page.locator('.backup-row')).toHaveCount(2);
  await page
    .getByRole('button', { name: '还原备份 还原前自动备份 · Baseline', exact: true })
    .click();
  await expect(editor).toContainText('Changed version');
  await expect(page.locator('.backup-row')).toHaveCount(3);
  await page.getByRole('button', { name: '清空修改历史', exact: true }).click();
  await page.getByRole('button', { name: '清空全部历史', exact: true }).click();
  await expect(page.locator('.history-list button')).toHaveCount(0);
  await expect(page.locator('.backup-row')).toHaveCount(3);
  await page.reload();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.backup-row')).toHaveCount(3);
  await expect(page.locator('.history-list button')).toHaveCount(0);
  await page
    .locator('.backup-row')
    .filter({ hasText: 'Baseline' })
    .last()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除备份' }).click();
  await expect(page.locator('.backup-row')).toHaveCount(2);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出项目', exact: true }).click();
  const zip = await JSZip.loadAsync(await readFile((await (await event).path())!));
  expect(await zip.file('main.tex')!.async('string')).toContain('Changed version');
  expect(zip.file('references.bib')).not.toBeNull();
});

test('file scopes and reference fuzzy search filter results, sidebar splits persist and preview underline sits on header border', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '项目搜索', exact: true }).click();
  await expect(page.locator('.search-scope-button')).toHaveCSS('flex-direction','row');
  await page.getByLabel('搜索项目内容').fill('attention');
  await expect(
    page.locator('.project-search>button').filter({ hasText: 'references.bib' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: '全部文件', exact: true }).click();
  await page.getByRole('dialog').getByText('references.bib', { exact: true }).click();
  await page.getByRole('button', { name: '应用范围' }).click();
  await expect(
    page.locator('.project-search>button').filter({ hasText: 'references.bib' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '参考文献', exact: true }).click();
  await page.getByLabel('搜索参考文献').fill('attntion');
  await expect(page.locator('.reference-list button')).toHaveCount(1);
  await page.getByLabel('搜索参考文献').fill('not-a-match');
  await expect(page.locator('.reference-list button')).toHaveCount(0);
  await page.getByRole('button', { name: '项目文件', exact: true }).click();
  const split = page.getByRole('separator', { name: '调整上下栏比例' });
  const before = Number(await split.getAttribute('aria-valuenow'));
  await split.focus();
  await split.press('ArrowDown');
  await expect(split).toHaveAttribute('aria-valuenow', String(before + 3));
  const header = await page.locator('.pdf-header').boundingBox(),
    tab = await page.getByRole('tab', { name: 'PDF', exact: true }).boundingBox();
  expect(Math.abs(header!.y + header!.height - tab!.y - tab!.height)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: '.qa/navigation-layout.png' });
});

test('history time range removes only matching records and failed full-backup storage leaves source untouched', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toBeVisible();
  await expect(page.getByText('本地恢复副本已保存', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('texite-workspace', 2);
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction(['settings', 'projects'], 'readwrite'),
      request = tx.objectStore('projects').getAll();
    request.onsuccess = () => {
      const p = request.result[0];
      tx.objectStore('settings').put(
        [
          {
            id: 'old',
            path: 'main.tex',
            before: 'old',
            after: 'new',
            time: new Date(2025, 0, 1, 12).getTime(),
          },
          {
            id: 'new',
            path: 'main.tex',
            before: 'new',
            after: 'latest',
            time: new Date(2026, 0, 1, 12).getTime(),
          },
        ],
        'history:' + p.id,
      );
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: '修改历史', exact: true }).click();
  await expect(page.locator('.history-list button')).toHaveCount(2);
  await page.getByRole('button', { name: '清空修改历史', exact: true }).click();
  await page.getByLabel('历史开始时间').fill('2025-01-01T00:00');
  await page.getByLabel('历史结束时间').fill('2025-01-02T00:00');
  await page.getByRole('button', { name: '清空所选时间范围' }).click();
  await expect(page.locator('.history-list button')).toHaveCount(1);
  await expect(page.locator('.history-list')).toContainText('2026');
  await page.getByRole('button', { name: '备份当前项目', exact: true }).click();
  await page.getByLabel('备份备注').fill('Safe');
  await page.getByRole('button', { name: '保存备份', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('Current unsaved words');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'settings' && String(key).startsWith('backup:'))
        throw new DOMException('Backup quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: '还原备份 Safe', exact: true }).click();
  await expect(page.locator('.project-backups [role="alert"]')).toContainText(
    'Backup quota exceeded',
  );
  await expect(editor).toHaveText('Current unsaved words');
  await expect(page.locator('.backup-row')).toHaveCount(1);
});
