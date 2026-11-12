'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fabricDesktop', {
  isDesktopShell: true,
  platform: process.platform,
  payjoinPost: (url, body) => ipcRenderer.invoke('fabric:payjoin-post', { url, body }),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome
  },
  onMessagePrompt: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('fabric-message-prompt', handler);
    return () => ipcRenderer.removeListener('fabric-message-prompt', handler);
  },
  pullPendingMessagePrompt: () => ipcRenderer.invoke('fabric:get-pending-message-prompt'),
  getPaths: () => ipcRenderer.invoke('fabric:get-desktop-paths'),
  secureStore: {
    available: () => ipcRenderer.invoke('fabric:secure-store-available'),
    get: (key) => ipcRenderer.invoke('fabric:secure-store-get', key),
    set: (key, value) => ipcRenderer.invoke('fabric:secure-store-set', { key, value }),
    remove: (key) => ipcRenderer.invoke('fabric:secure-store-remove', key)
  }
});
