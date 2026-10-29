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
                    (run.prompt === '改写成英文' ? 'apple' : 'INLINE EDIT') +
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
    state.connections = 0;
    state.idle = 5;
    state.idleDisconnect = () => listener({ type: 'connection', reason: 'idle' });
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
        getIdleSettings: async () => ({ idleMinutes: state.idle }),
        setIdleSettings: async (s) => {
          state.idle = s.idleMinutes;
          return s;
        },
        connect: async () => {
          state.connections++;
          return {
            connected: true,
            authenticated: true,
            version: 'codex-cli test',
            models: [{ id: 'test-model', label: 'Test model', isDefault: true }],
          };
        },
        chooseBinary: async () => null,
        disconnect: async () => {
          if (run) emit('done', { status: 'interrupted' });
          listener({ type: 'connection', reason: 'manual' });
        },
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
          if (input.prompt === 'markdown') {
            emit('text', {
              delta:
                '# 标题\n\n**强调** 和 `code`\n\n- 列表项\n\n| 列 A | 列 B |\n| --- | --- |\n| 一 | 二 |\n\n```latex\n\\alpha + \\beta\n```\n\n$$x^2$$\n\n<script>window.pwned = true</script>\n[恶意链接](javascript:alert(1))\n![图片](https://invalid.example/pixel.png)',
            });
            emit('done', { status: 'completed' });
            return;
          }
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
  await page.getByRole('button', { name: '连接 Agent CLI', exact: true }).click();
  await expect(page.getByText('已连接')).toBeVisible();
}
async function send(page: Page, prompt: string) {
  await page.getByLabel('发送给 Agent CLI 的指令').fill(prompt);
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

test('panel selection edits only selected text and conversations persist independently', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '最小化 AI 窗口' }).click();
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('Before\n苹果\nAfter');
  await editor.press('Control+Home');
  await editor.press('ArrowDown');
  await editor.press('Home');
  await editor.press('Shift+End');
  await page.getByRole('button', { name: '展开 AI 窗口' }).click();
  await expect(page.locator('.ai-selection-range')).toHaveText('第 2 行，第 1–2 字');
  await send(page, '改写成英文');
  await expect(editor.locator('.cm-line')).toHaveText(['Before', 'apple', 'After']);
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  const first = await page.evaluate(() => (window as any).aiTest.run.conversationId);
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await expect(page.locator('.ai-task')).toHaveCount(0);
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  await page.getByRole('button', { name: '打开对话 改写成英文', exact: true }).click();
  await expect(page.locator('.ai-task')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.locator('.ai-user-message')).toHaveText('改写成英文');
  await page.getByRole('button', { name: '连接 Agent CLI', exact: true }).click();
  await send(page, 'edit');
  await expect(page.locator('.ai-task')).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).aiTest.run?.conversationId))
    .toBe(first);
  const panel = await page.locator('.ai-heading').boundingBox(),
    tabs = await page.getByRole('tablist', { name: 'AI 模式' }).boundingBox();
  expect(Math.abs(panel!.x + panel!.width / 2 - (tabs!.x + tabs!.width / 2))).toBeLessThan(2);
  await page.screenshot({ path: '.qa/ai-next-conversations.png', animations: 'disabled' });
});

test('Agent CLI chooser configures ACP and empty conversations clear only after confirmation', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.texite!.ai!.configure = async (config) => {
      (window as any).configuredCLI = config;
      return config;
    };
  });
  await page.getByRole('button', { name: '已连接', exact: true }).click();
  await page.getByRole('button', { name: '选择 Agent CLI', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent CLI', exact: true });
  await dialog.getByRole('combobox', { name: 'Agent CLI 类型' }).click();
  await page.getByRole('option', { name: 'Qwen Code', exact: true }).click();
  await expect(dialog.getByLabel('Agent CLI 程序', { exact: true })).toHaveValue('qwen');
  await expect(dialog.getByLabel('Agent CLI 参数', { exact: true })).toHaveValue('["--acp"]');
  await page.screenshot({ path: '.qa/ai-next-cli.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).configuredCLI)).toMatchObject({
    preset: 'qwen',
    protocol: 'acp',
    command: 'qwen',
    args: ['--acp'],
  });
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await page.getByRole('button', { name: '清空当前项目 Agent 记录', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '清空 Agent 记录？' });
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开对话 新对话' })).toHaveCount(1);
  await page.getByRole('button', { name: '清空当前项目 Agent 记录', exact: true }).click();
  await confirm.getByRole('button', { name: '确认清空', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开对话 新对话' })).toHaveCount(0);
});

test('manual and idle disconnect preserve conversations and reconnect on send', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '断开 CLI 连接' }).click();
  await expect(page.getByText('已连接')).toHaveCount(0);
  await send(page, 'edit');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).aiTest.connections)).toBe(2);
  await page.getByRole('button', { name: '已连接' }).click();
  await page.getByRole('combobox', { name: '空闲自动断开' }).click();
  await page.getByRole('option', { name: '1 分钟', exact: true }).click();
  expect(await page.evaluate(() => (window as any).aiTest.idle)).toBe(1);
  await page.evaluate(() => (window as any).aiTest.idleDisconnect());
  await expect(page.getByText('已连接')).toHaveCount(0);
  await send(page, 'wait');
  await expect(page.getByText('进行中', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).aiTest.connections)).toBe(3);
  await page.getByRole('button', { name: '断开 CLI 连接' }).click();
  await expect(page.getByText('已停止', { exact: true })).toBeVisible();
  await expect(page.locator('.ai-task')).toHaveCount(2);
});

