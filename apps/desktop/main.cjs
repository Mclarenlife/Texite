const { app, BrowserWindow, ipcMain, dialog, session, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Compiler, detectEngines } = require('./workspace.cjs');
const { ProjectLibrary } = require('./projects.cjs');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'texite',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let window;
let compiler;
let library;
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
  compiler = new Compiler(path.join(app.getPath('userData'), 'compile-cache'), runtime);
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
  handleFiles('project:import', (project) => library.import(project));
  handleFiles('project:list', () => library.list());
  handleFiles('project:reopen', (id) => library.reopen(id));
  handle('compiler:detect', () => detectEngines(runtime));
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
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
});
