const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
(async () => {
  const base = path.resolve('.qa/sync-desktop-' + Date.now());
  const destination = path.join(base, 'chosen');
  await fs.mkdir(destination, { recursive: true });
  const cloud = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('test:secret').toString('base64')) {
      res.writeHead(401).end();
      return;
    }
    if (req.method === 'MKCOL') {
      res.writeHead(405).end();
      return;
    }
    if (req.method === 'PROPFIND') {
      res
        .writeHead(207)
        .end(
          '<d:multistatus xmlns:d="DAV:">' +
            [...cloud.keys()]
              .map((p) => '<d:response><d:href>' + p + '</d:href></d:response>')
              .join('') +
            '</d:multistatus>',
        );
      return;
    }
    const content = cloud.get(req.url);
    const etag = content
      ? '"' + crypto.createHash('sha256').update(content).digest('hex') + '"'
      : '';
    if (req.method === 'GET') {
      res.writeHead(content ? 200 : 404, content ? { ETag: etag } : {}).end(content);
      return;
    }
    if (req.method === 'PUT') {
      if (
        (req.headers['if-none-match'] === '*' && content) ||
        (req.headers['if-match'] && req.headers['if-match'] !== etag)
      ) {
        res.writeHead(412).end();
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      cloud.set(req.url, Buffer.concat(chunks).toString());
      res.writeHead(201).end();
      return;
    }
    res.writeHead(405).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let desktop;
  try {
    desktop = await electron.launch({
      executablePath: process.env.TEXITE_TEST_EXECUTABLE,
      args: [
        ...(process.env.TEXITE_TEST_EXECUTABLE ? [] : ['.']),
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      env: { ...process.env, TEXITE_TEST_USER_DATA: path.join(base, 'profile') },
    });
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ dialog, BrowserWindow }, destination) => {
      dialog.showMessageBoxSync = () => 1;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] });
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false);
    }, destination);
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.getByRole('tab', { name: '示例项目', exact: true })).toBeVisible();
    await expect(page.locator('.save-indicator')).toContainText('已保存');
    await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
    await page.getByLabel('服务地址').fill(`http://127.0.0.1:${server.address().port}/dav/`);
    await page.getByLabel('账号', { exact: true }).fill('test');
    await page.getByLabel('密码 / 应用密码').fill('secret');
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.locator('.sync-settings [role="status"]')).toHaveText('设置已保存。');
    await page.getByRole('button', { name: '更改目录' }).click();
    await expect(page.locator('.storage-path')).toContainText(destination);
    await page.getByRole('button', { name: '迁移当前项目到此目录' }).click();
    await expect(page.locator('.sync-settings [role="status"]')).toHaveText(
      '当前项目已迁移到所选目录，原目录保留为备份。',
    );
    const children = await fs.readdir(destination);
    expect(children.length).toBe(1);
    expect(await fs.readFile(path.join(destination, children[0], 'main.tex'), 'utf8')).toContain(
      'documentclass',
    );
    expect(children[0]).toBe('示例项目');
    await page.getByRole('button', { name: '关闭弹窗' }).click();
    await page.getByRole('button', { name: '项目首页', exact: true }).click();
    await page.getByLabel('选择项目 示例项目', { exact: true }).check();
    await page.getByRole('button', { name: '上传项目', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('同步完成：上传 1 个');
    expect(cloud.size).toBe(1);
    const originalKey = [...cloud.keys()][0];
    const remote = JSON.parse(cloud.get(originalKey));
    remote.project.name = '云端新增项目';
    remote.project.files = [{ path: 'main.tex', content: 'remote-only-project' }];
    cloud.set('/dav/Texite/' + crypto.randomUUID() + '.texite.json', JSON.stringify(remote));
    await page.getByRole('button', { name: '取消项目选择' }).click();
    await page.getByRole('button', { name: '同步', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('拉取 1 个');
    await expect(page.getByRole('button', { name: '打开项目 云端新增项目' })).toBeVisible();
    await page.getByRole('button', { name: '同步', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('云端与本地已检查');
    await expect(page.locator('.project-card')).toHaveCount(2);
    await page.getByLabel('全选项目').check();
    await page.getByRole('button', { name: '上传项目', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('云端与本地已检查');
    await page.getByRole('button', { name: '取消项目选择' }).click();
    await page.getByRole('button', { name: '打开项目 示例项目', exact: true }).click();
    const sourceEditor = page.getByRole('textbox', { name: 'LaTeX 源码编辑器' });
    await expect(page.locator('.sync-pending-badge')).toHaveCount(0);
    await sourceEditor.fill('Local unsynchronized changes');
    await expect(page.locator('.sync-pending-badge')).toBeVisible();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(page.locator('.sync-pending-badge')).toHaveCount(0);
    await sourceEditor.fill('Local changes to upload');
    await expect(page.locator('.sync-pending-badge')).toBeVisible();
    await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('上传 1 个');
    await expect(page.locator('.sync-pending-badge')).toHaveCount(0);
    const edited = JSON.parse(cloud.get(originalKey));
    edited.project.files = [{ path: 'main.tex', content: 'remote-change-visible-in-editor' }];
    cloud.set(originalKey, JSON.stringify(edited));
    await page.getByRole('button', { name: 'WebDAV 同步', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('拉取 1 个');
    await expect(page.getByRole('textbox', { name: 'LaTeX 源码编辑器' })).toContainText(
      'remote-change-visible-in-editor',
    );
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: '项目首页', exact: true }).click();
    await expect(page.locator('.project-properties [aria-label="WebDAV 项目"]')).toHaveCount(2);
    if (process.env.TEXITE_TEST_SCREENSHOTS)
      await page.screenshot({ path: '.qa/webdav-project-space.png', animations: 'disabled' });
    expect(
      await page.evaluate(async () => Object.hasOwn(await window.texite.webdav.get(), 'password')),
    ).toBe(false);
    if (process.platform === 'win32') {
      await expect(page.getByRole('button', { name: '最大化或还原' })).toBeVisible();
      // Observe dispatch without showing or closing the user's application.
      await desktop.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        global.texiteControls = [];
        w.minimize = () => global.texiteControls.push('minimize');
        w.maximize = () => global.texiteControls.push('maximize');
        w.close = () => global.texiteControls.push('close');
      });
      await page.getByRole('button', { name: '最小化', exact: true }).click();
      await page.getByRole('button', { name: '最大化或还原', exact: true }).click();
      await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
      expect(await desktop.evaluate(() => global.texiteControls)).toEqual([
        'minimize',
        'maximize',
        'close',
      ]);
    }
    expect(errors).toEqual([]);
    console.log(
      'PASS: native WebDAV batch upload, cloud pull, deduplication, sidebar sync, editor refresh, named folders and window controls',
    );
  } finally {
    if (desktop) {
      await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await desktop.close();
    }
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
