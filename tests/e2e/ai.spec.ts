import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.addInitScript(() => {
    let listener: (e: any) => void = () => {};
    let run: any;
    let before = '';
    let stage = '';
    const emit = (type: string, rest: any) =>
      listener({ type, runId: run.runId, projectId: run.projectId, ...rest });
    const tool = (name: string, args: any) => {
      stage = name;
      emit('tool', { requestId: crypto.randomUUID(), tool: name, arguments: args });
    };
    (window as any).aiTest = {
      disk: null,
      removals: [],
      compiled: 0,
      write: () =>
        tool('texite_apply_changes', {
          changes: JSON.parse(run.context).inlineEdit
            ? [
                {
                  path: 'main.tex',
                  before,
                  after:
                    (state.outside ? 'UNREQUESTED CHANGE\n' : '') +
                    before.slice(0, JSON.parse(run.context).inlineEdit.from) +
                    'INLINE EDIT' +
                    before.slice(JSON.parse(run.context).inlineEdit.to),
                },
              ]
            : [
                { path: 'main.tex', before, after: before + '\n% AI revised' },
                { path: 'parts/ai.tex', before: null, after: 'AI chapter' },
              ],
        }),
    };
    const state = (window as any).aiTest;
    window.texite = {
      openProject: async () => null,
      listProjects: async () => [],
      reopenProject: async () => null,
      importProject: async (p) => p,
      saveProject: async (p) => {
        state.disk = p;
      },
      saveAIProject: async (p, removals) => {
        if (state.failNative) {
          emit('text', { delta: '正在保存修改。' });
          await new Promise((resolve) => setTimeout(resolve, 600));
          throw new Error('模拟磁盘冲突');
        }
        state.disk = p;
        state.removals = removals;
      },
      detectEngines: async () => ({
        bundled: true,
        latexmk: false,
        engines: { pdflatex: true, xelatex: false, lualatex: false, tectonic: false },
      }),
      onCompileLog: () => () => {},
      cancelCompile: async () => {},
      compile: async (p) => {
        state.compiled++;
        return {
          success: false,
          revision: p.revision,
          engine: 'pdflatex',
          compilerLabel: 'pdfLaTeX test',
          log: 'Mock diagnostic',
        };
      },
      ai: {
        connect: async () => ({
          connected: true,
          authenticated: true,
          version: 'codex-cli test',
          models: [{ id: 'test-model', label: 'Test model', isDefault: true }],
        }),
        chooseBinary: async () => null,
        disconnect: async () => {},
        onEvent: (fn) => {
          listener = fn;
          return () => {
            listener = () => {};
          };
        },
        cancel: async () => emit('done', { status: 'interrupted' }),
        start: async (input) => {
          run = input;
          state.run = input;
          if (input.prompt === 'wait') return;
          tool('texite_read_file', { path: 'main.tex' });
        },
        reply: async (_id, result: any) => {
          if (!result.success) {
            emit('done', { status: 'failed', error: result.value.error });
            return;
          }
          if (stage === 'texite_read_file') {
            before = result.value.content;
            state.readRunId = run.runId;
            if (run.prompt === 'hold') return;
            state.write();
          } else if (stage === 'texite_apply_changes') tool('texite_compile', {});
          else {
            emit('text', { delta: '已修改文稿。编译返回测试诊断。' });
            emit('done', { status: 'completed' });
          }
        },
      },
    } as any;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '连接本机 Codex', exact: true }).click();
  await expect(page.getByText('已连接本机 Codex')).toBeVisible();
}
async function send(page: Page, prompt: string) {
  await page.getByLabel('发送给 Codex 的指令').fill(prompt);
  await page.getByRole('button', { name: '发送 AI 指令', exact: true }).click();
}

