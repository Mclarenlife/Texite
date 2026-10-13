import { test, expect } from '@playwright/test';

test('Chinese search supports literal LaTeX, replacement and regex; UI size is independent and persistent', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器', includeHidden: true });
  await editor.fill('\\theta + \\theta + beta');
  const editorSize = await editor.evaluate((el) => getComputedStyle(el).fontSize);
  const title = page.locator('.project-tab.active > button:first-child');
  const initial = parseFloat(await title.evaluate((el) => getComputedStyle(el).fontSize));
  await editor.press('Control+f');
  const search = page.locator('.texite-search');
  await expect(search).toBeVisible();
  await search.getByRole('textbox', { name: '查找内容' }).fill('\\theta');
  await expect(search).toContainText('2 处匹配');
  await search.getByRole('textbox', { name: '替换为' }).fill('\\alpha');
  await search.getByRole('button', { name: '全部替换', exact: true }).click();
  await expect(editor).toHaveText('\\alpha + \\alpha + beta');
  await search.getByLabel('正则表达式').check();
  await search.getByRole('textbox', { name: '查找内容' }).fill('[');
  await expect(search).toContainText('表达式无效');
  await page.screenshot({ path: '.qa/search-modern.png', animations: 'disabled' });
  await search.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: '界面字号' });
  for (const [label, factor] of [
    ['大', 1.16],
    ['小', 0.92],
    ['中', 1],
  ] as const) {
    await group.getByRole('radio', { name: label, exact: true }).click();
    expect(parseFloat(await title.evaluate((el) => getComputedStyle(el).fontSize))).toBeCloseTo(
      initial * factor,
      1,
    );
    await expect(editor).toHaveCSS('font-size', editorSize);
  }
  await group.getByRole('radio', { name: '大', exact: true }).click();
  await page.screenshot({ path: '.qa/ui-size-large.png', animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.reload();
  expect(parseFloat(await title.evaluate((el) => getComputedStyle(el).fontSize))).toBeCloseTo(
    initial * 1.16,
    1,
  );
  await expect(editor).toHaveCSS('font-size', editorSize);
  await expect(page.locator('.project-folder')).toHaveCount(0);
  expect(
    (await page.getByRole('tab', { name: 'PDF', exact: true }).boundingBox())!.width,
  ).toBeGreaterThanOrEqual(60);
});

test('advanced insertions generate wide floats, equations, symbols, links and references with undo', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}');
  async function open(name: string) {
    await page
      .locator('.cm-line')
      .filter({ hasText: /^Body$/ })
      .click({ button: 'right' });
    await page.getByRole('button', { name, exact: true }).click();
  }
  async function undo() {
    await editor.press('Control+z');
    await expect(editor).toContainText('Body');
  }
  await open('插入表格');
  await page.getByLabel('跨双栏', { exact: true }).check();
  await page.getByLabel('三线表', { exact: true }).check();
  await page.getByLabel('居中', { exact: true }).check();
  await page.getByLabel('浮动体标题').fill('Results & comparison');
  await page.getByLabel('浮动体标签').fill('tab:results');
  await page.getByRole('button', { name: '插入表格代码' }).click();
  await expect(editor).toContainText('\\begin{table*}[t]');
  await expect(editor).toContainText('\\usepackage{booktabs}');
  await expect(editor).toContainText('Results \\& comparison');
  await undo();
  await expect(editor).not.toContainText('booktabs');
  await open('插入公式');
  await page.getByRole('combobox', { name: '公式样式' }).click();
  await page.getByRole('option', { name: '分段函数', exact: true }).click();
  await page.getByLabel('公式编号', { exact: true }).check();
  await page.getByLabel('公式标签').fill('eq:piecewise');
  await page.getByRole('button', { name: '插入公式代码' }).click();
  await expect(editor).toContainText('\\begin{cases}');
  await expect(editor).toContainText('\\begin{equation}');
  await expect(editor).toContainText('\\usepackage{amsmath}');
  await undo();
  await open('插入符号');
  await page.getByRole('textbox', { name: '搜索符号' }).fill('alpha');
  await page.screenshot({ path: '.qa/symbol-picker.png', animations: 'disabled' });
  await page.getByRole('button', { name: '插入 \\alpha', exact: true }).click();
  await expect(editor).toContainText('\\(\\alpha\\)');
  await undo();
  await open('插入链接');
  await page.getByLabel('链接网址').fill('https://example.com/a#part');
  await page.getByLabel('链接文字').fill('A & B');
  await page.getByRole('button', { name: '插入链接代码' }).click();
  await expect(editor).toContainText('\\href{https://example.com/a\\#part}{A \\& B}');
  await expect(editor).toContainText('\\usepackage{hyperref}');
  await undo();
  for (const [name, command, key] of [
    ['文献引用', 'cite', 'vaswani2017'],
    ['交叉引用', 'ref', 'tab:results'],
  ]) {
    await open(name);
    await page.getByLabel('引用键', { exact: true }).fill(key);
    await page.getByRole('button', { name: '插入 ' + command, exact: true }).click();
    await expect(editor).toContainText('\\' + command + '{' + key + '}');
    await undo();
  }
});

test('image dropdown filters by name without dismissing insert tool and inserts a two-column figure', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}');
  await page
    .locator('.cm-line')
    .filter({ hasText: /^Body$/ })
    .click({ button: 'right' });
  await page.getByRole('button', { name: '插入图片', exact: true }).click();
  for (const name of ['alpha.png', 'beta.png'])
    await page.getByLabel('导入图片文件').setInputFiles({
      name,
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=',
        'base64',
      ),
    });
  await page.getByRole('combobox', { name: '项目图片' }).click();
  await page.getByRole('textbox', { name: '筛选项目图片' }).fill('alpha');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('textbox', { name: '筛选项目图片' }).press('Enter');
  await expect(page.getByRole('dialog', { name: '插入工具', exact: true })).toBeVisible();
  await page.getByLabel('跨双栏', { exact: true }).check();
  await page.getByLabel('图片宽度百分比').fill('100');
  await page.getByRole('button', { name: '插入图片代码' }).click();
  await expect(editor).toContainText('\\begin{figure*}[t]');
  await expect(editor).toContainText('\\includegraphics[width=1\\linewidth]{assets/alpha.png}');
});

test('dark compact windows keep insertion palettes and search controls within the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .getByRole('radiogroup', { name: '外观', exact: true })
    .getByRole('radio', { name: '深色', exact: true })
    .click();
  await page
    .getByRole('radiogroup', { name: '界面字号' })
    .getByRole('radio', { name: '大', exact: true })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: '关闭弹窗', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('Body');
  await page
    .locator('.cm-line')
    .filter({ hasText: /^Body$/ })
    .click({ button: 'right' });
  await page.getByRole('button', { name: '插入符号', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '插入工具', exact: true });
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(768);
  await page.screenshot({ path: '.qa/symbols-dark-compact.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭编辑工具' }).click();
  await editor.press('Control+f');
  await page.getByRole('textbox', { name: '查找内容' }).fill('Body');
  const search = page.locator('.texite-search');
  await expect(search).toContainText('1 处匹配');
  expect(await search.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await page.screenshot({ path: '.qa/search-dark-compact.png', animations: 'disabled' });
});