test('conversation context menu renames persistently and deletes only the confirmed conversation', async ({
  page,
}) => {
  await setup(page);
  const editor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
  await editor.fill('Document content to preserve');
  await send(page, 'edit');
  await expect(page.getByText('已完成', { exact: true })).toBeVisible();
  const edited = await editor.textContent();
  await page.getByRole('button', { name: '新建对话', exact: true }).click();
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  const first = page.getByRole('button', { name: '打开对话 edit', exact: true });
  await first.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '对话操作' })).toBeVisible();
  await page.screenshot({
    path: '.qa/release-0.10.0-conversation-menu.png',
    animations: 'disabled',
  });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名对话' });
  await rename.getByLabel('对话名称').fill('论文润色');
  await rename.getByRole('button', { name: '保存名称' }).click();
  await expect(rename).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  const named = page.getByRole('button', { name: '打开对话 论文润色', exact: true });
  await named.focus();
  await named.press('Shift+F10');
  await page.getByRole('menuitem', { name: '删除对话', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除这条对话？' });
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(named).toBeVisible();
  await named.click();
  await expect(page.locator('.ai-task')).toHaveCount(1);
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  await named.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除对话', exact: true }).click();
  await confirm.getByRole('button', { name: '确认删除' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(named).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开对话 新对话', exact: true })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.locator('.ai-task')).toHaveCount(0);
  await expect(editor).toHaveText(edited!);
  await page.reload();
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByRole('button', { name: '对话记录', exact: true }).click();
  await expect(named).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开对话 新对话', exact: true })).toBeVisible();
});

test('Agent and chat render Markdown safely, with math, tables and copyable code', async ({
  page,
}) => {
  await setup(page);
  let remoteImages = 0;
  page.on('request', (r) => {
    if (r.url().includes('invalid.example')) remoteImages++;
  });
  for (const mode of ['Agent', '对话']) {
    await page.getByRole('tab', { name: mode, exact: true }).click();
    await send(page, 'markdown');
    const reply = page.locator('.ai-reply').last();
    await expect(reply.getByRole('heading', { name: '标题' })).toBeVisible();
    await expect(reply.locator('strong')).toHaveText('强调');
    await expect(reply.locator('table td')).toHaveText(['一', '二']);
    await expect(reply.locator('pre code')).toContainText('alpha');
    await expect(reply.locator('.katex')).toHaveCount(1);
    await expect(reply.getByRole('button', { name: '复制代码' })).toBeVisible();
    await expect(reply.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  }
  expect(remoteImages).toBe(0);
  await page.screenshot({ path: '.qa/ai-markdown.png', animations: 'disabled' });
});

test('AI floating window responds to every edge and corner', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  const panel = page.locator('.ai-panel');
  for (const edge of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) {
    const handle = page.locator('.ai-resize-' + edge),
      box = (await handle.boundingBox())!;
    const before = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (edge.includes('w') ? -12 : 12),
      box.y + box.height / 2 + (edge.includes('n') ? -12 : 12),
    );
    await page.mouse.up();
    const after = (await panel.boundingBox())!;
    expect(
      Math.abs(after.width - before.width) + Math.abs(after.height - before.height),
    ).toBeGreaterThan(0);
    expect(after.x).toBeGreaterThanOrEqual(8);
    expect(after.y).toBeGreaterThanOrEqual(8);
  }
});
