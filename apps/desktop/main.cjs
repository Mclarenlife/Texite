const { app, BrowserWindow, ipcMain, dialog, session, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Compiler, detectEngines } = require('./workspace.cjs');
const { ProjectLibrary } = require('./projects.cjs');
const { RuntimeManager } = require('./runtime-manager.cjs');
const { CodexClient } = require('./codex-client.cjs');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'texite',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let window;
let compiler;
let library;
let ai;
let fileQueue = Promise.resolve();
// End-to-end tests also launch the packaged executable. Keep their projects and
// first-run caches separate from the user's real profile in both launch modes.
if (process.env.TEXITE_TEST_USER_DATA)
  app.setPath('userData', path.resolve(process.env.TEXITE_TEST_USER_DATA));
const devUrl = !app.isPackaged ? process.env.TEXITE_DEV_URL : undefined;
function trusted(event) {
  const url = event.senderFrame?.url;
  return (
    event.sender === window?.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    (devUrl ? url?.startsWith('http://127.0.0.1:5173/') : url?.startsWith('texite://app/'))
  );
}
function handle(name, callback) {
  ipcMain.handle(name, (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted sender');
    return callback(...args);
  });
}
function handleFiles(name, callback) {
  handle(name, (...args) => {
    const task = fileQueue.catch(() => {}).then(() => callback(...args));
    fileQueue = task;
    return task;
  });
}
app.whenReady().then(async () => {
  library = new ProjectLibrary(app.getPath('userData'));
  await library.init();
  const runtime = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'runtime');
  const manager = new RuntimeManager(runtime, path.join(app.getPath('userData'), 'runtimes'));
  compiler = new Compiler(path.join(app.getPath('userData'), 'compile-cache'), runtime, manager);
  ai = new CodexClient(path.join(app.getPath('userData'), 'ai'), (event) => {
    if (window && !window.isDestroyed()) window.webContents.send('ai:event', event);
  });
  handle('ai:connect', () => ai.connect());
  handle('ai:disconnect', () => ai.disconnect());
  handle('ai:start', (input) => ai.start(input));
  handle('ai:cancel', () => ai.cancel());
  handle('ai:reply', (id, result) => ai.reply(id, result));
  handle('ai:choose-binary', async () => {
    if (ai.active) throw new Error('请先停止 AI 任务。');
    const selected = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: '选择 Codex 可执行文件',
    });
    return selected.canceled ? null : ai.chooseBinary(selected.filePaths[0]);
  });
  let pendingPack;
  function checkIdle() {
    if (compiler.active) throw new Error('请先停止编译，再更改引擎或宏包。');
  }
  protocol.handle('texite', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Forbidden', { status: 403 });
    const base = path.resolve(__dirname, '../../dist');
    let relative;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }
    const file = path.resolve(base, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(base + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  handleFiles('project:open', async () => {
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    return result.canceled ? null : library.link(result.filePaths[0]);
  });
  handleFiles('project:save', (project) => library.save(project));
  handleFiles('project:save-ai', (project, removals) => library.save(project, removals));
  handleFiles('project:import', (project) => library.import(project));
  handleFiles('project:list', () => library.list());
  handleFiles('project:reopen', (id) => library.reopen(id));
  handle('compiler:detect', () => detectEngines(runtime, manager));
  handle('runtime:list', async () => {
    await manager.init();
    return manager.list();
  });
  handle('runtime:choose', async () => {
    checkIdle();
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Texite 离线扩展包', extensions: ['zip'] }],
    });
    if (result.canceled) return null;
    const info = await manager.inspect(result.filePaths[0]);
    pendingPack = result.filePaths[0];
    return info;
  });
  handle('runtime:install', async (ids) => {
    checkIdle();
    if (!pendingPack || !Array.isArray(ids) || !ids.length)
      throw new Error('请先选择扩展包与要安装的模块。');
    const result = await manager.install(pendingPack, ids);
    pendingPack = null;
    return result;
  });
  handle('runtime:remove', (id) => {
    checkIdle();
    return manager.remove(id);
  });
  handle('runtime:restore', () => {
    checkIdle();
    return manager.install(path.join(runtime, 'default.texite-runtime.zip'));
  });
  handle('compiler:run', (project) =>
    compiler.compile(project, (chunk) => {
      if (window && !window.isDestroyed()) window.webContents.send('compiler:log', chunk);
    }),
  );
  handle('compiler:cancel', () => compiler.cancel());
  function createWindow() {
    window = new BrowserWindow({
      show: !process.env.TEXITE_TEST_USER_DATA,
      width: 1440,
      height: 940,
      minWidth: 820,
      minHeight: 640,
      backgroundColor: '#f3f4ef',
      title: 'Texite',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url === 'https://github.com/Mclarenlife/Texite/releases/latest')
        void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== (devUrl || 'texite://app/index.html')) event.preventDefault();
    });
    window.webContents.on('will-prevent-unload', (event) => {
      const choice = dialog.showMessageBoxSync(window, {
        type: 'warning',
        title: '项目尚未完全保存',
        message: '部分更改尚未写入磁盘。',
        detail: '可以继续编辑并导出 ZIP，或退出后从本地恢复副本继续。',
        buttons: ['继续编辑', '退出'],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice === 1) event.preventDefault();
    });
    window.on('closed', () => {
      void compiler.cancel();
      void ai.disconnect();
    });
    if (devUrl) window.loadURL(devUrl);
    else window.loadURL('texite://app/index.html');
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  void compiler?.cancel();
  void ai?.disconnect();
});
