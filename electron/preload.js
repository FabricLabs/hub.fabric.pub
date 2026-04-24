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
  onLoginPrompt: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('fabric-login-prompt', handler);
    return () => ipcRenderer.removeListener('fabric-login-prompt', handler);
  },
  pullPendingLoginPrompt: () => ipcRenderer.invoke('fabric:get-pending-login-prompt')
});
