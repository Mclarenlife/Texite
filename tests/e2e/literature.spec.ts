import { expect, test } from '@playwright/test';

test('configure research AI, select multiple index results and persist annotated BibTeX', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '文献检索' }).click();
  await page.getByRole('button', { name: '配置 API', exact: true }).click();
  await page.getByLabel('API 地址', { exact: true }).fill('https://research.example.test/v1');
  await page.getByLabel('API 模型名称').fill('test-model');
  await page.getByRole('button', { name: '保存配置' }).click();
  await expect(page.getByRole('button', { name: '配置 API', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  let turns = 0;
  await page.route('https://research.example.test/v1/chat/completions', (route) => {
    turns++;
    if (turns === 2)
      expect(route.request().postDataJSON().messages[1].content).toBe('逆热传导配点方法');
    const content =
      turns === 1
        ? { query: '' }
        : turns === 2 || turns === 4
          ? { query: 'example paper' }
          : {
              papers: [
                {
                  id: 0,
                  summary: '作者提出了自适应热传导求解器。',
                  evidence: 'We developed an adaptive heat solver.',
                },
                {
                  id: 1,
                  summary: '作者比较了两种配点方法。',
                  evidence: 'We compared two collocation methods.',
                },
              ],
            };
    return route.fulfill({
      json: { choices: [{ message: { content: JSON.stringify(content) } }] },
    });
  });
  await page.route('https://api.crossref.org/works?**', (route) =>
    route.fulfill({
      json: {
        message: {
          items: ['First paper', 'Second paper'].map((title, i) => ({
            DOI: '10.1234/example' + i,
            title: [title],
            author: [{ family: 'Smith', given: 'A' }],
            issued: { 'date-parts': [[2025]] },
            type: 'journal-article',
            abstract:
              i === 0
                ? 'We developed an adaptive heat solver.'
                : 'We compared two collocation methods.',
          })),
        },
      },
    }),
  );
  await page.getByRole('button', { name: '参考文献', exact: true }).click();
  await page.getByRole('button', { name: '智能检索' }).click();
  const dialog = page.getByRole('dialog', { name: '智能检索' });
  await expect(dialog.getByRole('button', { name: '开始检索' })).toBeVisible();
  expect(turns).toBe(0);
  await dialog.getByRole('button', { name: '开始检索' }).click();
  await expect(dialog.getByRole('alert')).toContainText('研究主题');
  await dialog.getByRole('textbox', { name: '研究主题' }).fill('逆热传导配点方法');
  await dialog.getByLabel('检索篇数').fill('1');
  await dialog.getByLabel('起始年份').fill('2024');
  await dialog.getByLabel('结束年份').fill('2025');
  await dialog.getByRole('button', { name: '开始检索' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'First paper' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '研究主题' })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'First paper' }).check();
  await dialog.getByLabel('关闭智能检索').click();
  await page.getByRole('button', { name: '智能检索' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'First paper' })).toBeChecked();
  expect(turns).toBe(3);
  await dialog.getByRole('button', { name: '删除所选' }).click();
  await dialog.getByRole('button', { name: '继续检索' }).click();
  await expect(dialog.getByText('作者比较了两种配点方法。')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'First paper' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '重新检索' }).click();
  expect(turns).toBe(3);
  await expect(dialog.getByLabel('起始年份')).toHaveValue('2024');
  await dialog.getByLabel('检索篇数').fill('2');
  await dialog.getByRole('button', { name: '开始检索' }).click();
  await dialog.getByRole('checkbox', { name: 'First paper' }).check();
  const before = (await dialog.boundingBox())!;
  const grip = (await dialog.getByLabel('移动智能检索窗口').boundingBox())!;
  await page.mouse.move(grip.x + 35, grip.y + 12);
  await page.mouse.down();
  await page.mouse.move(grip.x - 55, grip.y + 42, { steps: 3 });
  await page.mouse.up();
  const moved = (await dialog.boundingBox())!;
  expect(moved.x).toBeCloseTo(before.x - 90, 0);
  expect(moved.y).toBeCloseTo(before.y + 30, 0);
  await expect(dialog.getByRole('separator')).toHaveCount(8);
  const corner = (await dialog
    .getByRole('separator', { name: '调整 智能检索 窗口大小 · 左下角' })
    .boundingBox())!;
  await page.mouse.move(corner.x + 5, corner.y + 5);
  await page.mouse.down();
  await page.mouse.move(corner.x - 35, corner.y - 25, { steps: 4 });
  await page.mouse.up();
  const resized = (await dialog.boundingBox())!;
  expect(resized.width).toBeCloseTo(moved.width + 40, 0);
  expect(resized.height).toBeCloseTo(moved.height - 30, 0);
  await page.getByRole('button', { name: '项目文件', exact: true }).click();
  const manuscriptEditor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await manuscriptEditor.click({ position: { x: 12, y: 12 } });
  await page.keyboard.insertText('% 浮窗外编辑 ');
  await expect(manuscriptEditor).toContainText('浮窗外编辑');
  await expect(dialog.getByRole('checkbox', { name: 'First paper' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Second paper' }).check();
  await dialog.getByRole('button', { name: '保存所选（2）' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '项目文件', exact: true }).click();
  await page.getByRole('button', { name: 'references.bib', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await expect(editor).toContainText('% https://doi.org/10.1234/example0');
  await expect(editor).toContainText('% https://doi.org/10.1234/example1');
  expect(turns).toBe(5);
});
