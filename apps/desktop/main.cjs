const { app, BrowserWindow, ipcMain, dialog, session, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Compiler, readDirectory, saveDirectory, detectEngines } = require('./workspace.cjs');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'texite',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
let window;
let compiler;
let opened = null;
let fileOperationPending = false;
if (!app.isPackaged && process.env.TEXITE_TEST_USER_DATA)
  app.setPath('userData', process.env.TEXITE_TEST_USER_DATA);
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
  handle(name, async (...args) => {
    if (fileOperationPending) throw new Error('正在处理文件，请等待当前操作完成。');
    fileOperationPending = true;
    try {
      return await callback(...args);
    } finally {
      fileOperationPending = false;
    }
  });
}
app.whenReady().then(() => {
  compiler = new Compiler(path.join(app.getPath('userData'), 'compile-cache'));
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
    if (result.canceled) return null;
    const root = result.filePaths[0];
    const data = await readDirectory(root);
    const id = require('node:crypto').randomUUID();
    opened = { root, hashes: data.hashes, id };
    return {
      id,
      name: data.settings.name || path.basename(root),
      files: data.files,
      mainFile: data.settings.mainFile,
      engine: data.settings.engine,
    };
  });
  handleFiles('project:save', async (project) => {
    // A project ID binds a selected directory to one browser workspace.
    if (!opened || (opened.id && opened.id !== project.id)) {
      const result = await dialog.showOpenDialog(window, {
        title: '选择保存项目的空文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled) return { cancelled: true };
      opened = { root: result.filePaths[0], hashes: new Map(), id: project.id };
    }
    opened.id = project.id;
    opened.hashes = await saveDirectory(opened.root, project, opened.hashes);
    return { directory: opened.root };
  });
  handle('compiler:detect', detectEngines);
  handle('compiler:run', (project) =>
    compiler.compile(project, (chunk) => {
      if (window && !window.isDestroyed()) window.webContents.send('compiler:log', chunk);
    }),
  );
  handle('compiler:cancel', () => compiler.cancel());
  function createWindow() {
    window = new BrowserWindow({
      show: app.isPackaged || !process.env.TEXITE_TEST_USER_DATA,
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
