const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('texite', {
  platform: process.platform,
  deleteProject: (id, deleteFiles) => ipcRenderer.invoke('project:delete', id, deleteFiles),
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onProgress: (callback) => {
      const handler = (_event, percent) => callback(percent);
      ipcRenderer.on('updates:progress', handler);
      return () => ipcRenderer.removeListener('updates:progress', handler);
    },
  },
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  onCloseRequest: (callback) => {
    const handler = async (_event, id) => {
      let state;
      try {
        state = await callback();
      } catch {
        state = { unsaved: true, unsynced: 0, syncing: false, error: true };
      }
      await ipcRenderer.invoke('window:close-state', id, state);
    };
    ipcRenderer.on('window:request-close', handler);
    return () => ipcRenderer.removeListener('window:request-close', handler);
  },
  aiHistory: {
    read: (id) => ipcRenderer.invoke('ai-history:read', id),
    update: (id, patch) => ipcRenderer.invoke('ai-history:update', id, patch),
    directory: () => ipcRenderer.invoke('ai-history:get-directory'),
    choose: () => ipcRenderer.invoke('ai-history:choose'),
    clear: () => ipcRenderer.invoke('ai-history:clear'),
  },
  storage: {
    clearSyncBackups: () => ipcRenderer.invoke('storage:clear-sync-backups'),
    get: () => ipcRenderer.invoke('storage:get'),
    choose: () => ipcRenderer.invoke('storage:choose'),
    relocate: (project) => ipcRenderer.invoke('storage:relocate', project),
  },
  webdav: {
    get: () => ipcRenderer.invoke('webdav:get'),
    configure: (input) => ipcRenderer.invoke('webdav:configure', input),
    list: () => ipcRenderer.invoke('webdav:list'),
    sync: (project) => ipcRenderer.invoke('webdav:sync', project),
    batch: (options) => ipcRenderer.invoke('webdav:batch', options),
    download: (key) => ipcRenderer.invoke('webdav:download', key),
    detach: (id) => ipcRenderer.invoke('webdav:detach', id),
  },
  chat: {
    list: () => ipcRenderer.invoke('chat:list'),
    select: (id) => ipcRenderer.invoke('chat:select', id),
    get: () => ipcRenderer.invoke('chat:get'),
    save: (config) => ipcRenderer.invoke('chat:save', config),
    start: (input) => ipcRenderer.invoke('chat:start', input),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
    reply: (id, result) => ipcRenderer.invoke('chat:reply', id, result),
  },
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  ai: {
    getIdleSettings: () => ipcRenderer.invoke('ai:idle-get'),
    setIdleSettings: (settings) => ipcRenderer.invoke('ai:idle-set', settings),
    getConfig: () => ipcRenderer.invoke('ai:config'),
    getProfiles: () => ipcRenderer.invoke('ai:profiles'),
    configure: (config) => ipcRenderer.invoke('ai:configure', config),
    clearHistory: (projectId, mode, conversationId) =>
      ipcRenderer.invoke('ai:clear-history', projectId, mode, conversationId),
    connect: () => ipcRenderer.invoke('ai:connect'),
    disconnect: () => ipcRenderer.invoke('ai:disconnect'),
    chooseBinary: () => ipcRenderer.invoke('ai:choose-binary'),
    start: (input) => ipcRenderer.invoke('ai:start', input),
    cancel: () => ipcRenderer.invoke('ai:cancel'),
    reply: (id, result) => ipcRenderer.invoke('ai:reply', id, result),
    onEvent: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('ai:event', handler);
      return () => ipcRenderer.removeListener('ai:event', handler);
    },
  },
  saveAIProject: (project, removals) => ipcRenderer.invoke('project:save-ai', project, removals),
  restoreProject: (project, removals, removedFolders) =>
    ipcRenderer.invoke('project:restore', project, removals, removedFolders),
  listProjects: () => ipcRenderer.invoke('project:list'),
  renameProject: (id, name) => ipcRenderer.invoke('project:rename', id, name),
  importProject: (project) => ipcRenderer.invoke('project:import', project),
  reopenProject: (id) => ipcRenderer.invoke('project:reopen', id),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  detectEngines: () => ipcRenderer.invoke('compiler:detect'),
  listRuntime: () => ipcRenderer.invoke('runtime:list'),
    getPackageDownloadSettings: () => ipcRenderer.invoke('runtime:online-get'),
    setPackageDownloadSettings: (value) => ipcRenderer.invoke('runtime:online-set', value),
  chooseRuntimePack: () => ipcRenderer.invoke('runtime:choose'),
  installRuntimePack: (ids) => ipcRenderer.invoke('runtime:install', ids),
  removeRuntimeModule: (id) => ipcRenderer.invoke('runtime:remove', id),
  restoreDefaultRuntime: () => ipcRenderer.invoke('runtime:restore'),
  compile: (project) => ipcRenderer.invoke('compiler:run', project),
  cancelCompile: () => ipcRenderer.invoke('compiler:cancel'),
  onCompileLog: (callback) => {
    const handler = (_event, chunk) => callback(chunk);
    ipcRenderer.on('compiler:log', handler);
    return () => ipcRenderer.removeListener('compiler:log', handler);
  },
});