test('AI edits editor buffers, compiles, previews diff and durably undoes the entire task', async ({
  page,
}) => {
  await setup(page);
  await send(page, 'edit');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
    '% AI revised',
  );
  expect(await page.evaluate(() => (window as any).aiTest.compiled)).toBe(1);
  await page.getByRole('button', { name: '2 个文件 · 查看差异' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 修改差异' });
  await expect(dialog.locator('.diff-added')).toContainText(['% AI revised', 'AI chapter']);
  await dialog.getByRole('button', { name: '撤回整次修改' }).click();
  await expect(dialog.getByText('已撤回，修改记录仍保留')).toBeVisible();
  expect(await page.evaluate(() => (window as any).aiTest.removals)).toEqual([
    { path: 'parts/ai.tex', expected: 'AI chapter' },
  ]);
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.getByText('已撤回', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).not.toContainText(
    '% AI revised',
  );
  await page.screenshot({ path: '.qa/ai-panel.png', animations: 'disabled' });
});

test('AI protects concurrent edits and read-only mode; stop ends the active task', async ({
  page,
}) => {
  await setup(page);
  await send(page, 'hold');
  await expect(page.locator('.ai-activity')).toContainText('读取文稿');
  await page.getByRole('textbox', { name: 'LaTeX 源码编辑器' }).fill('Human changes');
  await page.evaluate(() => (window as any).aiTest.write());
  await expect(page.locator('.ai-task-error')).toContainText('已发生变化');
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toHaveText('Human changes');
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await send(page, 'readonly');
  await expect(page.locator('.ai-task-error').last()).toContainText('只读模式');
  await send(page, 'wait');
  await page.getByRole('button', { name: '停止 AI 任务', exact: true }).click();
  await expect(page.getByText('已停止', { exact: true })).toBeVisible();
});

test('undo refuses to overwrite a subsequent manual edit', async ({ page }) => {
  await setup(page);
  await send(page, 'edit');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'LaTeX 源码编辑器' }).fill('Keep my new work');
  await page.getByRole('button', { name: '2 个文件 · 查看差异' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 修改差异' });
  await dialog.getByRole('button', { name: '撤回整次修改' }).click();
  await expect(dialog.getByRole('alert')).toContainText('又被编辑');
  expect(await page.evaluate(() => (window as any).aiTest.removals)).toEqual([]);
});

test('disk sync failure preserves the committed AI recovery journal while streaming', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    (window as any).aiTest.failNative = true;
  });
  await send(page, 'edit');
  await expect(page.locator('.ai-task-error')).toContainText('磁盘同步失败');
  await expect(page.getByRole('button', { name: '2 个文件 · 查看差异' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '2 个文件 · 查看差异' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 修改差异' });
  await expect(dialog.locator('.diff-added')).toContainText(['% AI revised', 'AI chapter']);
  await dialog.getByRole('button', { name: '撤回整次修改' }).click();
  await expect(dialog.getByText('已撤回，修改记录仍保留')).toBeVisible();
});

test('failed AI transaction never applies files without the recovery journal', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'projects' && value.files.some((f: any) => f.path === 'parts/ai.tex'))
        throw new DOMException('模拟 AI 事务失败', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await send(page, 'edit');
  await expect(page.locator('.ai-task-error')).toContainText('模拟 AI 事务失败');
  await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).not.toContainText(
    '% AI revised',
  );
  await expect(page.getByRole('button', { name: '2 个文件 · 查看差异' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).aiTest.compiled)).toBe(0);
});

test('inline Agent replaces exactly the selected range and floating window never shrinks the workspace', async ({
  page,
}) => {
  await setup(page);
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  const workspace = await page.locator('.workspace').boundingBox();
  const sidebar = page.getByRole('complementary', { name: '项目导航' });
  await expect(sidebar).toBeVisible();
  await page.getByLabel('移动 AI 浮动窗口').focus();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: '最小化 AI 窗口' }).click();
  await editor.fill('Before\nselected text\nAfter');
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await editor.press('Home');
  await editor.press('Shift+End');
  await editor.press('Alt+Enter');
  await page.getByRole('textbox', { name: '行内 AI 指令', exact: true }).fill('Improve this');
  await page.getByRole('button', { name: '执行行内 AI 指令' }).click();
  await expect(editor.locator('.cm-line')).toHaveText(['Before', 'INLINE EDIT', 'After']);
  const run = await page.evaluate(() => (window as any).aiTest.run);
  expect(JSON.parse(run.context).inlineEdit.selection).toBe('selected text');
  expect(run.readOnly).toBe(false);
  expect((await page.locator('.workspace').boundingBox())!.width).toBe(workspace!.width);
  await page.screenshot({ path: '.qa/ai-floating-agent.png', animations: 'disabled' });
});

test('inline Agent refuses edits outside the captured range and preserves later typing', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '最小化 AI 窗口' }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('Original text');
  await editor.press('End');
  await editor.press('Alt+Enter');
  await page.getByRole('textbox', { name: '行内 AI 指令', exact: true }).fill('hold');
  await page.getByRole('button', { name: '执行行内 AI 指令' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).aiTest.readRunId)).toBeTruthy();
  await page.evaluate(() => {
    (window as any).aiTest.outside = true;
    (window as any).aiTest.write();
  });
  await expect(page.locator('.ai-task-error').last()).toContainText('超出选区');
  await expect(editor).toHaveText('Original text');
  const firstRun = await page.evaluate(() => (window as any).aiTest.readRunId);
  await editor.press('End');
  await editor.press('Alt+Enter');
  await page.getByRole('textbox', { name: '行内 AI 指令', exact: true }).fill('hold');
  await page.getByRole('button', { name: '执行行内 AI 指令' }).click();
  // Wait for this run's read result; the previous task retains the same activity label.
  await expect.poll(() => page.evaluate(() => (window as any).aiTest.readRunId)).not.toBe(firstRun);
  await editor.fill('Original text with human edit');
  await page.evaluate(() => {
    (window as any).aiTest.outside = false;
    (window as any).aiTest.write();
  });
  await expect(page.locator('.ai-task-error').last()).toContainText('已发生变化');
  await expect(editor).toHaveText('Original text with human edit');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1024, height: 700 });
  const box = await page.locator('.ai-panel').boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: '.qa/ai-dark-compact.png', animations: 'disabled' });
});
