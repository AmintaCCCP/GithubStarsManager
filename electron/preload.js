const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setProxy: (config) => ipcRenderer.invoke('set-proxy', config),
  getProxy: () => ipcRenderer.invoke('get-proxy'),
  testProxy: (config) => ipcRenderer.invoke('test-proxy', config),
  xFetchTimeline: (handle) => ipcRenderer.invoke('x-fetch-timeline', handle),
  xFetchGraphQL: (url, auth) => ipcRenderer.invoke('x-fetch-graphql', url, auth),
  telegramFetchChannel: (channel, before) => ipcRenderer.invoke('telegram-fetch-channel', channel, before),
  desktop: {
    getPrefs: () => ipcRenderer.invoke('desktop:getPrefs'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop:setAutoLaunch', enabled),
    setCloseToTray: (enabled) => ipcRenderer.invoke('desktop:setCloseToTray', enabled),
    setMinimizeToTray: (enabled) => ipcRenderer.invoke('desktop:setMinimizeToTray', enabled),
    show: () => ipcRenderer.invoke('desktop:show'),
  },
  mcp: {
    setConfig: (config) => ipcRenderer.invoke('mcp:setConfig', config),
    getConfig: () => ipcRenderer.invoke('mcp:getConfig'),
    pushSnapshot: (snapshot) => ipcRenderer.invoke('mcp:pushSnapshot', snapshot),
    start: () => ipcRenderer.invoke('mcp:start'),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  },
});
