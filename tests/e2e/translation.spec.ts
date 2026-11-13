import { test, expect } from '@playwright/test';

test('PDF translation sits left of locate and sends the selected passage using saved translation settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '翻译', exact: true }).click();
  await page.getByLabel('LibreTranslate 地址').fill('https://translate.example.test');
  await page.getByLabel('API Key', { exact: true }).fill('session-secret');
  await page.getByRole('button', { name: '保存翻译设置' }).click();
  await expect(page.getByText('翻译设置已保存。')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('texite.translation'))).not.toContain(
    'session-secret',
  );
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  const span = page
    .locator('.texite-text-layer span')
    .filter({ hasText: /[a-z]{3}/i })
    .first();
  await expect(span).toBeVisible({ timeout: 20000 });
  const selected = await span.evaluate((el) => {
    const node = el.firstChild!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, Math.min(6, node.textContent!.length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await span.dispatchEvent('mouseup');
  const button = page.getByRole('button', { name: '翻译选中文字' });
  const locate = page.getByRole('button', { name: '定位到源码' });
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.x).toBeLessThan((await locate.boundingBox())!.x);
  let body;
  await page.route('https://translate.example.test/translate', (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { translatedText: '论文节选译文' } });
  });
  await button.click();
  const dialog = page.getByRole('dialog', { name: '选区翻译' });
  await expect(dialog.getByRole('status')).toHaveText('论文节选译文');
  expect(body).toEqual({
    q: selected,
    source: 'auto',
    target: 'zh',
    format: 'text',
    api_key: 'session-secret',
  });
  await dialog.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(dialog).toHaveCount(0);
});
