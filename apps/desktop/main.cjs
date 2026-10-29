const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  protocol,
  net,
  shell,
  clipboard,
  screen,
  safeStorage,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Compiler, detectEngines } = require('./workspace.cjs');
const { PackageRepository } = require('./package-repository.cjs');
const { ProjectLibrary } = require('./projects.cjs');
const { RuntimeManager } = require('./runtime-manager.cjs');
const { AgentClient } = require('./agent-client.cjs');
const { ChatClient } = require('./chat-client.cjs');
const { AIHistoryStore } = require('./ai-history.cjs');
const { WebDAV } = require('./webdav.cjs');
const { Updates } = require('./updates.cjs');
const { installCloseGuard } = require('./close-guard.cjs');
const { randomUUID } = require('node:crypto');
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
let chat;
let quitRequested = false,
  allowQuit = false;
const closeReplies = new Map();
let fileQueue = Promise.resolve();
// Isolate test projects and compiler caches from the user's profile, including packaged tests.
if (process.env.TEXITE_TEST_USER_DATA)
  app.setPath('userData', path.resolve(process.env.TEXITE_TEST_USER_DATA));
const devUrl = !app.isPackaged ? process.env.TEXITE_DEV_URL : undefined;
function trusted(event) {
  const url = event.senderFrame?.url;
  return (
    event.sender === window?.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    (devUrl ? url?.startsWith(new URL(devUrl).origin + '/') : url?.startsWith('texite://app/'))
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
  handle('clipboard:write', (text) => {
    if (typeof text !== 'string' || text.length > 1_000_000)
      throw new Error('复制内容无效或过长。');
    clipboard.writeText(text);
  });
  library = new ProjectLibrary(app.getPath('userData'));
  await library.init();
  const aiHistory = new AIHistoryStore(app.getPath('userData'));
  await aiHistory.init();
  const dav = new WebDAV(app.getPath('userData'), safeStorage, library, aiHistory);
  handleFiles('ai-history:read', (id) => aiHistory.read(id));
  handleFiles('ai-history:update', (id, patch) => aiHistory.update(id, patch));
  handleFiles('ai-history:get-directory', () => aiHistory.root);
  handleFiles('ai-history:clear', () => aiHistory.clear());
  handleFiles('ai-history:choose', async () => {
    if (ai.active || chat?.active) throw new Error('请先结束 AI 任务再迁移记录。');
    const result = await dialog.showOpenDialog(window, {
      title: '选择 AI 对话数据目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : aiHistory.relocate(result.filePaths[0]);
  });
  const updates = new Updates(path.join(app.getPath('userData'), 'updates'), {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    open: (file) => shell.openPath(file),
    progress: (percent) => {
      if (window && !window.isDestroyed()) window.webContents.send('updates:progress', percent);
    },
  });
  handle('updates:check', () => updates.check());
  handle('updates:status', () => ({
    ...updates.status(),
    directory: path.join(app.getPath('userData'), 'updates'),
  }));
  handle('updates:download', () => updates.download());
  handleFiles('updates:install', () => {
    if (compiler.active || ai.active) throw new Error('请先结束编译或 AI 任务。');
    return updates.install();
  });
  handleFiles('project:delete', async (id, deleteFiles) => {
    if (compiler.active || ai.active) throw new Error('请先结束编译或 AI 任务。');
    await library.remove(id, deleteFiles, [
      app.getPath('home'),
      app.getPath('documents'),
      app.getPath('desktop'),
      app.getPath('downloads'),
      app.getAppPath(),
    ]);
    await dav.detach(id);
  });
  handleFiles('webdav:get', () => dav.get());
  handleFiles('webdav:configure', (input) => dav.configure(input));
  handleFiles('webdav:list', () => dav.list());
  handleFiles('webdav:sync', (project) => dav.sync(project));
  handleFiles('webdav:batch', (options) => dav.batch(options));
  handleFiles('webdav:download', (key) => dav.download(key));
  handleFiles('webdav:detach', (id) => dav.detach(id));
  handleFiles('storage:get', () => library.projectsRoot);
  handleFiles('storage:clear-sync-backups', () => {
    if (compiler.active || ai.active) throw new Error('请先结束编译或 AI 任务。');
    return library.clearSyncBackups();
  });
  handleFiles('storage:relocate', (project) => library.relocate(project));
  handleFiles('storage:choose', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: '选择项目保存目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : library.setRoot(result.filePaths[0]);
  });
  handle('window:control', (action) => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else if (action === 'close') window.close();
  });
  handle('window:close-state', (id, state) => {
    const resolve = closeReplies.get(id);
    if (!resolve) return;
    if (
      !state ||
      typeof state.unsaved !== 'boolean' ||
      typeof state.syncing !== 'boolean' ||
      !Number.isInteger(state.unsynced) ||
      state.unsynced < 0 ||
      state.unsynced > 100000
    )
      resolve({ error: true });
    else resolve(state);
    closeReplies.delete(id);
  });
  handleFiles('project:rename', (id, name) => library.rename(id, name));
  const runtime = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'runtime');
  const manager = new RuntimeManager(runtime, path.join(app.getPath('userData'), 'runtimes'));
  compiler = new Compiler(path.join(app.getPath('userData'), 'compile-cache'), runtime, manager);
  const packageRepository = new PackageRepository(manager, app.getPath('userData'));
  handle('runtime:online-get', () => packageRepository.settings());
  handle('runtime:online-set', (settings) => packageRepository.configure(settings));
  ai = new AgentClient(path.join(app.getPath('userData'), 'ai'), (event) => {
    if (window && !window.isDestroyed()) window.webContents.send('ai:event', event);
  });
  chat = new ChatClient(path.join(app.getPath('userData'), 'ai'), safeStorage, (event) => {
    if (window && !window.isDestroyed()) window.webContents.send('ai:event', event);
  });
  handle('chat:list', () => chat.list());
  handle('chat:select', (id) => chat.select(id));
  handle('ai:config', () => ai.getConfig());
  handle('ai:profiles', () => ai.getProfiles());
  handle('ai:configure', (config) => ai.configure(config));
  handle('chat:get', () => chat.get());
  handle('chat:save', (config) => chat.save(config));
  handle('chat:start', (input) => chat.start(input));
  handle('chat:cancel', () => chat.cancel());
  handle('chat:reply', (id, result) => chat.reply(id, result));
  handle('ai:connect', () => ai.connect());
  handle('ai:idle-get', () => ai.getIdleSettings());
  handle('ai:idle-set', (settings) => ai.setIdleSettings(settings));
  handle('ai:disconnect', () => ai.disconnect());
  handle('ai:clear-history', (projectId, mode, conversationId) =>
    ai.clearHistory(projectId, mode, conversationId),
  );
  handle('ai:start', (input) => ai.start(input));
  handle('ai:cancel', () => ai.cancel());
  handle('ai:reply', (id, result) => ai.reply(id, result));
  handle('ai:choose-binary', async () => {
    if (ai.active) throw new Error('请先停止 AI 任务。');
    const selected = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: '选择 Agent CLI 程序',
      message: '选择所配置的 CLI 可执行文件，不要选择 .app 应用包目录。',
    });
    return selected.canceled ? null : ai.chooseBinary(selected.filePaths[0]);
  });
  let pendingPack;
  function checkIdle() {
    if (compiler.active || packageRepository.active)
      throw new Error('请先停止编译和宏包下载，再更改引擎或宏包。');
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
  handleFiles('project:restore', (project, removals, removedFolders) =>
    library.save(project, removals, true, removedFolders),
  );
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
    packageRepository.compile(project, compiler, (chunk) => {
      if (window && !window.isDestroyed()) window.webContents.send('compiler:log', chunk);
    }),
  );
  handle('compiler:cancel', () => {
    packageRepository.cancel();
    return compiler.cancel();
  });
  function createWindow() {
    window = new BrowserWindow({
      show: !process.env.TEXITE_TEST_USER_DATA,
      width: Math.min(1720, screen.getPrimaryDisplay().workAreaSize.width),
      height: Math.min(1080, screen.getPrimaryDisplay().workAreaSize.height),
      minWidth: 820,
      minHeight: 640,
      backgroundColor: '#f3f4ef',
      title: 'Texite',
      ...(process.platform === 'win32' ? { frame: false } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (
        [
          'https://github.com/Mclarenlife/Texite/releases/latest',
          'https://github.com/Mclarenlife/Texite',
          'https://mclarenlife.github.io/',
        ].includes(url)
      )
        void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== (devUrl || 'texite://app/index.html')) event.preventDefault();
    });
    const guardedWindow = window;
    const closeGuard = installCloseGuard(window, {
      getState: () =>
        new Promise((resolve) => {
          const id = randomUUID();
          const timer = setTimeout(() => {
            closeReplies.delete(id);
            resolve({ error: true });
          }, 10000);
          closeReplies.set(id, (value) => {
            clearTimeout(timer);
            resolve(value);
          });
          guardedWindow.webContents.send('window:request-close', id);
        }),
      confirm: async (prompt) =>
        (
          await dialog.showMessageBox(guardedWindow, {
            type: 'warning',
            title: '退出 Texite？',
            ...prompt,
            buttons: ['返回软件', '仍然退出'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          })
        ).response === 1,
      cleanup: async () => {
        chat?.cancel();
        packageRepository.cancel();
        await Promise.all([compiler.cancel(), ai.disconnect()]);
      },
      approved: () => {
        if (quitRequested) {
          allowQuit = true;
          app.quit();
        } else guardedWindow.close();
      },
      cancelled: () => {
        quitRequested = false;
      },
      failed: (error) =>
        void dialog.showMessageBox(guardedWindow, {
          type: 'error',
          message: '暂时无法关闭软件',
          detail: error.message,
        }),
    });
    window.webContents.on('will-prevent-unload', (event) => {
      if (closeGuard.isAllowed()) {
        event.preventDefault();
        return;
      }
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
      packageRepository.cancel();
      void compiler.cancel();
      void ai.disconnect();
      chat?.cancel();
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
app.on('before-quit', (event) => {
  if (!allowQuit && window && !window.isDestroyed()) {
    event.preventDefault();
    quitRequested = true;
    window.close();
  }
});
