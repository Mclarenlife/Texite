import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

test('project PDF and SVG preview in the editor, Ctrl-wheel zooms only the asset', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const zip = new JSZip();
  zip.file('main.tex', '\\documentclass{article}\n\\begin{document}Keep source\\end{document}');
  zip.file('paper.pdf', await readFile('public/sample.pdf'));
  zip.file(
    'figure.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#888"/><circle cx="450" cy="250" r="100" fill="#eee"/></svg>',
  );
  await page.goto('/');
  await page
    .locator('input[accept=".zip"]')
    .setInputFiles({
      name: 'Assets.zip',
      mimeType: 'application/zip',
      buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    });
  await page.getByRole('button', { name: 'paper.pdf', exact: true }).click();
  const assetPdf = page.getByRole('region', { name: '项目 PDF 预览', exact: true });
  await expect(assetPdf.locator('canvas')).toHaveCount(1);
  await expect
    .poll(() => assetPdf.locator('canvas').evaluate((e: HTMLCanvasElement) => e.width))
    .toBeGreaterThan(0);
  await assetPdf.locator('.pdf-scroll').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(assetPdf.getByLabel('适合宽度')).toHaveText('110%');
  await expect(
    page.getByRole('region', { name: 'PDF 预览', exact: true }).getByLabel('适合宽度'),
  ).toHaveText('100%');
  await page.getByRole('button', { name: 'figure.svg', exact: true }).click();
  const image = page.getByRole('img', { name: 'figure.svg' });
  await expect.poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(900);
  const before = (await image.boundingBox())!.width;
  await image.hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(page.getByLabel('图片适合窗口')).toHaveText('110%');
  expect((await image.boundingBox())!.width).toBeGreaterThan(before);
  await page.screenshot({ path: '.qa/asset-preview-new.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'main.tex 主文件', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'Keep source',
  );
  expect(errors).toEqual([]);
});

test('project space supports properties, rename, multi-select, trash and durable restore', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '项目首页' }).click();
  await page.getByRole('button', { name: '查看 示例项目 属性' }).click();
  await expect(page.getByRole('dialog', { name: '项目属性' })).toContainText('main.tex');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.getByLabel('选择项目 示例项目', { exact: true }).check();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('新项目名称').fill('Renamed project');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开项目 Renamed project' })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('dialog', { name: '新建项目' }).getByRole('textbox').fill('Second');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.save-indicator')).toContainText('已保存');
  await page.getByRole('button', { name: '项目首页' }).click();
  await page.getByLabel('全选项目').check();
  await expect(page.getByRole('button', { name: '重命名', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('button', { name: '移到最近删除', exact: true }).click();
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: '项目空间' })).toBeVisible();
  await expect(page.locator('.project-card')).toHaveCount(0);
  await page.getByRole('button', { name: /最近删除/ }).click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.getByLabel('全选项目').check();
  await page.getByRole('button', { name: '恢复项目', exact: true }).click();
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '打开项目 Renamed project' }).click();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    'documentclass',
  );
  await page.getByRole('button', { name: '项目首页' }).click();
  await page.screenshot({ path: '.qa/project-space-new.png', animations: 'disabled' });
});

test('AI help and resize, and custom select placement and keyboard inside a modal', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'AI 助手', exact: true });
  expect((await panel.boundingBox())!.width).toBeGreaterThan(479);
  await panel.getByRole('button', { name: 'AI 使用说明' }).hover();
  await expect(panel.getByRole('tooltip')).toContainText('修改自动保留恢复记录');
  await expect(panel.locator('.ai-composer')).not.toContainText('AI 需要联网');
  const heading = await panel.locator('.ai-heading strong').boundingBox();
  const beforeDrag = await panel.boundingBox();
  await page.mouse.move(heading!.x + 10, heading!.y + 5);
  await page.mouse.down();
  await page.mouse.move(heading!.x - 140, heading!.y + 5, { steps: 5 });
  await page.mouse.up();
  const original = await panel.boundingBox();
  expect(original!.x).toBeLessThan(beforeDrag!.x - 100);
  const handle = await page.getByRole('separator', { name: '调整 AI 窗口大小' }).boundingBox();
  await page.mouse.move(handle!.x + 10, handle!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 80, handle!.y + 55, { steps: 8 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(original!.width + 40);
  expect((await panel.boundingBox())!.height).toBeGreaterThan(original!.height + 20);
  await page.screenshot({ path: '.qa/ai-window-new.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭 AI 面板' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '编译设置', exact: true }).click();
  const trigger = page.getByRole('combobox', { name: '编译引擎' });
  await trigger.click();
  const menu = page.getByRole('listbox', { name: '编译引擎' });
  await expect(menu).toBeVisible();
  const tr = await trigger.boundingBox(),
    mr = await menu.boundingBox();
  expect(Math.abs(tr!.x - mr!.x)).toBeLessThan(20);
  await page.screenshot({ path: '.qa/select-new.png', animations: 'disabled' });
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(trigger).toContainText('Tectonic');
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
});
