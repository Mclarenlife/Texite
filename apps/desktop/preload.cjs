const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('texite', {
  listProjects: () => ipcRenderer.invoke('project:list'),
  importProject: (project) => ipcRenderer.invoke('project:import', project),
  reopenProject: (id) => ipcRenderer.invoke('project:reopen', id),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  detectEngines: () => ipcRenderer.invoke('compiler:detect'),
  compile: (project) => ipcRenderer.invoke('compiler:run', project),
  cancelCompile: () => ipcRenderer.invoke('compiler:cancel'),
  onCompileLog: (callback) => {
    const handler = (_event, chunk) => callback(chunk);
    ipcRenderer.on('compiler:log', handler);
    return () => ipcRenderer.removeListener('compiler:log', handler);
  },
});
