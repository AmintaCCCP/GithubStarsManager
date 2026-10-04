const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) contextBridge.exposeInMainWorld('electronAPI', {
  setProxy: (config) => ipcRenderer.invoke('set-proxy', config),
  getProxy: () => ipcRenderer.invoke('get-proxy'),
  testProxy: (config) => ipcRenderer.invoke('test-proxy', config),
  xFetchTimeline: (handle) => ipcRenderer.invoke('x-fetch-timeline', handle),
  xFetchGraphQL: (url, auth) => ipcRenderer.invoke('x-fetch-graphql', url, auth),
  xAuth: {
    save: (auth) => ipcRenderer.invoke('x-auth:save', auth),
    get: () => ipcRenderer.invoke('x-auth:get'),
    clear: () => ipcRenderer.invoke('x-auth:clear'),
  },
  telegramFetchChannel: (channel, before) => ipcRenderer.invoke('telegram-fetch-channel', channel, before),
  // WebDAV：主进程代发 DAV 请求，绕开渲染进程的 CORS 限制
  webdavRequest: (params) => ipcRenderer.invoke('webdav-request', params),
  desktop: {
    getPrefs: () => ipcRenderer.invoke('desktop:getPrefs'),
    setAutoLaunch: (enabled) => ipcRenderer.invoke('desktop:setAutoLaunch', enabled),
    setCloseToTray: (enabled) => ipcRenderer.invoke('desktop:setCloseToTray', enabled),
    setMinimizeToTray: (enabled) => ipcRenderer.invoke('desktop:setMinimizeToTray', enabled),
    show: () => ipcRenderer.invoke('desktop:show'),
  },
  // 诊断日志桥：批量追加（invoke）与卸载前冲刷（send 单向，不 await）
  diagnostics: {
    append: (payload) => ipcRenderer.invoke('diagnostics:append', payload),
    flush: (payload) => ipcRenderer.send('diagnostics:flush', payload),
    read: (options) => ipcRenderer.invoke('diagnostics:read', options),
    exportBundle: (payload) => ipcRenderer.invoke('diagnostics:exportBundle', payload),
  },
  mcp: {
    setConfig: (config) => ipcRenderer.invoke('mcp:setConfig', config),
    getConfig: () => ipcRenderer.invoke('mcp:getConfig'),
    pushSnapshot: (snapshot) => ipcRenderer.invoke('mcp:pushSnapshot', snapshot),
    start: () => ipcRenderer.invoke('mcp:start'),
    stop: () => ipcRenderer.invoke('mcp:stop'),
    getStatus: () => ipcRenderer.invoke('mcp:getStatus'),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    installFromDirectory: () => ipcRenderer.invoke('plugins:installFromDirectory'),
    enable: (pluginId, grantedPermissions) => ipcRenderer.invoke('plugins:enable', pluginId, grantedPermissions),
    disable: (pluginId) => ipcRenderer.invoke('plugins:disable', pluginId),
    uninstall: (pluginId, removePluginData) => ipcRenderer.invoke('plugins:uninstall', pluginId, removePluginData),
    runAction: (request) => ipcRenderer.invoke('plugins:runAction', request),
    runProcessor: (request) => ipcRenderer.invoke('plugins:runProcessor', request),
    pushSnapshot: (snapshot) => ipcRenderer.invoke('plugins:pushSnapshot', snapshot),
    runReleaseProcessor: (request) => ipcRenderer.invoke('plugins:runReleaseProcessor', request),
    downloadReleaseAsset: (request) => ipcRenderer.invoke('plugins:downloadReleaseAsset', request),
    runExporter: (request) => ipcRenderer.invoke('plugins:runExporter', request),
    getPage: (pluginId, pageId) => ipcRenderer.invoke('plugins:getPage', pluginId, pageId),
    requestPageCapability: (request) => ipcRenderer.invoke('plugins:requestPageCapability', request),
    getSearchEndpoint: () => ipcRenderer.invoke('plugins:getSearchEndpoint'),
    configureWebSearch: (endpoint) => ipcRenderer.invoke('plugins:configureWebSearch', endpoint),
    searchWeb: (request) => ipcRenderer.invoke('plugins:searchWeb', request),
    // 社区插件注册表（开发守则 §17）：只读校验过的注册表，不含安装动作
    registry: {
      load: () => ipcRenderer.invoke('plugins:loadRegistry'),
    },
    // 插件市场（自助插件源）：源管理 + 目录遍历 + 从源安装/更新
    marketplace: {
      getState: () => ipcRenderer.invoke('plugins:marketplace:getState'),
      addSource: (input) => ipcRenderer.invoke('plugins:marketplace:addSource', input),
      updateSource: (input) => ipcRenderer.invoke('plugins:marketplace:updateSource', input),
      removeSource: (input) => ipcRenderer.invoke('plugins:marketplace:removeSource', input),
      refresh: (options) => ipcRenderer.invoke('plugins:marketplace:refresh', options),
      install: (request) => ipcRenderer.invoke('plugins:marketplace:install', request),
    },
  },
});
