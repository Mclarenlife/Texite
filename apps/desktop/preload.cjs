const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('texite', {
  chat: {
    get: () => ipcRenderer.invoke('chat:get'),
    save: (config) => ipcRenderer.invoke('chat:save', config),
    start: (input) => ipcRenderer.invoke('chat:start', input),
    cancel: () => ipcRenderer.invoke('chat:cancel'),
  },
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  ai: {
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
  listProjects: () => ipcRenderer.invoke('project:list'),
  renameProject: (id, name) => ipcRenderer.invoke('project:rename', id, name),
  importProject: (project) => ipcRenderer.invoke('project:import', project),
  reopenProject: (id) => ipcRenderer.invoke('project:reopen', id),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  detectEngines: () => ipcRenderer.invoke('compiler:detect'),
  listRuntime: () => ipcRenderer.invoke('runtime:list'),
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
