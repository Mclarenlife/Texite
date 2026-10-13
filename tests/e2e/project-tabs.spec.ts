import { test, expect } from '@playwright/test';

test('project tabs retain edits, close without deletion, and reopen from the full-width header', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '示例项目', exact: true })).toBeVisible();
  const source = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await source.fill('\\documentclass{article}\n\\begin{document}First tab edited\\end{document}');
  await page.getByRole('button', { name: '项目首页', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('dialog', { name: '新建项目' }).getByRole('textbox').fill('Second tab');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Second tab', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await source.fill('\\documentclass{article}\n\\begin{document}Second tab edited\\end{document}');
  await page.getByRole('tab', { name: '示例项目', exact: true }).click();
  await expect(source).toContainText('First tab edited');
  await source.press('Control+z');
  await expect(source).not.toContainText('First tab edited');
  await expect(source).not.toContainText('Second tab edited');
  await source.press('Control+y');
  await expect(source).toContainText('First tab edited');
  await page.getByRole('tab', { name: 'Second tab', exact: true }).click();
  await expect(source).toContainText('Second tab edited');
  await page.getByRole('button', { name: '关闭项目 Second tab', exact: true }).click();
  await expect(source).toContainText('First tab edited');
  await page.getByRole('button', { name: '关闭项目 示例项目', exact: true }).click();
  await expect(page.getByRole('region', { name: '项目空间', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开项目 示例项目', exact: true }).click();
  await expect(page.getByRole('tab', { name: '示例项目', exact: true })).toBeVisible();
  await expect(source).toContainText('First tab edited');
  await expect(page.getByRole('button', { name: '编译文稿', exact: true })).toHaveText('编译');
  await expect(page.getByRole('button', { name: '仅编辑器', exact: true })).toHaveText('');
  await expect(page.getByRole('button', { name: '仅编辑器', exact: true })).toHaveAttribute(
    'title',
    '仅编辑器',
  );
  await page.screenshot({ path: '.qa/project-tabs-new.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
  await expect(page.getByRole('tab', { name: '同步与存储' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toContainText(
    'WebDAV 同步和系统目录设置',
  );
});
